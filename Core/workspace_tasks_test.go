// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: childSnapshot; TestTaskRawHashRetriesOwnershipAndLateStream; TestTaskPlanProjectionCommittedPerGeneration
// Impact: python -B scripts/code-atlas.py show Core/workspace_tasks_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func childSnapshot(t *testing.T, w *Workspace, id string) map[string]any {
	t.Helper()
	v, err := w.taskSnapshot(id, WorkspaceCursor{})
	if err != nil {
		t.Fatal(err)
	}
	return v.(map[string]any)
}

func TestTaskRawHashRetriesOwnershipAndLateStream(t *testing.T) {
	var requests atomic.Int32
	w, dir := testWorkspace(t, func(rw http.ResponseWriter, r *http.Request) { requests.Add(1); fixtureAnswer(rw, "task", "done", nil) })
	r, err := w.manager.Create(context.Background(), w.state.ID, AgentSpec{RequestID: "first", ModelID: "local-model", Task: "one", Workdir: dir})
	if err != nil {
		t.Fatal(err)
	}
	r, err = w.manager.Wait(context.Background(), w.state.ID, r.ID, 10000)
	if err != nil || r.State != "completed" {
		t.Fatal(r, err)
	}
	args := map[string]any{"task_id": r.ID, "request_id": "raw", "generation": 1, "message": "inspect fake-key-only"}
	value, err := w.taskCall(context.Background(), "workspace.task_send", rawJSON(args))
	if err != nil || value.(map[string]any)["message_hash"] != taskMessageHash("inspect fake-key-only") {
		t.Fatal(value, err)
	}
	r, err = w.manager.Wait(context.Background(), w.state.ID, r.ID, 10000)
	if err != nil || r.Generation != 2 || r.Turns["raw"] != "inspect [redacted]" {
		t.Fatal(r, err)
	}
	if _, err = w.taskCall(context.Background(), "workspace.task_send", rawJSON(args)); err != nil {
		t.Fatal("same retry", err)
	}
	args["message"] = "inspect [redacted]"
	if _, err = w.taskCall(context.Background(), "workspace.task_send", rawJSON(args)); err == nil {
		t.Fatal("different raw inputs with same redacted text collided")
	}
	if _, err = w.taskCall(context.Background(), "workspace.task_cancel", rawJSON(map[string]any{"task_id": r.ID, "generation": 1, "request_id": "first"})); err == nil {
		t.Fatal("stale cancellation accepted")
	}
	w.taskRequestStart(r.ID, 2, true)
	w.taskStream(r.ID, 2, Event{Kind: EventDelta, Text: "current"})
	w.taskStream(r.ID, 1, Event{Kind: EventDelta, Text: "OLD"})
	snapshot := childSnapshot(t, w, r.ID)
	if live := snapshot["live"].(map[string]WorkspaceLive)[WorkspaceMatrix]; live.Text != "current" {
		t.Fatal("late stream contaminated current body", live)
	}
	foreign := workspaceID()
	w.manager.mu.Lock()
	w.manager.jobs[foreign] = &agentJob{record: AgentRecord{ID: foreign, Parent: "outside"}}
	w.manager.mu.Unlock()
	if _, err = w.taskSnapshot(foreign, WorkspaceCursor{}); err == nil {
		t.Fatal("unowned child leaked")
	}
	if requests.Load() != 2 {
		t.Fatal("retry executed provider", requests.Load())
	}
}

func TestTaskPlanProjectionCommittedPerGeneration(t *testing.T) {
	var requests atomic.Int32
	w, dir := testWorkspace(t, func(rw http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		n := requests.Add(1)
		if n == 1 || n == 3 {
			if n == 3 && !strings.Contains(string(body["input"]), "The stored plan belongs to an earlier user turn") {
				t.Error("new child turn lost plan boundary")
			}
			args := map[string]any{"summary": "核对分裂任务", "plan": []any{map[string]any{"id": "check", "description": "核对当前输入", "status": "in_progress"}}}
			if n == 3 {
				args["new_task"] = true
				args["summary"] = "处理下一任务"
			}
			id := fmt.Sprintf("plan-%d", n)
			fixtureAnswer(rw, id, "", []any{map[string]any{"type": "function_call", "id": "fc-" + id, "call_id": id, "name": "update_plan", "arguments": string(rawJSON(args))}})
			return
		}
		fixtureAnswer(rw, "reply", "ready", nil)
	})
	primary := initialPlan(t)
	w.workflowPlan = ClonePlan(primary)
	r, err := w.manager.Create(context.Background(), w.state.ID, AgentSpec{RequestID: "plan-first", ModelID: "local-model", Task: "first planned task", Workdir: dir, Tools: []string{"update_plan"}})
	if err != nil {
		t.Fatal(err)
	}
	r, err = w.manager.Wait(context.Background(), w.state.ID, r.ID, 10000)
	if err != nil || r.State != "completed" {
		t.Fatal(r, err)
	}
	first := childSnapshot(t, w, r.ID)["plan"].(*PlanState)
	if first == nil || first.ID == primary.ID {
		t.Fatal("child plan unavailable or shared")
	}
	r, err = w.manager.SendGeneration(w.state.ID, r.ID, "plan-second", "new explicit task", 1)
	if err != nil {
		t.Fatal(err)
	}
	r, err = w.manager.Wait(context.Background(), w.state.ID, r.ID, 10000)
	if err != nil || r.State != "completed" {
		t.Fatal(r, err)
	}
	snapshot := childSnapshot(t, w, r.ID)
	second := snapshot["plan"].(*PlanState)
	if second == nil || second.ID == first.ID || w.workflowPlan.ID != primary.ID {
		t.Fatal("child replaced wrong plan", second)
	}
	if snapshot["plan_scope"].(map[string]any)["generation"] != 2 {
		t.Fatal("wrong plan scope")
	}
	row := snapshot["roles"].([]any)[0].(map[string]any)
	items := row["activity"].(map[string]any)["items"].([]any)
	if len(items) == 0 {
		t.Fatal("actual plan receipt missing")
	}
	for _, item := range items {
		if item.(map[string]any)["generation"] != float64(2) {
			t.Fatal("old receipt leaked", item)
		}
	}
	a, restored, err := RestoreSession(filepath.Join(w.manager.dir, "config.json"), r.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	if restored.WorkspaceGeneration != 2 || restored.Plan.State.ID != second.ID {
		t.Fatal("durable child plan differs")
	}
}
