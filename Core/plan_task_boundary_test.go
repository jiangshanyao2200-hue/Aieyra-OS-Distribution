// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestPlanNewTaskPreservesUnfinishedHistoryAndCannotResetSameTask; TestPlanContinuationConsumesNewTaskBoundaryAndStaleStateRejects; TestPlanRecoveredUnknownReceiptDoesNotErasePriorUserTaskBoundary; TestPlanWireSchemaIncludesBothFormsAndNewTask
// Impact: python -B scripts/code-atlas.py show Core/plan_task_boundary_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestPlanNewTaskPreservesUnfinishedHistoryAndCannotResetSameTask(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("no model") })
	e := &PlanEngine{State: initialPlan(t)}
	old := ClonePlan(e.State)
	if err := w.syncWorkflow(e, "agent", 1); err != nil {
		t.Fatal(err)
	}
	w.bindPlanTaskBoundary(e, "agent", 2)
	e.RequestSnapshot, e.SnapshotBound = ClonePlan(e.State), true
	raw := `{"new_task":true,"summary":"处理新的用户任务","plan":[{"id":"new","description":"读取新任务输入","status":"in_progress"}]}`
	response := func(id string) Message {
		return Message{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: id, Function: FunctionCall{Name: "update_plan", Arguments: raw}}}}
	}
	if _, err := ExecutePlanTools(e, response("disk"), "new", func(ToolTurn) error { return fmt.Errorf("disk full") }); err == nil || !reflect.DeepEqual(e.State, old) || e.PriorTaskID != old.ID {
		t.Fatal("failed persistence changed task state")
	}
	turn, err := ExecutePlanTools(e, response("ok"), "new", func(ToolTurn) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	var result PlanToolResult
	if err = json.Unmarshal([]byte(turn.Messages[1].Content), &result); err != nil || !result.OK {
		t.Fatalf("new task: %+v %v", result, err)
	}
	if e.State.ID == old.ID || e.PriorTaskID != "" || !reflect.DeepEqual(turn.Receipts[0].Transition.Before, old) || !turn.Receipts[0].Transition.TaskBoundary {
		t.Fatal("old plan was not preserved")
	}
	if err = w.syncWorkflow(e, "agent", 2); err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob(filepath.Join(w.dir, "workflow-history-*.json"))
	if len(files) != 1 {
		t.Fatal("historical workflow missing", files)
	}
	var saved WorkflowState
	b, _ := os.ReadFile(files[0])
	if json.Unmarshal(b, &saved) != nil || !reflect.DeepEqual(saved.Plan, old) || saved.Generation != 1 {
		t.Fatal("old workflow changed")
	}
	restored := &PlanEngine{State: ClonePlan(old)}
	if err = restored.Replay(turn.Receipts[0]); err != nil || !reflect.DeepEqual(restored.State, e.State) {
		t.Fatal("task boundary does not restore", err)
	}
	e.RequestSnapshot = ClonePlan(e.State)
	rejected, _ := e.apply(response("again").ToolCalls[0], "same")
	json.Unmarshal([]byte(rejected.Output), &result)
	if result.OK || result.Error.Code != "task_boundary_required" {
		t.Fatal("same task reset accepted", result)
	}
}

func TestPlanContinuationConsumesNewTaskBoundaryAndStaleStateRejects(t *testing.T) {
	e := &PlanEngine{State: initialPlan(t), SnapshotBound: true}
	e.RequestSnapshot = ClonePlan(e.State)
	e.PriorTaskID = e.State.ID
	invoke := func(raw, id string) PlanToolResult {
		r, _ := e.apply(ToolCall{ID: id, Function: FunctionCall{Name: "update_plan", Arguments: raw}}, "continuation")
		var out PlanToolResult
		json.Unmarshal([]byte(r.Output), &out)
		return out
	}
	if r := invoke(`{"action":"update","reason":"继续当前任务","changes":[{"op":"set_status","step_id":"p1","status":"completed","evidence":["实际输入已读取"]}]}`, "continue"); !r.OK || e.PriorTaskID != "" {
		t.Fatal("continuation did not bind existing task", r)
	}
	e.PriorTaskID = e.State.ID
	if r := invoke(`{"new_task":true,"action":"create","objective":"不应替换","acceptance":["不应替换"],"steps":[{"text":"新项"}]}`, "stale"); r.OK || r.Error.Code != "task_boundary_required" {
		t.Fatal("stale model request can replace current work", r)
	}
}

func TestPlanRecoveredUnknownReceiptDoesNotErasePriorUserTaskBoundary(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("no model") })
	e := &PlanEngine{State: initialPlan(t), Receipts: map[string]ToolReceipt{}}
	if err := w.syncWorkflow(e, "agent", 1); err != nil {
		t.Fatal(err)
	}
	// Recovery discovers an interrupted call before this user's new request.
	e.Receipts["old-call"] = ToolReceipt{Key: "old-call", Output: `{"state":"interrupted_unknown"}`}
	w.bindPlanTaskBoundary(e, "agent", 2)
	if err := w.syncWorkflow(e, "agent", 2); err != nil {
		t.Fatal(err)
	}
	if e.PriorTaskID != e.State.ID {
		t.Fatal("receipt recovery erased the prior task boundary")
	}
	e.RequestSnapshot, e.SnapshotBound = ClonePlan(e.State), true
	r, _ := e.apply(ToolCall{ID: "new", Function: FunctionCall{Name: "update_plan", Arguments: `{"new_task":true,"summary":"用户明确的新任务","plan":[{"description":"核对新输入","status":"in_progress"}]}`}}, "new-turn")
	var result PlanToolResult
	if err := json.Unmarshal([]byte(r.Output), &result); err != nil || !result.OK {
		t.Fatalf("new task after recovery: %+v %v", result, err)
	}
}

func TestPlanWireSchemaIncludesBothFormsAndNewTask(t *testing.T) {
	definition := PlanToolDefinition()
	parameters := definition.Parameters.(map[string]any)["properties"].(map[string]any)
	for _, key := range []string{"summary", "plan", "action", "changes", "completion", "new_task"} {
		if parameters[key] == nil {
			t.Fatal("missing advertised field", key)
		}
	}
	encoded, err := json.Marshal(BuildResponsesRequest(&Settings{}, []Message{{Role: RoleUser, Content: "test"}}, true, []ToolDefinition{definition}))
	if err != nil {
		t.Fatal(err)
	}
	var request struct {
		Tools []struct {
			Parameters map[string]json.RawMessage `json:"parameters"`
		} `json:"tools"`
	}
	if err = json.Unmarshal(encoded, &request); err != nil || len(request.Tools) != 1 {
		t.Fatal("wire request", err)
	}
	var props map[string]json.RawMessage
	json.Unmarshal(request.Tools[0].Parameters["properties"], &props)
	for _, key := range []string{"summary", "plan", "action", "changes", "new_task"} {
		if props[key] == nil {
			t.Fatal("wire omitted field", key)
		}
	}
}
