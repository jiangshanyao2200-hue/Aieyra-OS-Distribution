// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkspaceUsageReceiptsPreserveUnknownAndRetryCache; TestWorkspaceOpenCurrentSessionDoesNotDeadlockAndFeedsOnlySource; TestContextCompressionSurvivesCheckpointAndRecordCopies; TestWorkspaceRoleSnapshotIsolatedFromFullHistory; TestWorkspaceExecutionBoundaryUsesDispatchWithoutMutatingCheckpoint; BenchmarkWorkspaceRoleStatusLongHistory
// Impact: python -B scripts/code-atlas.py show Core/workspace_status_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestWorkspaceUsageReceiptsPreserveUnknownAndRetryCache(t *testing.T) {
	var usage Usage
	if err := json.Unmarshal([]byte(`{"prompt_tokens":100,"completion_tokens":20,"prompt_tokens_details":{"cached_tokens":0}}`), &usage); err != nil {
		t.Fatal(err)
	}
	retry := agentUsage(1, "model:retry:network", time.Second, &usage)
	if retry.Cached == nil || *retry.Cached != 0 || !retry.Reported {
		t.Fatal("reported zero cache was lost", retry)
	}
	report := workspaceUsage([]AgentUsage{retry})
	if report["cached_known"] != true || report["complete"] != true || report["input_tokens"] != 100 {
		t.Fatal(report)
	}
	report = workspaceUsage([]AgentUsage{retry, agentUsage(2, "model", time.Second, nil)})
	if report["cached_known"] != false || report["complete"] != false || report["input_tokens"] != 100 {
		t.Fatal(report)
	}
	if report["cache_reported"] != 1 || report["cache_input_tokens"] != 100 || report["cached_tokens"] != 0 {
		t.Fatal("partial known cache must remain visible", report)
	}
}

func TestWorkspaceOpenCurrentSessionDoesNotDeadlockAndFeedsOnlySource(t *testing.T) {
	w, dir := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("switching sessions called model") })
	h := NewWorkspaceHost(w.config, "", dir)
	t.Cleanup(h.Close)
	descriptor, err := h.Open("", dir)
	if err != nil {
		t.Fatal(err)
	}
	id := descriptor["session_id"].(string)
	owned := h.workspaces[id]
	done := make(chan error, 1)
	go func() {
		_, err := owned.configure(WorkspaceMatrix, rawJSON(map[string]any{"action": "open_session", "session_id": id}))
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("session activation deadlocked")
	}
	events, _, _ := owned.feed.read(0)
	if len(events) != 1 || events[0].Kind != "activate_session" {
		t.Fatal(events)
	}
	_, err = owned.Call(context.Background(), "workspace.open", rawJSON(map[string]any{"workdir": dir}))
	if err != nil {
		t.Fatal(err)
	}
	for other, workspace := range h.workspaces {
		if other == id {
			continue
		}
		foreign, _, _ := workspace.feed.read(0)
		if len(foreign) != 0 {
			t.Fatal("activation leaked into another session", foreign)
		}
	}
}

func TestContextCompressionSurvivesCheckpointAndRecordCopies(t *testing.T) {
	cp := &Checkpoint{Covered: 4, Compression: &ContextCompression{BeforeTokens: 2000, AfterTokens: 450}}
	data, err := json.Marshal(cp)
	if err != nil {
		t.Fatal(err)
	}
	var restored Checkpoint
	if err = json.Unmarshal(data, &restored); err != nil {
		t.Fatal(err)
	}
	r := copyRecord(AgentRecord{Compression: restored.Compression})
	if r.Compression == cp.Compression || r.Compression.BeforeTokens != 2000 || r.Compression.AfterTokens != 450 {
		t.Fatal("compression receipt did not survive recovery")
	}
}

func TestWorkspaceRoleSnapshotIsolatedFromFullHistory(t *testing.T) {
	cached, reasoning := 3, 2
	r := AgentRecord{ID: "task", Parent: "owner", State: "completed", Generation: 9, Spec: AgentSpec{ModelID: "model", Prompt: "private prompt"}, Turns: map[string]string{"turn": "private history"}, Context: &AgentContext{Tokens: 24, Window: 100}, Compression: &ContextCompression{BeforeTokens: 80, AfterTokens: 24}, Usage: []AgentUsage{{Reported: true, Input: 10, Output: 5, Cached: &cached, Reasoning: &reasoning}}, HumanRequests: []HumanRequest{{ID: "question", State: "answered"}}}
	m := &AgentManager{jobs: map[string]*agentJob{"task": {record: r}}}
	row, err := m.workspaceRoleStatus("owner", "task")
	if err != nil || row["usage"].(map[string]any)["input_tokens"] != 10 || row["generation"] != 9 {
		t.Fatal("snapshot lost status", row, err)
	}
	for _, hidden := range []string{"turns", "spec", "history", "result", "prompt"} {
		if _, ok := row[hidden]; ok {
			t.Fatal("snapshot exposed full history", hidden)
		}
	}
	row["context"].(*AgentContext).Tokens = 99
	row["compression"].(*ContextCompression).AfterTokens = 99
	row["human_requests"].([]HumanRequest)[0].State = "modified"
	if r.Context.Tokens != 24 || r.Compression.AfterTokens != 24 || r.HumanRequests[0].State != "answered" {
		t.Fatal("snapshot mutates shared runtime state")
	}
	if _, err := m.workspaceRoleStatus("foreign", "task"); err == nil {
		t.Fatal("snapshot bypassed ownership")
	}
}

func TestWorkspaceExecutionBoundaryUsesDispatchWithoutMutatingCheckpoint(t *testing.T) {
	j := &agentJob{record: AgentRecord{ID: "task", Parent: "owner", State: "running", Generation: 1}}
	m := &AgentManager{jobs: map[string]*agentJob{"task": j}}
	read := func(want bool) {
		t.Helper()
		row, err := m.workspaceRoleStatus("owner", "task")
		if err != nil || row["execution_started"] != want {
			t.Fatal("execution boundary lost", row, err)
		}
	}
	read(false)
	prepare := j.toolStartObserver("r", []ToolCall{{ID: "plan", Function: FunctionCall{Name: "update_plan"}}, {ID: "cell", Function: FunctionCall{Name: "exec"}}})
	prepare("r:plan")
	prepare("r:cell")
	read(false)
	ctx := context.WithValue(context.Background(), nestedExecutionObserverKey{}, j.startExecution)
	observeNestedExecution(ctx, ToolCall{Function: FunctionCall{Name: "exec_command"}})
	read(true)
	if j.record.RunTime != nil || j.runCheckpointStart != 0 {
		t.Fatal("status read mutated the durable timer")
	}
	checkpointRunTime(j, j.runStarted.Load()+10, true)
	j.record.State = "completed"
	read(true)
	j.record.State = "waiting_user"
	read(true)
	j.record.Generation++
	j.record.RunTime = nil
	j.record.State = "running"
	read(false)
}

func BenchmarkWorkspaceRoleStatusLongHistory(b *testing.B) {
	r := AgentRecord{ID: "task", Parent: "owner", State: "completed", Generation: 1000, Spec: AgentSpec{ModelID: "model"}, Turns: map[string]string{}}
	for i := 0; i < 1000; i++ {
		r.Turns[fmt.Sprint(i)] = strings.Repeat("request ", 10)
		r.History = append(r.History, AgentOutcome{Generation: i, State: "completed", Result: strings.Repeat("prior answer ", 40)})
		r.Usage = append(r.Usage, AgentUsage{Reported: true, Input: 30, Output: 5})
	}
	m := &AgentManager{jobs: map[string]*agentJob{"task": {record: r}}}
	b.Run("full-record-copy", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			v, err := m.Status("owner", "task")
			if err != nil || v.Generation != 1000 {
				b.Fatal(err)
			}
			_ = workspaceUsage(v.Usage)
		}
	})
	b.Run("display-projection", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			v, err := m.workspaceRoleStatus("owner", "task")
			if err != nil || v["generation"] != 1000 {
				b.Fatal(err)
			}
		}
	})
}
