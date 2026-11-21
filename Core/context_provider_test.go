// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestContextProviderMigrationRetainsBytesScopeRollbackAndReopen; TestContextProviderUnavailableStaleAndWriteFailurePreserveSelection; TestContextProviderArchiveRejectsRewrittenSourceAndCrossSession; TestContextProviderPACMigrationHydratesFullSummary
// Impact: python -B scripts/code-atlas.py show Core/context_provider_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/aieyra/aieyra-os/agent/context/structured"
	contextpolicy "github.com/aieyra/aieyra-os/agent/official/Eyra/context"
	contextport "github.com/aieyra/aieyra-os/contracts/context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestContextProviderMigrationRetainsBytesScopeRollbackAndReopen(t *testing.T) {
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { fixtureAnswer(w, "fixture", "reply", nil) })
	w := modeWorkspace(t, m.config, dir, HostOS)
	contextTestAction(t, w, "new", map[string]any{"title": "a"})
	contextTestTurn(t, w, "完整原文不能被迁移改写")
	w.mu.Lock()
	oldPath := w.contextArchivePath(w.contextSessionLocked().Archive)
	w.mu.Unlock()
	before, err := os.ReadFile(oldPath)
	if err != nil {
		t.Fatal(err)
	}
	v := contextTestAction(t, w, "provider", map[string]any{"provider": structured.Reference})
	w.mu.Lock()
	newPath := w.contextArchivePath(w.contextSessionLocked().Archive)
	w.mu.Unlock()
	after, _ := os.ReadFile(newPath)
	if !bytes.HasPrefix(after, before) || oldPath == newPath {
		t.Fatal("migration rewrote source archive")
	}
	r, err := (&SessionArchive{Path: newPath}).read()
	if err != nil || r.ContextProvider == nil || r.ContextProvider.Provider != structured.Reference {
		t.Fatal(r, err)
	}
	if r.ContextProvider.Session != v["session_id"] {
		t.Fatal("wrong session scope")
	}
	contextTestAction(t, w, "edit", map[string]any{"text": "new working view"})
	w.mu.Lock()
	edited, _ := w.contextArchiveLocked()
	w.mu.Unlock()
	changed, err := edited.read()
	if err != nil || changed.ContextProvider == nil || changed.ContextProvider.Provider != structured.Reference {
		t.Fatal("edit lost pinned provider", err)
	}
	contextTestAction(t, w, "restore", nil)
	w.Close()
	reopened := modeWorkspace(t, m.config, dir, HostOS)
	if !strings.Contains(contextTestView(t, reopened)["text"].(string), "完整原文") {
		t.Fatal("reopen lost source")
	}
	contextTestAction(t, reopened, "restore", nil)
	if got, _ := os.ReadFile(oldPath); !bytes.Equal(got, before) {
		t.Fatal("original archive modified")
	}
}

func TestContextProviderUnavailableStaleAndWriteFailurePreserveSelection(t *testing.T) {
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { fixtureAnswer(w, "fixture", "reply", nil) })
	w := modeWorkspace(t, m.config, dir, HostOS)
	contextTestAction(t, w, "new", nil)
	before := contextTestView(t, w)
	bad := structured.Reference
	bad.Version = "9.0.0"
	for _, args := range []map[string]any{{"source": before["source"], "provider": bad}, {"source": "stale", "provider": structured.Reference}} {
		args["action"] = "provider"
		if _, err := w.contextCall(context.Background(), rawJSON(args)); err == nil {
			t.Fatal("invalid migration accepted")
		}
	}
	file := filepath.Join(w.contextDirectory(), "sessions.json")
	data, _ := os.ReadFile(file)
	if err := os.Rename(file, file+".fixture"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(file, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(file, "block"), []byte("owned fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	_, err := w.contextCall(context.Background(), rawJSON(map[string]any{"action": "provider", "source": before["source"], "provider": structured.Reference}))
	if err == nil {
		t.Fatal("failed pointer write claimed migration")
	}
	if got := contextTestView(t, w); got["source"] != before["source"] {
		t.Fatal("failed migration changed current context")
	}
	if err = os.Remove(filepath.Join(file, "block")); err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(file); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(file+".fixture", file); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(file)
	if !bytes.Equal(got, data) {
		t.Fatal("failed write damaged pointer")
	}
	contextTestAction(t, w, "provider", map[string]any{"provider": structured.Reference})
}

func TestContextProviderArchiveRejectsRewrittenSourceAndCrossSession(t *testing.T) {
	for _, kind := range []string{"source", "scope", "checkpoint"} {
		t.Run(kind, func(t *testing.T) {
			a := &SessionArchive{ephemeral: true}
			m := Message{Role: RoleUser, Content: "keep exact source"}
			if err := a.Append("message", m); err != nil {
				t.Fatal(err)
			}
			state := contextport.State{Schema: 1, Session: "session-a", Provider: structured.Reference}
			first := contextProviderMigration{State: state, Source: contextProviderSource([]Message{m}, nil)}
			if err := a.Append("context_provider", first); err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "source":
				first.Source = "wrong"
			case "scope":
				first.State.Session = "session-b"
			case "checkpoint":
				first.Checkpoint = &Checkpoint{Covered: 1, Packet: "invented"}
			}
			if err := a.Append("context_provider", first); err != nil {
				t.Fatal(err)
			}
			if _, err := a.read(); err == nil {
				t.Fatal("tampered migration accepted")
			}
		})
	}
}

func TestContextProviderPACMigrationHydratesFullSummary(t *testing.T) {
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { fixtureAnswer(w, "fixture", "reply", nil) })
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	s.MemoryEnabled = true
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	w := modeWorkspace(t, m.config, dir, HostOS)
	w.service = NewSettingsService(m.config)
	t.Cleanup(w.service.Close)
	contextTestAction(t, w, "new", map[string]any{"auto_memory": true})
	contextTestTurn(t, w, "long original source")
	w.mu.Lock()
	a, _ := w.contextArchiveLocked()
	w.mu.Unlock()
	r, err := a.read()
	if err != nil {
		t.Fatal(err)
	}
	body := strings.Repeat("完整阶段经历", 1800) + "END_OF_COMPLETE_PACKET"
	id, err := w.sealPAC(context.Background(), "fixture", r.Messages, 0, len(r.Messages), "工作上下文检查点", body, "fixture")
	if err != nil {
		t.Fatal(err)
	}
	cp := pacCheckpoint(nil, r.Messages, 0, len(r.Messages), id, body, nil)
	if err = a.Append("checkpoint", cp); err != nil {
		t.Fatal(err)
	}
	contextTestAction(t, w, "provider", map[string]any{"provider": structured.Reference})
	w.mu.Lock()
	a, _ = w.contextArchiveLocked()
	w.mu.Unlock()
	r, err = a.read()
	if err != nil || r.Checkpoint == nil || len(r.Checkpoint.Imported) != 1 || r.Checkpoint.Imported[0].Content != body || r.Checkpoint.Packet != id {
		t.Fatal("PAC migration truncated or dropped source", err)
	}
	if !strings.Contains(r.Checkpoint.Message().Content, "END_OF_COMPLETE_PACKET") {
		t.Fatal("imported summary absent from actual model projection")
	}
	contextTestAction(t, w, "provider", map[string]any{"provider": contextpolicy.Reference})
	w.mu.Lock()
	a, _ = w.contextArchiveLocked()
	w.mu.Unlock()
	r, err = a.read()
	if err != nil || r.ContextProvider.Provider != contextpolicy.Reference {
		t.Fatal("PAC roundtrip failed", err)
	}
	data, _ := json.Marshal(r.ContextProvider)
	if !strings.Contains(string(data), "1.0.0") {
		t.Fatal("provider version not pinned")
	}
}
