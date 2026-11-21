// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkflowRevisionPreservesConversationRequestPrefix
// Impact: python -B scripts/code-atlas.py show Core/workspace_workflow_prefix_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestWorkflowRevisionPreservesConversationRequestPrefix(t *testing.T) {
	previousMode := baseToolMode
	baseToolMode = false
	t.Cleanup(func() { baseToolMode = previousMode })
	var calls atomic.Int32
	var w *Workspace
	var stable []json.RawMessage
	var previousNotice string
	w, dir := testWorkspace(t, func(res http.ResponseWriter, req *http.Request) {
		n := calls.Add(1)
		var wire struct {
			Input []json.RawMessage `json:"input"`
		}
		if err := json.NewDecoder(req.Body).Decode(&wire); err != nil {
			t.Error(err)
		}
		call := func(name string, args any) {
			id := fmt.Sprintf("workflow-prefix-%d", n)
			fixtureAnswer(res, id, "", []any{map[string]any{"type": "function_call", "id": "fc-" + id, "call_id": id, "name": name, "arguments": string(rawJSON(args))}})
		}
		if n == 1 {
			stable = append([]json.RawMessage(nil), wire.Input...)
			call("update_plan", map[string]any{"summary": "prefix check", "plan": []any{map[string]any{"id": "check", "description": "verify stable prefix", "status": "in_progress"}}})
			return
		}
		if n == 2 || n == 3 {
			notice := w.workflowNotice()
			noticeAt, restartAt, lastReceipt, inputAt, restarts := -1, -1, -1, -1, 0
			restartNotice := formatPromptText(runtimePrompt("Matrix/辅助指令/重启后的历史.txt"), 7)
			for i, raw := range wire.Input {
				var item struct {
					Type, Content string
				}
				// Provider output items can contain structured content; only the
				// host notice uses a plain string and needs decoding here.
				_ = json.Unmarshal(raw, &item)
				if item.Type == "function_call_output" {
					lastReceipt = i
				}
				if notice != "" && strings.Contains(item.Content, notice) {
					noticeAt = i
				}
				if strings.Contains(item.Content, restartNotice) {
					restartAt = i
					restarts++
				}
				if item.Content == "Keep this exact conversation history while updating one workflow record." {
					inputAt = i
				}
			}
			if inputAt < 0 || restarts != 1 || restartAt <= inputAt {
				t.Error("restart observation must follow user history once", restartAt, inputAt, restarts)
			}
			if lastReceipt < 0 || noticeAt <= lastReceipt {
				t.Error("current workflow state precedes conversation/tool history", n, noticeAt, lastReceipt)
			}
			{
				if n == 3 && notice == previousNotice || len(stable) == 0 || len(wire.Input) < len(stable) {
					t.Error("workflow revision was frozen or no stable prefix was captured")
				} else {
					for i, original := range stable {
						if !bytes.Equal(original, wire.Input[i]) {
							t.Error("workflow revision changed an existing request prefix item", i)
						}
					}
				}
			}
			// Already submitted runtime observations are immutable history too.
			// Compare the whole previous request, including its dynamic tail.
			stable = append([]json.RawMessage(nil), wire.Input...)
			previousNotice = notice
			w.mu.Lock()
			state, err := w.loadWorkflowLocked()
			w.mu.Unlock()
			if err != nil {
				t.Error(err)
			}
			if n == 2 {
				call("workspace", map[string]any{"action": "workflow_capture", "label": "local prefix fixture", "paths": []string{"prefix-fixture.txt"}, "expected_version": state.Revision})
			} else {
				call("workspace", map[string]any{"action": "workflow_deliver", "verdict": "partial", "summary": "prefix checked locally", "unresolved": []string{"actual supplier cache behavior is outside this fixture"}, "expected_version": state.Revision})
			}
			return
		}
		fixtureAnswer(res, fmt.Sprintf("prefix-done-%d", n), "PREFIX_CHECKED", nil)
	})
	w.priorGeneration = 7
	if err := os.WriteFile(filepath.Join(dir, "prefix-fixture.txt"), []byte("local fixture\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Send("workflow-prefix-request", "Keep this exact conversation history while updating one workflow record."); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		w.mu.Lock()
		id := w.state.Roles[WorkspaceMatrix]
		w.mu.Unlock()
		if id != "" {
			record, err := w.manager.Status(w.state.ID, id)
			if err == nil && record.State == "failed" {
				t.Fatal(record.Error)
			}
			if err == nil && record.State == "completed" {
				if calls.Load() != 4 || record.Result != "PREFIX_CHECKED" {
					t.Fatal("unexpected fixture completion", calls.Load(), record.Result)
				}
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("workflow prefix fixture did not settle")
}
