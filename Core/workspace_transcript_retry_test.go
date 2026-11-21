// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestTranscriptOutboxBadBatchDoesNotBlockHealthyOriginals
// Impact: python -B scripts/code-atlas.py show Core/workspace_transcript_retry_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestTranscriptOutboxBadBatchDoesNotBlockHealthyOriginals(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model call") })
	w := modeWorkspace(t, m.config, dir, HostOS)
	w.service = NewSettingsService(m.config)
	defer w.service.Close()
	outbox := w.transcriptOutboxDirectory()
	if err := os.MkdirAll(outbox, 0700); err != nil {
		t.Fatal(err)
	}
	bad := filepath.Join(outbox, "00000000000000000000-invalid.json")
	if err := os.WriteFile(bad, []byte("interrupted legacy batch"), 0600); err != nil {
		t.Fatal(err)
	}
	key := w.state.ID + "/healthy-original"
	w.transcribe(transcriptRows(key, 0, []Message{{Role: RoleUser, Content: "healthy original behind a bad batch"}}, nil))
	w.flushTranscript(3 * time.Second)
	raw, err := w.memory(context.Background(), map[string]any{"action": "pac_message", "key": key, "position": 0})
	if err != nil || !strings.Contains(string(raw), "healthy original behind a bad batch") {
		t.Fatalf("one bad batch blocked unrelated durable originals: %s %v", raw, err)
	}
	if data, err := os.ReadFile(bad); err != nil || string(data) != "interrupted legacy batch" {
		t.Fatal("failed batch was discarded or rewritten", err)
	}
	w.fast.mu.Lock()
	pending, problem := len(w.fast.outbox), w.fast.writeError
	w.fast.mu.Unlock()
	if pending != 1 || problem == "" {
		t.Fatal("remaining bad batch must stay visible and retryable", pending, problem)
	}
	// Repair the original file in place. The next retry must acknowledge it,
	// without duplicating or losing the previously successful batch.
	rows := transcriptRows(w.state.ID+"/repaired-original", 0, []Message{{Role: RoleUser, Content: "repaired original"}}, nil)
	scope := fmt.Sprintf("project:%x", sha256.Sum256([]byte(strings.ToLower(filepath.Clean(dir)))))
	if err := os.WriteFile(bad, rawJSON(transcriptEnvelope{Project: scope, Session: w.state.ID, Rows: rows}), 0600); err != nil {
		t.Fatal(err)
	}
	w.flushTranscript(3 * time.Second)
	files, err := os.ReadDir(outbox)
	if err != nil || len(files) != 0 {
		t.Fatal("repaired batch did not recover", files, err)
	}
	w.fast.mu.Lock()
	defer w.fast.mu.Unlock()
	if w.fast.writeError != "" || len(w.fast.outbox) != 0 {
		t.Fatal("successful recovery kept stale failure state")
	}
}
