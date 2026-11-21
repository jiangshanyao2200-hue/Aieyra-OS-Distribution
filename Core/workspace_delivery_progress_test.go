// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkflowContinuationRetainsProvisionalBodyAndContext
// Impact: python -B scripts/code-atlas.py show Core/workspace_delivery_progress_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestWorkflowContinuationRetainsProvisionalBodyAndContext(t *testing.T) {
	var requests atomic.Int32
	var w *Workspace
	full := "PROVISIONAL_BODY " + strings.Repeat("已经显示的完整中文段落。", 60)
	w, _ = testWorkspace(t, func(res http.ResponseWriter, req *http.Request) {
		n := requests.Add(1)
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		call := func(name string, args any) {
			id := fmt.Sprintf("continue-%d", n)
			fixtureAnswer(res, id, "", []any{map[string]any{"type": "function_call", "id": "fc-" + id, "call_id": id, "name": name, "arguments": string(rawJSON(args))}})
		}
		switch n {
		case 1:
			call("update_plan", map[string]any{"summary": "验证保留正文", "plan": []any{map[string]any{"id": "verify", "description": "验证正文与交付边界", "status": "in_progress"}}})
		case 2:
			fixtureAnswer(res, "provisional", full, nil)
		case 3:
			if !strings.Contains(string(rawJSON(body)), "PROVISIONAL_BODY") {
				t.Error("continuation lost prior assistant reply in model context")
			}
			w.mu.Lock()
			found := false
			for _, message := range w.state.Messages {
				if message.Text == full {
					found = message.State == "commentary" && message.DocumentID != ""
				}
			}
			state, err := w.loadWorkflowLocked()
			w.mu.Unlock()
			if err != nil || !found {
				t.Error("continuation discarded or completed provisional body", err)
			}
			call("workspace", map[string]any{"action": "workflow_deliver", "verdict": "partial", "summary": "明确保留未完成的验证", "unresolved": []string{"需要继续核验"}, "expected_version": state.Revision})
		default:
			fixtureAnswer(res, "final", "FINAL_PARTIAL_RESULT", nil)
		}
	})
	if _, err := w.Send("continuation-check", "Check delivery and preserve visible progress."); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		w.mu.Lock()
		id := w.state.Roles[WorkspaceMatrix]
		w.mu.Unlock()
		if id != "" {
			r, err := w.manager.Status(w.state.ID, id)
			if err == nil && r.State == "failed" {
				t.Fatal(r.Error)
			}
			if err == nil && r.State == "completed" {
				if requests.Load() != 4 || r.Result != "FINAL_PARTIAL_RESULT" {
					t.Fatal("unexpected continuation result", requests.Load(), r.Result)
				}
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("continuation did not settle")
}
