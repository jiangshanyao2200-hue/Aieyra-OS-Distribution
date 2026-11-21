// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkspaceDispatchFailurePersistsWithoutReplay; TestWorkspaceReviewParsesTimestampPrecision; TestWorkspaceEmptyOutputPersistsCompletion; TestWorkspacePromptReloadKeepsSettingsPrecedence; TestWorkspaceSnapshotExpiresHumanWithoutModel; TestWorkspaceRecoveryReconcilesDeliveredReceiptsWithoutReplay
// Impact: python -B scripts/code-atlas.py show Core/workspace_delivery_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWorkspaceDispatchFailurePersistsWithoutReplay(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("rejected assignment called model") })
	w.mu.Lock()
	w.prompt = strings.Repeat("x", 33<<10)
	w.mu.Unlock()
	if _, err := w.Send("invalid-assignment", "A valid user message"); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	var message workspaceMessage
	for time.Now().Before(deadline) {
		w.mu.Lock()
		message = w.state.Messages[0]
		w.mu.Unlock()
		if message.State == "failed" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if message.State != "failed" || message.Error == "" {
		t.Fatalf("permanent failure stayed queued: %+v", message)
	}
	w.mu.Lock()
	w.prompt = ""
	w.mu.Unlock()
	time.Sleep(300 * time.Millisecond)
	if len(w.manager.List(w.state.ID)) != 0 {
		t.Fatal("failed work was silently retried")
	}
	duplicate, err := w.Send(message.ID, message.Text)
	if err != nil || duplicate.State != "failed" {
		t.Fatal("duplicate changed failed request", duplicate, err)
	}
	data, err := os.ReadFile(filepath.Join(w.dir, "workspace.json"))
	var saved workspaceState
	if err != nil || json.Unmarshal(data, &saved) != nil || saved.Messages[0].Error == "" || saved.Messages[0].State != "failed" {
		t.Fatal("dispatch error not durable", err)
	}
	status, err := w.controlStatus(message.ID)
	if err != nil || status.(map[string]any)["error"] != message.Error {
		t.Fatal("Control omitted failure evidence", status, err)
	}
	if _, err = w.controlCancel(message.ID); err == nil {
		t.Fatal("failed request accepted as active cancellation")
	}
	events, _, _ := w.feed.read(0)
	count := 0
	for _, event := range events {
		if event.Kind == "error" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("expected one visible failure event, got %d", count)
	}
}

func TestWorkspaceReviewParsesTimestampPrecision(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("review called model") })
	w.mu.Lock()
	w.state.Roles[WorkspaceExecution] = "review-exec"
	w.mu.Unlock()
	for _, tc := range []struct {
		name, read, delivered string
		accepted              bool
	}{
		{"fraction after whole second", "2026-09-24T01:02:03.1Z", "2026-09-24T01:02:03Z", true},
		{"whole second before fraction", "2026-09-24T01:02:03Z", "2026-09-24T01:02:03.1Z", false},
		{"equivalent offsets", "2026-09-24T02:02:03+01:00", "2026-09-24T01:02:03Z", true},
		{"invalid read", "invalid", "2026-09-24T01:02:03Z", false},
		{"invalid delivery", "2026-09-24T01:02:03Z", "invalid", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w.mu.Lock()
			w.state.LastRead = tc.read
			w.mu.Unlock()
			w.manager.mu.Lock()
			w.manager.jobs["review-exec"] = &agentJob{record: AgentRecord{ID: "review-exec", Parent: w.state.ID, State: "completed", Generation: 1, Updated: tc.delivered}}
			w.manager.mu.Unlock()
			_, err := w.team(context.Background(), WorkspaceProject, rawJSON(map[string]any{"action": "review", "role": "execution", "generation": 1, "verdict": "accepted", "evidence": "Read current artifact"}))
			if (err == nil) != tc.accepted {
				t.Fatalf("accepted=%v error=%v", tc.accepted, err)
			}
		})
	}
}

func TestWorkspaceEmptyOutputPersistsCompletion(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) {})
	w.mu.Lock()
	w.state.Messages = append(w.state.Messages, workspaceMessage{ID: "empty-result", From: "user", To: WorkspaceMatrix, State: "delivered"})
	w.mu.Unlock()
	w.recordOutput(WorkspaceMatrix, "", "completed")
	data, err := os.ReadFile(filepath.Join(w.dir, "workspace.json"))
	var saved workspaceState
	if err != nil || json.Unmarshal(data, &saved) != nil || saved.Messages[0].State != "completed" {
		t.Fatal("empty final output lost completion state", err)
	}
}

func TestWorkspacePromptReloadKeepsSettingsPrecedence(t *testing.T) {
	w, dir := testWorkspace(t, func(http.ResponseWriter, *http.Request) {})
	w.host = &WorkspaceHost{promptDir: dir}
	settings := &Settings{}
	file := filepath.Join(dir, "工作.txt")
	for _, body := range []string{"First instructions", "Updated instructions"} {
		if err := os.WriteFile(file, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		prompt, err := w.requestPrompt(settings)
		if err != nil || !strings.Contains(prompt, body) {
			t.Fatal("current prompt file not loaded", prompt, err)
		}
	}
	settings.SystemPrompt = "Explicit current configuration"
	prompt, err := w.requestPrompt(settings)
	if err != nil || prompt != settings.SystemPrompt {
		t.Fatal("configured prompt precedence changed", prompt, err)
	}
}

func TestWorkspaceSnapshotExpiresHumanWithoutModel(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("expired question called model") })
	id := workspaceID()
	w.mu.Lock()
	w.state.Roles[WorkspaceMatrix] = id
	w.mu.Unlock()
	w.manager.mu.Lock()
	w.manager.jobs[id] = &agentJob{record: AgentRecord{
		ID: id, Parent: w.state.ID, Depth: 1, State: "waiting_user", Generation: 1,
		Spec:          AgentSpec{WorkspaceRole: WorkspaceMatrix, ModelID: "local-model"},
		HumanRequests: []HumanRequest{{ID: "expired-choice", State: "waiting_user", Generation: 1, ExpiresAt: time.Now().Add(-time.Second).UTC().Format(time.RFC3339Nano)}},
	}}
	w.manager.mu.Unlock()
	if _, err := w.Snapshot(0); err != nil {
		t.Fatal(err)
	}
	record, err := w.manager.Status(w.state.ID, id)
	if err != nil || record.State != "timed_out" || record.HumanRequests[0].State != "expired" {
		t.Fatal("snapshot did not expire pending human request", record, err)
	}
}

func TestWorkspaceRecoveryReconcilesDeliveredReceiptsWithoutReplay(t *testing.T) {
	for _, tc := range []struct {
		name, state, want string
		generation        int
	}{
		{"crashed running", "running", "interrupted", 7},
		{"finished before message save", "completed", "completed", 7},
		{"failed before message save", "failed", "failed", 7},
		{"cancelled before message save", "cancelled", "cancelled", 7},
		{"new generation cannot settle old message", "completed", "interrupted", 8},
		{"pending human stays bound", "waiting_user", "delivered", 7},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w, dir := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("recovery replayed a model request") })
			w.Close()
			id := workspaceID()
			w.state.Roles[WorkspaceMatrix] = id
			w.state.Messages = []workspaceMessage{{ID: "durable-request", From: "user", To: WorkspaceMatrix, Text: "A side effect may already exist", State: "delivered", Generation: 7}, {ID: "queued-request", From: "user", To: WorkspaceMatrix, Text: "Not yet started", State: "queued"}, {ID: "old-steering", From: "user", To: WorkspaceMatrix, Text: "Historical supplement must not resume", State: "context"}}
			if err := w.saveLocked(); err != nil {
				t.Fatal(err)
			}
			record := AgentRecord{ID: id, Parent: w.state.ID, Depth: 1, State: tc.state, Generation: tc.generation, Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix}, Turns: map[string]string{}}
			payload, _ := json.Marshal(record)
			if err := os.WriteFile(filepath.Join(w.manager.dir, id+".json"), payload, 0600); err != nil {
				t.Fatal(err)
			}
			restored, err := NewWorkspace(w.config, w.state.ID, dir, "", nil)
			if err != nil {
				t.Fatal(err)
			}
			defer restored.Close()
			duplicate, err := restored.Send("durable-request", "A side effect may already exist")
			if err != nil || duplicate.State != tc.want {
				t.Fatalf("restored duplicate: %+v, %v; want %s", duplicate, err, tc.want)
			}
			if tc.want == "interrupted" && duplicate.Error == "" {
				t.Fatal("interruption omitted recovery guidance")
			}
			status, err := restored.controlStatus("durable-request")
			if err != nil || tc.want == "interrupted" && status.(map[string]any)["state"] != "interrupted" {
				t.Fatal("Control reported stale running status", status, err)
			}
			data, err := os.ReadFile(filepath.Join(restored.dir, "workspace.json"))
			var saved workspaceState
			if err != nil || json.Unmarshal(data, &saved) != nil || saved.Messages[0].State != tc.want || saved.Messages[1].State != "interrupted" || saved.Messages[2].State != "interrupted" {
				t.Fatal("recovery status was not persisted", err)
			}
		})
	}
}
