// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestTranscriptOutboxSurvivesUnavailableStoreAndWorkspaceRecovery; TestTranscriptOutboxReadFailureRetainsNewRows; TestReopenedHistoryProjectsSupplementWithoutChangingOriginal
// Impact: python -B scripts/code-atlas.py show Core/workspace_transcript_outbox_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestTranscriptOutboxSurvivesUnavailableStoreAndWorkspaceRecovery(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model call") })
	w := modeWorkspace(t, m.config, dir, HostOS)
	w.service = NewSettingsService(m.config)
	w.service.Close()
	key := w.state.ID + "/outbox-test"
	rows := transcriptRows(key, 0, []Message{{Role: RoleUser, Content: "original tail before failure"}}, nil)
	w.transcribe(rows)
	w.flushTranscript(time.Second)
	files, err := os.ReadDir(w.transcriptOutboxDirectory())
	if err != nil || len(files) != 1 {
		t.Fatalf("failed write lost originals: %v %v", files, err)
	}
	w.fast.mu.Lock()
	pending := len(w.fast.outbox)
	problem := w.fast.writeError
	w.fast.mu.Unlock()
	if pending != 1 || problem == "" {
		t.Fatal("failed write acknowledged")
	}
	oldRuntime, oldID := w.dir, w.state.ID
	w.Close()
	if _, err := os.Stat(oldRuntime); !os.IsNotExist(err) {
		t.Fatal("normal close did not remove ephemeral runtime", err)
	}
	service := NewSettingsService(m.config)
	defer service.Close()
	host := NewWorkspaceHost(m.config, "", "")
	if err := host.SetMode(HostOS); err != nil {
		t.Fatal(err)
	}
	recovered, err := newWorkspace(m.config, "", dir, "", service, host)
	if err != nil {
		t.Fatal(err)
	}
	defer recovered.Close()
	if recovered.state.ID == oldID {
		t.Fatal("recovery must use a new workspace identity")
	}
	// Startup must replay by itself, before any new conversation or flush call.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		files, err = os.ReadDir(recovered.transcriptOutboxDirectory())
		if err == nil && len(files) == 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	files, err = os.ReadDir(recovered.transcriptOutboxDirectory())
	if err != nil || len(files) != 0 {
		t.Fatal("successful replay did not acknowledge", err)
	}
	raw, err := recovered.memory(context.Background(), map[string]any{"action": "pac_message", "key": key, "position": 0})
	if err != nil || !strings.Contains(string(raw), "original tail before failure") {
		t.Fatalf("original unavailable: %s %v", raw, err)
	}
	// A duplicate observer notification can replay without orphaning the queue.
	recovered.transcribe(rows)
	recovered.transcribe(rows)
	recovered.flushTranscript(3 * time.Second)
	recovered.fast.mu.Lock()
	defer recovered.fast.mu.Unlock()
	if len(recovered.fast.outbox) != 0 || recovered.fast.writeError != "" {
		t.Fatal("duplicate caused permanent queue failure", recovered.fast.outbox, recovered.fast.writeError)
	}
}

func TestTranscriptOutboxReadFailureRetainsNewRows(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model call") })
	w := modeWorkspace(t, m.config, dir, HostOS)
	w.service = NewSettingsService(m.config)
	defer w.service.Close()
	outbox := w.transcriptOutboxDirectory()
	if err := os.MkdirAll(filepath.Dir(outbox), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(outbox, []byte("unavailable directory"), 0600); err != nil {
		t.Fatal(err)
	}
	key := w.state.ID + "/read-failure"
	w.transcribe(transcriptRows(key, 0, []Message{{Role: RoleUser, Content: "retained after directory failure"}}, nil))
	w.fast.mu.Lock()
	pending, problem := len(w.fast.queue), w.fast.writeError
	w.fast.mu.Unlock()
	if pending != 1 || problem == "" {
		t.Fatal("new original lost on directory read failure")
	}
	if err := os.Remove(outbox); err != nil {
		t.Fatal(err)
	}
	w.flushTranscript(3 * time.Second)
	raw, err := w.memory(context.Background(), map[string]any{"action": "pac_message", "key": key, "position": 0})
	if err != nil || !strings.Contains(string(raw), "retained after directory failure") {
		t.Fatalf("retained original not recovered: %s %v", raw, err)
	}
}

func TestReopenedHistoryProjectsSupplementWithoutChangingOriginal(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model call") })
	w := modeWorkspace(t, m.config, dir, HostOS)
	w.service = NewSettingsService(m.config)
	defer w.service.Close()
	content := "【你工作时用户补充了 1 条】\n[User supplements: preserve the existing objective unless a message explicitly cancels or replaces it]\n1. 中文答复，继续原任务"
	rows := transcriptRows("previous-session/agent", 0, []Message{{Role: RoleUser, Name: "workspace_previous", Content: content}, {Role: RoleUser, Content: content}}, nil)
	w.transcribe(rows)
	w.flushTranscript(3 * time.Second)
	history, err := w.memoryHistory("", 20)
	if err != nil || len(history) != 2 {
		t.Fatalf("history missing: %v %v", history, err)
	}
	for _, row := range history {
		original, _, err := w.memoryHistoryOriginal(row.ID)
		if err != nil || original != content {
			t.Fatal("projection changed original", original, err)
		}
		if strings.HasSuffix(row.ID, ":000000000000") {
			if row.Text != "中文答复，继续原任务" || !row.TextMore {
				t.Fatal("host routing wrapper leaked", row)
			}
		} else if row.Text != content || row.TextMore {
			t.Fatal("ordinary user text was rewritten", row)
		}
	}
}
