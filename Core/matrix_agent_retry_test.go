// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestAlphaMatrixRetryIgnoresLegacyRequestBudget
// Impact: python -B scripts/code-atlas.py show Core/matrix_agent_retry_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"net/http"
	"sync/atomic"
	"testing"
)

func TestAlphaMatrixRetryIgnoresLegacyRequestBudget(t *testing.T) {
	var requests atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 1 {
			w.WriteHeader(503)
			return
		}
		fixtureAnswer(w, "retry-success", "RECOVERED", nil)
	})
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "alpha-budget", ModelID: "local-model", Task: "recover from temporary failure", Workdir: dir, Tools: []string{"exec_command"}, MaxRequests: 1})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 10; i++ {
		r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 1000)
		if err != nil {
			t.Fatal(err)
		}
		if r.State != "running" && r.State != "queued" {
			break
		}
	}
	if requests.Load() != 2 || r.Requests != 2 || len(r.Usage) != 2 || r.State != "completed" || r.Result != "RECOVERED" {
		t.Fatalf("budget counts=%d requests=%d usage=%d error=%s", requests.Load(), r.Requests, len(r.Usage), r.Error)
	}
}
