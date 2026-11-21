// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMatrixNarrationSurvivesToolsAndNewRequest; TestShellContinuationKeepsOutputWithoutLiveProcess; TestMatrixPlanActivityAcceptsStructuredPlanState
// Impact: python -B scripts/code-atlas.py show Core/workspace_matrix_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMatrixNarrationSurvivesToolsAndNewRequest(t *testing.T) {
	w := &Workspace{live: map[string]WorkspaceLive{}}
	w.requestStart(WorkspaceMatrix, true)
	w.stream(WorkspaceMatrix, Event{Kind: EventReasoning, Text: "真实思考"})
	w.stream(WorkspaceMatrix, Event{Kind: EventDelta, Text: "先读取实际文件。"})
	w.stream(WorkspaceMatrix, Event{Kind: EventToolPreparing})
	if w.live[WorkspaceMatrix].Text != "先读取实际文件。" {
		t.Fatal("tool preparation discarded narration")
	}
	w.requestStart(WorkspaceMatrix, true)
	if w.live[WorkspaceMatrix].Text != "先读取实际文件。" {
		t.Fatal("next request caused blank screen")
	}
	w.stream(WorkspaceMatrix, Event{Kind: EventDelta, Text: "读取完成。"})
	w.stream(WorkspaceMatrix, Event{Kind: EventDelta, Text: "现在核对结果。"})
	if w.live[WorkspaceMatrix].Text != "读取完成。现在核对结果。" {
		t.Fatal(w.live)
	}
	ctx := WithToolPermissions(context.Background(), workspacePermissions(WorkspaceMatrix))
	for _, name := range []string{"project", "exec_command", "apply_patch", "write_stdin"} {
		if !toolAllowed(ctx, name) {
			t.Fatal("Matrix cannot execute", name)
		}
	}
	if toolAllowed(ctx, "team") || toolAllowed(ctx, "agents") {
		t.Fatal("team enabled")
	}
}

func TestShellContinuationKeepsOutputWithoutLiveProcess(t *testing.T) {
	c := newAgentActivityCache()
	call := ToolCall{Function: FunctionCall{Name: "exec_command", Arguments: `{"cmd":"echo first; echo second","description":"读取两段输出"}`}}
	c.put(activityPreview(call, "first", ""))
	c.result("first", call, `{"ok":true,"session_id":7,"state":"running","output":"first\n","next_offset":6}`)
	next := ToolCall{Function: FunctionCall{Name: "write_stdin", Arguments: `{"session_id":7}`}}
	c.put(activityPreview(next, "next", ""))
	c.result("next", next, `{"ok":true,"session_id":7,"state":"completed","output":"second\n","next_offset":13,"exit_code":0}`)
	var output map[string]any
	_ = json.Unmarshal(c.items["first"].Preview, &output)
	if output["output"] != "first\nsecond\n" || c.items["first"].State != "completed" {
		t.Fatal(output, c.items["first"])
	}
	rev := c.items["first"].Revision
	c.result("next", next, `{"ok":true,"session_id":7,"state":"completed","output":"second\n","next_offset":13,"exit_code":0}`)
	if c.items["first"].Revision != rev {
		t.Fatal("identical poll changed original detail")
	}
	c.result("last", next, `{"ok":true,"session_id":7,"state":"completed","output":"second\n","next_offset":20,"exit_code":0}`)
	_ = json.Unmarshal(c.items["first"].Preview, &output)
	if output["output"] != "first\nsecond\nsecond\n" {
		t.Fatal("repeated legitimate output lost", output)
	}
}

func TestMatrixPlanActivityAcceptsStructuredPlanState(t *testing.T) {
	c := newAgentActivityCache()
	call := ToolCall{Function: FunctionCall{Name: "update_plan"}}
	c.result("plan", call, `{"ok":true,"state":{"objective":"Read and verify","phases":[{"steps":[{"text":"Read source","status":"in_progress"}]}]}}`)
	if c.items["plan"].State != "completed" || c.items["plan"].Detail != "" {
		t.Fatal(c.items["plan"])
	}
}
