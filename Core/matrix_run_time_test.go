// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestRunTimeFirstExecutionParallelAndPreparation; TestRunTimeWaitResumeOfflineAndRollback; TestRunTimeExecutionCellStartsAtNestedDispatchAndNeverReplay; TestRunTimeHumanReplyKeepsGenerationAndObservedInterval; TestRunTimeToolRoundtripNewTurnAndPureChat; TestRunTimeHumanWaitCancelAndRestart; TestRunTimeFinalMessageAndOSPrivacy
// Impact: python -B scripts/code-atlas.py show Core/matrix_run_time_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestRunTimeFirstExecutionParallelAndPreparation(t *testing.T) {
	j := &agentJob{}
	var calls []ToolCall
	for i, c := range []struct{ name, args string }{
		{"update_plan", `{}`}, {"memory", `{}`}, {"toolbox", `{"action":"open","name":"browser"}`},
		{"toolbox", `{"action":"call","name":"compact"}`}, {"toolbox", `{"action":"call","name":"human"}`},
		{"exec_command", `{}`}, {"apply_patch", `{}`}, {"toolbox", `{"action":"call","name":"browser"}`},
	} {
		calls = append(calls, ToolCall{ID: fmt.Sprint(i), Function: FunctionCall{Name: c.name, Arguments: c.args}})
	}
	observe := j.toolStartObserver("response", calls)
	for i := 0; i < 5; i++ {
		observe(fmt.Sprint("response:", i))
	}
	checkpointRunTime(j, time.Now().UnixMilli(), false)
	if j.record.RunTime != nil {
		t.Fatal("preparation started execution timer")
	}
	var group sync.WaitGroup
	for i := 5; i < 8; i++ {
		group.Add(1)
		go func(i int) { defer group.Done(); observe(fmt.Sprint("response:", i)) }(i)
	}
	group.Wait()
	start := j.runStarted.Load()
	if start == 0 {
		t.Fatal("actual execution did not start timer")
	}
	observe("response:5")
	checkpointRunTime(j, start+5000, false)
	frozen := cloneRunTime(j.record.RunTime)
	checkpointRunTime(j, start+15000, true)
	if j.record.RunTime.ElapsedMS != 15000 || len(j.record.RunTime.Intervals) != 1 || frozen.ElapsedMS != 5000 || frozen.Intervals[0].FinishedAt != start+5000 {
		t.Fatal("first dispatch or snapshot isolation lost", j.record.RunTime, frozen)
	}
}

func TestRunTimeWaitResumeOfflineAndRollback(t *testing.T) {
	j := &agentJob{record: AgentRecord{State: "waiting_user"}}
	j.runStarted.Store(1000)
	checkpointRunTime(j, 6000, false)
	// Same-process human waiting is part of this wall-clock interval.
	checkpointRunTime(j, 10000, false)
	if j.record.RunTime.ElapsedMS != 9000 {
		t.Fatal(j.record.RunTime)
	}
	loaded := &agentJob{record: copyRecord(j.record)}
	recoverRunTime(loaded, 100000)
	checkpointRunTime(loaded, 104000, true)
	if loaded.record.RunTime.ElapsedMS != 13000 || !loaded.record.RunTime.Incomplete || len(loaded.record.RunTime.Intervals) != 2 {
		t.Fatal("offline gap was counted", loaded.record.RunTime)
	}
	checkpointRunTime(loaded, 200000, true)
	if loaded.record.RunTime.ElapsedMS != 13000 {
		t.Fatal("finished duration changed")
	}
	rollback := &agentJob{record: copyRecord(j.record)}
	recoverRunTime(rollback, 9000)
	checkpointRunTime(rollback, 8000, true)
	if rollback.record.RunTime.ElapsedMS != 9000 || rollback.record.RunTime.Intervals[1].StartedAt != 10000 {
		t.Fatal("clock rollback invented duration")
	}
	interrupted := &agentJob{record: copyRecord(j.record)}
	interrupted.record.State = "running"
	recoverRunTime(interrupted, 100000)
	checkpointRunTime(interrupted, 104000, true)
	if interrupted.record.RunTime.ElapsedMS != 9000 || !interrupted.record.RunTime.Incomplete {
		t.Fatal("interrupted task was auto-resumed")
	}
}

func TestRunTimeExecutionCellStartsAtNestedDispatchAndNeverReplay(t *testing.T) {
	m := shellTestManager(t)
	j := &agentJob{}
	engine := &PlanEngine{}
	persist := func(string, any) error { return nil }
	delay := 30000
	for i, code := range []string{
		`store("prepared", {value: 1}); text(load("prepared"));`,
		`text(await tools.apply_patch("*** Begin Patch\n*** Add File: nested-time.txt\n+proof\n*** End Patch"));`,
	} {
		call := executionCall("exec", ExecRequest{Code: code, YieldTimeMS: &delay})
		invocation := fmt.Sprint("cell-time-", i)
		ctx := context.WithValue(context.Background(), nestedExecutionObserverKey{}, j.startExecution)
		ctx = WithToolStartedObserver(ctx, j.toolStartObserver(invocation, []ToolCall{call}))
		response := Message{Role: RoleAssistant, ToolCalls: []ToolCall{call}}
		turn, err := ExecuteToolTurn(ctx, engine, m, response, invocation, persist)
		if err != nil || len(turn.Receipts) != 1 {
			t.Fatal(turn, err)
		}
		var result ExecResult
		if err = json.Unmarshal([]byte(turn.Receipts[0].Output), &result); err != nil || !result.OK || result.State != "completed" {
			t.Fatalf("cell failed: %+v %v", result, err)
		}
		if (j.runStarted.Load() != 0) != (i == 1) {
			t.Fatalf("preparation/execution boundary incorrect at cell %d", i)
		}
		checkpointRunTime(j, time.Now().UnixMilli(), true)
		replay, err := ExecuteToolTurn(ctx, engine, m, response, invocation, persist)
		if err != nil || !replay.Replayed || j.runStarted.Load() != 0 {
			t.Fatal("receipt replay restarted execution", replay, err)
		}
	}
}

func TestRunTimeHumanReplyKeepsGenerationAndObservedInterval(t *testing.T) {
	m, r, _ := waitingHuman(t)
	m.mu.Lock()
	j := m.jobs[r.ID]
	j.runStarted.Store(time.Now().Add(-5 * time.Second).UnixMilli())
	err := m.saveLocked(j)
	m.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.ReplyHuman(testMatrixOwner, humanTestReply(r)); err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "completed" || r.Generation != 1 || r.RunTime == nil || len(r.RunTime.Intervals) != 1 || r.RunTime.ElapsedMS < 5000 || r.RunTime.Incomplete {
		t.Fatalf("human reply lost original timer: %+v %v", r, err)
	}
	completed, err := time.Parse(time.RFC3339Nano, r.CompletedAt)
	if err != nil || r.RunTime.Intervals[0].FinishedAt != completed.UnixMilli() {
		t.Fatal("timer extended beyond completion", r.RunTime, r.CompletedAt)
	}
}

func TestRunTimeToolRoundtripNewTurnAndPureChat(t *testing.T) {
	var requests atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 1 {
			fixtureAnswer(w, "r1", "", []any{map[string]any{"type": "function_call", "id": "fc1", "call_id": "c1", "name": "apply_patch", "arguments": `{"patch":"*** Begin Patch\n*** Add File: timing.txt\n+proof\n*** End Patch"}`}})
			return
		}
		fixtureAnswer(w, fmt.Sprint("r", requests.Load()), "Complete", nil)
	})
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "run-time", ModelID: "local-model", Task: "write proof", Prompt: "fixture", Workdir: dir, Tools: []string{"apply_patch"}})
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "completed" || r.RunTime == nil || len(r.RunTime.Intervals) != 1 || r.SubmittedAt == "" || r.CompletedAt == "" {
		t.Fatalf("%+v %v", r, err)
	}
	if _, err = os.Stat(filepath.Join(dir, "timing.txt")); err != nil {
		t.Fatal(err)
	}
	first := copyRecord(r)
	if _, err = m.Send(testMatrixOwner, r.ID, "chat-only", "just reply"); err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.RunTime != nil || r.Generation != 2 || r.SubmittedAt == first.SubmittedAt || len(r.History) != 1 || r.History[0].RunTime == nil || r.History[0].CompletedAt != first.CompletedAt {
		t.Fatalf("new turn timing %+v %v", r, err)
	}
	m.Close()
	next, err := NewAgentManager(m.config, testMatrixOwner, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer next.Close()
	loaded, err := next.Status(testMatrixOwner, r.ID)
	if err != nil || loaded.CompletedAt != r.CompletedAt || loaded.History[0].RunTime.Incomplete || requests.Load() != 3 {
		t.Fatalf("completed recovery %+v %v", loaded, err)
	}
}

func TestRunTimeHumanWaitCancelAndRestart(t *testing.T) {
	for _, restart := range []bool{false, true} {
		t.Run(fmt.Sprint("restart=", restart), func(t *testing.T) {
			m, r, requests := waitingHuman(t)
			if r.RunTime != nil {
				t.Fatal("human-only preparation became execution")
			}
			// Start an observed execution interval before the already verified
			// human boundary, without sleeping for a wall-clock test.
			m.mu.Lock()
			j := m.jobs[r.ID]
			j.runStarted.Store(time.Now().Add(-5 * time.Second).UnixMilli())
			err := m.saveLocked(j)
			m.mu.Unlock()
			if err != nil {
				t.Fatal(err)
			}
			if restart {
				m.Close()
				m, err = NewAgentManager(m.config, testMatrixOwner, nil)
				if err != nil {
					t.Fatal(err)
				}
				defer m.Close()
			}
			if err = m.Cancel(testMatrixOwner, r.ID); err != nil {
				t.Fatal(err)
			}
			r, err = m.Status(testMatrixOwner, r.ID)
			if err != nil || r.State != "cancelled" || r.RunTime == nil || r.RunTime.ElapsedMS < 5000 || r.RunTime.Incomplete != restart || len(r.RunTime.Intervals) != 1+map[bool]int{true: 1}[restart] || r.CompletedAt == "" || requests.Load() != 2 {
				t.Fatalf("%+v %v", r, err)
			}
		})
	}
}

func TestRunTimeFinalMessageAndOSPrivacy(t *testing.T) {
	m, dir := matrixTestManager(t, nil)
	w := modeWorkspace(t, m.config, dir, HostOS)
	w.mu.Lock()
	defer w.mu.Unlock()
	id := workspaceID()
	r := AgentRecord{ID: id, Parent: w.state.ID, Depth: 1, Generation: 1, State: "completed", Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix}, RunTime: &AgentRunTime{Intervals: []AgentRunInterval{{StartedAt: 1000, FinishedAt: 6000}}, ElapsedMS: 5000}, SubmittedAt: "2026-10-02T01:00:00Z", CompletedAt: "2026-10-02T01:00:05Z"}
	w.manager.mu.Lock()
	w.manager.jobs[id] = &agentJob{record: r}
	w.manager.mu.Unlock()
	w.state.Roles[WorkspaceMatrix] = id
	w.state.Messages = append(w.state.Messages, workspaceMessage{ID: "timed-request", From: "user", To: WorkspaceMatrix, Generation: 1, State: "delivered", Text: "run proof"})
	if err := w.recordOutputLocked(WorkspaceMatrix, "done", "completed", 1); err != nil {
		t.Fatal(err)
	}
	if len(w.state.Messages) != 2 {
		t.Fatalf("expected complete chat round, got %d messages", len(w.state.Messages))
	}
	if v := w.state.Messages[len(w.state.Messages)-1]; v.RunTime == nil || v.RunTime.ElapsedMS != 5000 || v.TurnID != "timed-request" || v.At != r.CompletedAt {
		t.Fatal(v)
	}
	w.manager.mu.Lock()
	err := w.manager.saveLocked(w.manager.jobs[id])
	w.manager.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(w.manager.dir, id+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var saved map[string]any
	if err = json.Unmarshal(b, &saved); err != nil {
		t.Fatal(err)
	}
	if saved["run_time"] != nil || saved["submitted_at"] != nil {
		t.Fatal("OS ephemeral conversation leaked to parent record")
	}
}
