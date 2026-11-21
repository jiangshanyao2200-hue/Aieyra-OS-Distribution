// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestCancelGenerationStopsSubtreeAndPreservesSibling; TestChildHumanResumeCannotResetSameGenerationPlan
// Impact: python -B scripts/code-atlas.py show Core/matrix_task_isolation_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestCancelGenerationStopsSubtreeAndPreservesSibling(t *testing.T) {
	started := make(chan string, 3)
	cancelled := make(chan string, 3)
	release := make(chan struct{})
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		name := ""
		for _, candidate := range []string{"parent-marker", "child-marker", "sibling-marker"} {
			if strings.Contains(string(body), candidate) {
				name = candidate
			}
		}
		started <- name
		select {
		case <-r.Context().Done():
			cancelled <- name
		case <-release:
			fixtureAnswer(rw, name, "complete", nil)
		}
	})
	t.Cleanup(func() { close(release) })
	create := func(owner, name string) AgentRecord {
		t.Helper()
		r, err := m.Create(context.Background(), owner, AgentSpec{RequestID: name, ModelID: "local-model", Task: name, Workdir: dir})
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	parent := create(testMatrixOwner, "parent-marker")
	child := create(parent.ID, "child-marker")
	sibling := create(testMatrixOwner, "sibling-marker")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for range 3 {
		select {
		case <-started:
		case <-ctx.Done():
			t.Fatal("tasks did not all reach provider")
		}
	}
	if err := m.CancelGeneration(testMatrixOwner, parent.ID, 2); err == nil {
		t.Fatal("stale cancellation accepted")
	}
	if err := m.CancelGeneration(testMatrixOwner, parent.ID, 1); err != nil {
		t.Fatal(err)
	}
	for _, task := range []AgentRecord{parent, child} {
		r, err := m.Wait(ctx, testMatrixOwner, task.ID, 4000)
		if err != nil || r.State != "cancelled" {
			t.Fatal("subtree still active", r.State, err)
		}
	}
	for range 2 {
		select {
		case name := <-cancelled:
			if name == "sibling-marker" {
				t.Fatal("sibling provider cancelled")
			}
		case <-ctx.Done():
			t.Fatal("provider cancellation not delivered")
		}
	}
	if r, err := m.Status(testMatrixOwner, sibling.ID); err != nil || r.State != "running" {
		t.Fatal("sibling stopped", r.State, err)
	}
}

func TestChildHumanResumeCannotResetSameGenerationPlan(t *testing.T) {
	var requests atomic.Int32
	w, dir := testWorkspace(t, func(rw http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		switch n := requests.Add(1); n {
		case 1:
			fixtureAnswer(rw, "plan", "", []any{map[string]any{"type": "function_call", "id": "fc-plan", "call_id": "plan", "name": "update_plan", "arguments": `{"summary":"Preserve original task","plan":[{"id":"verify","description":"Verify the assigned output","status":"in_progress"}]}`}})
		case 2:
			humanToolAnswer(rw, int(n), "open", nil)
		case 3:
			humanToolAnswer(rw, int(n), "call", humanTestQuestion())
		case 4:
			if strings.Contains(string(body["input"]), "The stored plan belongs to an earlier user turn") {
				t.Error("human resume granted a new-task boundary")
			}
			fixtureAnswer(rw, "reset", "", []any{map[string]any{"type": "function_call", "id": "fc-reset", "call_id": "reset", "name": "update_plan", "arguments": `{"new_task":true,"summary":"Discard original task","plan":[{"id":"other","description":"Replace unfinished work","status":"in_progress"}]}`}})
		default:
			if !strings.Contains(string(body["input"]), "task_boundary_required") {
				t.Error("same-generation reset was not rejected")
			}
			fixtureAnswer(rw, "final", "Original task retained", nil)
		}
	})
	r, err := w.manager.Create(context.Background(), w.state.ID, AgentSpec{RequestID: "plan-human", ModelID: "local-model", Task: "Verify assigned output", Workdir: dir, Tools: []string{"update_plan", "human"}})
	if err != nil {
		t.Fatal(err)
	}
	r, err = w.manager.Wait(context.Background(), w.state.ID, r.ID, 10000)
	if err != nil || r.State != "waiting_user" {
		t.Fatal(r.State, r.Error, err)
	}
	before := childSnapshot(t, w, r.ID)["plan"].(*PlanState)
	if before == nil {
		t.Fatal("missing plan before human reply")
	}
	reply := humanTestReply(r)
	reply.SessionID = w.state.ID
	if _, err = w.manager.ReplyHuman(w.state.ID, reply); err != nil {
		t.Fatal(err)
	}
	r, err = w.manager.Wait(context.Background(), w.state.ID, r.ID, 10000)
	if err != nil || r.State != "completed" || r.Generation != 1 || requests.Load() != 5 {
		t.Fatal("human resume failed", r.State, r.Generation, requests.Load(), err)
	}
	after := childSnapshot(t, w, r.ID)["plan"].(*PlanState)
	if after == nil || after.ID != before.ID || after.Revision != before.Revision {
		t.Fatal("human decision replaced original plan", before, after)
	}
}
