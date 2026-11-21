// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestCompletedContinuationDoesNotBecomeUnknownAtTurnEnd; TestContinuationStillReportsRealCancellation
// Impact: python -B scripts/code-atlas.py show Core/matrix_activity_continuation_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"testing"
)

func TestCompletedContinuationDoesNotBecomeUnknownAtTurnEnd(t *testing.T) {
	for _, tc := range []struct{ name, args, start, receipt, finish string }{
		{"write_stdin", `{"session_id":27}`, `{"ok":true,"state":"running","session_id":27}`, `{"ok":true,"state":"running","session_id":27}`, `{"ok":true,"state":"exited","session_id":27,"exit_code":0}`},
		{"read_shell_output", `{"session_id":27}`, `{"ok":true,"state":"running","session_id":27}`, `{"ok":true,"state":"running","session_id":27}`, `{"ok":true,"state":"exited","session_id":27,"exit_code":0}`},
		{"terminal", `{"action":"wait","session_id":27}`, `{"ok":true,"state":"running","session_id":27}`, `{"ok":true,"state":"running","session_id":27}`, `{"ok":true,"state":"exited","session_id":27,"exit_code":0}`},
		{"wait", `{"cell_id":"test-cell"}`, `{"ok":true,"state":"running","cell_id":"test-cell"}`, `{"ok":true,"state":"running","cell_id":"test-cell"}`, `{"ok":true,"state":"completed","cell_id":"test-cell"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, id, a := activityFixture(t)
			startName := "exec_command"
			if tc.name == "wait" {
				startName = "exec"
			}
			start := ToolCall{ID: "start", Function: FunctionCall{Name: startName}}
			poll := ToolCall{ID: "poll", Function: FunctionCall{Name: tc.name, Arguments: tc.args}}
			for _, item := range []struct {
				call   ToolCall
				output string
			}{{start, tc.start}, {poll, tc.receipt}} {
				if err := a.Append("tool_intent", ToolIntent{"turn", Message{ToolCalls: []ToolCall{item.call}}}); err != nil {
					t.Fatal(err)
				}
				if err := a.Append("tool_progress", ToolReceipt{Key: "turn:" + item.call.ID, Output: item.output}); err != nil {
					t.Fatal(err)
				}
			}
			_, rows := activityPage(t, m, id, 0)
			for _, r := range rows {
				if r.ID == "turn:start" && r.State != "running" {
					t.Fatalf("process prematurely settled: %+v", r)
				}
				if r.ID == "turn:poll" && (r.State != "completed" || !r.Hidden) {
					t.Fatalf("returned observation is still active: %+v", r)
				}
			}
			if err := a.Append("tool_progress", ToolReceipt{Key: "turn:start", Output: tc.finish}); err != nil {
				t.Fatal(err)
			}
			m.jobs[id].record.State = "completed"
			_, rows = activityPage(t, m, id, 0)
			for _, r := range rows {
				if r.State != "completed" {
					t.Fatalf("successful operation became unknown: %+v", r)
				}
			}
		})
	}
}

func TestContinuationStillReportsRealCancellation(t *testing.T) {
	c := newAgentActivityCache()
	c.result("run", ToolCall{Function: FunctionCall{Name: "exec_command"}}, `{"ok":true,"state":"running","session_id":27}`)
	c.result("stop", ToolCall{Function: FunctionCall{Name: "write_stdin", Arguments: `{"session_id":27,"terminate":true}`}}, `{"ok":false,"state":"cancelled","session_id":27}`)
	if c.items["stop"].State != "cancelled" || c.items["run"].State != "cancelled" {
		t.Fatal(c.items)
	}
}
