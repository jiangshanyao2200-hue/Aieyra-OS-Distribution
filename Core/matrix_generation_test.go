// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMatrixGenerationGuardPreservesNewTurn
// Impact: python -B scripts/code-atlas.py show Core/matrix_generation_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"net/http"
	"sync/atomic"
	"testing"
)

// A delayed action from generation one must never affect generation two.
func TestMatrixGenerationGuardPreservesNewTurn(t *testing.T) {
	var requests atomic.Int32
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) > 1 {
			started <- struct{}{}
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
		}
		fixtureAnswer(w, "guard", "done", nil)
	})
	defer close(release)
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "guard-create", ModelID: "local-model", Task: "one", Workdir: dir, MaxRequests: 4})
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "completed" {
		t.Fatalf("initial turn: %#v %v", r, err)
	}
	r, err = m.SendGeneration(testMatrixOwner, r.ID, "guard-next", "two", 1)
	if err != nil || r.Generation != 2 {
		t.Fatalf("continuation: %#v %v", r, err)
	}
	<-started
	if _, err := m.SendGeneration(testMatrixOwner, r.ID, "guard-stale", "old direction", 1); err == nil {
		t.Fatal("stale continuation accepted")
	}
	if err := m.CancelGeneration(testMatrixOwner, r.ID, 1); err == nil {
		t.Fatal("stale cancellation accepted")
	}
	current, err := m.Status(testMatrixOwner, r.ID)
	if err != nil || current.State != "running" || current.Generation != 2 {
		t.Fatalf("new turn affected: %#v %v", current, err)
	}
	if _, err := m.SendGeneration(testMatrixOwner, r.ID, "guard-next", "two", 1); err != nil {
		t.Fatal("same request must remain idempotent", err)
	}
	if err := m.CancelGeneration(testMatrixOwner, r.ID, 2); err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "cancelled" || requests.Load() != 2 {
		t.Fatalf("owned cancellation: %#v %v requests=%d", r, err, requests.Load())
	}
}
