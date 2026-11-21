// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkspaceGreetingOfflineDeduplicatesAndRetries; TestStartupGreetingUsesAdvertisedReasoningWithoutChangingTaskSettings; TestWorkspaceReportsKeepCompleteContentAndRejectPaths; TestWorkspaceArchivedOutputKeepsBodyIdentityAndText
// Impact: python -B scripts/code-atlas.py show Core/workspace_companion_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestWorkspaceGreetingOfflineDeduplicatesAndRetries(t *testing.T) {
	var calls atomic.Int32
	w, _ := testWorkspace(t, func(rw http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.Error(rw, `{"error":{"message":"invalid test credential"}}`, 401)
	})
	if _, err := w.greet(json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		w.mu.Lock()
		state := w.greeting.State
		w.mu.Unlock()
		if state == "offline" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	w.mu.Lock()
	state := w.greeting.State
	text := w.greeting.Text
	detail := w.greeting.Detail
	w.mu.Unlock()
	if state != "offline" || text != "" {
		t.Fatalf("invalid greeting state %s %s", state, text)
	}
	if !strings.Contains(detail, "401") {
		t.Fatal("greeting omitted actionable transport diagnosis", detail)
	}
	for i := 0; i < 3; i++ {
		if _, err := w.greet(json.RawMessage(`{}`)); err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 1 {
		t.Fatal("reload repeated request", calls.Load())
	}
	if _, err := w.greet(json.RawMessage(`{"retry":true}`)); err != nil {
		t.Fatal(err)
	}
	deadline = time.Now().Add(time.Second)
	for calls.Load() < 2 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if calls.Load() != 2 {
		t.Fatal("explicit retry did not request")
	}
}

func TestStartupGreetingUsesAdvertisedReasoningWithoutChangingTaskSettings(t *testing.T) {
	for _, tc := range []struct {
		name   string
		values []string
		want   string
	}{
		{"minimal", []string{"minimal", "low", "high"}, "minimal"},
		{"low", []string{"low", "high"}, "low"},
		{"unsupported-low", []string{"medium", "high"}, "high"},
		{"no-capability", nil, "high"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			settings := Defaults()
			settings.Adapter, settings.Model, settings.ActiveProfile = "openai", "muse-spark-1.3-contributor", "muse-test"
			settings.ModelOptions = map[string]any{"reasoning_effort": "high"}
			settings.APIProfiles = []APIProfile{{ID: settings.ActiveProfile, ParameterSpecs: []ParameterSpec{{Key: "reasoning_effort", Type: "enum", Values: tc.values}}}}
			before, _ := json.Marshal(settings)
			greeting := startupGreetingSettings(settings)
			wire, err := json.Marshal(BuildResponsesRequest(greeting, []Message{{Role: RoleUser, Content: "hi"}}, true, nil))
			if err != nil {
				t.Fatal(err)
			}
			var request map[string]any
			if err = json.Unmarshal(wire, &request); err != nil {
				t.Fatal(err)
			}
			reasoning, _ := request["reasoning"].(map[string]any)
			if reasoning["effort"] != tc.want || request["max_output_tokens"] != float64(1536) || request["tool_choice"] != nil {
				t.Fatalf("wrong startup request: %s", wire)
			}
			after, _ := json.Marshal(settings)
			if string(before) != string(after) {
				t.Fatal("startup request changed user's task settings")
			}
		})
	}
}

func TestWorkspaceReportsKeepCompleteContentAndRejectPaths(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("report made model request") })
	full := "# 正文\n\n" + strings.Repeat("完整保留。", 150)
	result, err := w.report(rawJSON(map[string]any{"title": "记录", "format": "md", "content": full}))
	if err != nil {
		t.Fatal(err)
	}
	doc := result.(map[string]any)["document"].(WorkspaceDocument)
	got, err := w.readDocument(doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.(map[string]any)["content"] != full {
		t.Fatal("lost document bytes")
	}
	if _, err = w.readDocument("../../config"); err == nil {
		t.Fatal("path accepted")
	}
	if _, err = w.report(rawJSON(map[string]any{"format": "js", "content": "bad"})); err == nil {
		t.Fatal("active format accepted")
	}
	w.recordOutput(WorkspaceMatrix, full, "completed")
	w.mu.Lock()
	last := w.state.Messages[len(w.state.Messages)-1]
	w.mu.Unlock()
	if last.Text != full || last.DocumentID == "" {
		t.Fatal("report replaced the complete visible reply")
	}
	data, err := os.ReadFile(filepath.Join(w.dir, "documents", last.DocumentID+".md"))
	if err != nil || string(data) != full {
		t.Fatal("fallback did not persist exact text", err)
	}
}

func TestWorkspaceArchivedOutputKeepsBodyIdentityAndText(t *testing.T) {
	for _, state := range []string{"commentary", "completed", "failed", "timed_out", "persistence_failed"} {
		t.Run(state, func(t *testing.T) {
			w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("archive made model request") })
			full := "# 真实输出\n\n" + strings.Repeat("完整正文和工具证据必须可读。\n", 60)
			w.mu.Lock()
			w.live[WorkspaceMatrix] = WorkspaceLive{BodyID: "visible-body", Generation: 2, Text: full}
			err := w.recordOutputLocked(WorkspaceMatrix, full, state, 2)
			last := w.state.Messages[len(w.state.Messages)-1]
			w.mu.Unlock()
			if err != nil || last.ID != "visible-body" || last.Text != full || last.Generation != 2 || last.State != state || last.DocumentID == "" {
				t.Fatalf("body changed at archive boundary: state=%s err=%v", state, err)
			}
			data, err := os.ReadFile(filepath.Join(w.dir, "documents", last.DocumentID+".md"))
			if err != nil || string(data) != full {
				t.Fatal("archive lost output", err)
			}
		})
	}
}
