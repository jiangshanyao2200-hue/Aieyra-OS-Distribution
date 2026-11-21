// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: modeWorkspace; TestOSConversationEphemeralAndLiveContextRetained; TestOSReportsSharedRevisionAndCleanup; TestOSReportSnapshotCacheAndExplicitRefresh; TestUnifiedHostsHaveOnePrimaryAndRejectSavedSessions
// Impact: python -B scripts/code-atlas.py show Core/workspace_mode_test.go
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
	"sync/atomic"
	"testing"
	"time"
)

func modeWorkspace(t *testing.T, config, project string, mode HostMode) *Workspace {
	t.Helper()
	h := NewWorkspaceHost(config, "", "")
	// The host owns lazily created conversation services used by repair
	// notifications. Close the workspace first, then its host and file locks.
	t.Cleanup(h.Close)
	if err := h.SetMode(mode); err != nil {
		t.Fatal(err)
	}
	w, err := newWorkspace(config, "", project, "", nil, h)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(w.Close)
	return w
}

func TestOSConversationEphemeralAndLiveContextRetained(t *testing.T) {
	var calls atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		n := calls.Add(1)
		if n == 2 {
			b, _ := json.Marshal(body)
			if !strings.Contains(string(b), "private-first-turn") {
				t.Error("live context lost")
			}
		}
		fixtureAnswer(w, "os-result", "private-assistant", nil)
	})
	w := modeWorkspace(t, m.config, dir, HostOS)
	for _, text := range []string{"private-first-turn", "second-turn"} {
		w.mu.Lock()
		r, err := w.dispatchLocked(WorkspaceMatrix, workspaceID(), text)
		w.mu.Unlock()
		if err != nil {
			t.Fatal(err)
		}
		r, err = w.manager.Wait(context.Background(), w.state.ID, r.ID, 10000)
		if err != nil || r.State != "completed" {
			t.Fatalf("task %s %s %v", r.State, r.Error, err)
		}
	}
	if calls.Load() != 2 {
		t.Fatal(calls.Load())
	}
	if _, err := os.Stat(filepath.Join(w.dir, "workspace.json")); !os.IsNotExist(err) {
		t.Fatal("OS saved a workspace", err)
	}
	err := filepath.WalkDir(w.manager.dir, func(p string, d os.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if d.IsDir() || strings.HasSuffix(d.Name(), ".lock") {
			return nil
		}
		b, e := os.ReadFile(p)
		if e != nil {
			return e
		}
		if strings.Contains(string(b), "private-first-turn") || strings.Contains(string(b), "private-assistant") {
			t.Errorf("conversation persisted: %s", p)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	runtime := w.dir
	w.Close()
	if _, err := os.Stat(runtime); !os.IsNotExist(err) {
		t.Fatal("temporary runtime remains", err)
	}
	next := modeWorkspace(t, m.config, dir, HostOS)
	if next.state.ID == w.state.ID || len(next.state.Messages) != 0 {
		t.Fatal("OS restored conversation")
	}
	rows, err := ListCLIWorkspaces(m.config)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(rows)
	if strings.Contains(string(b), w.state.ID) {
		t.Fatal("OS leaked into CLI sessions")
	}
}

func TestOSReportsSharedRevisionAndCleanup(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected provider call") })
	a := modeWorkspace(t, m.config, dir, HostOS)
	r, err := a.report(rawJSON(map[string]any{"title": "Independent report", "format": "md", "content": "retained artifact"}))
	if err != nil {
		t.Fatal(err)
	}
	doc := r.(map[string]any)["document"].(WorkspaceDocument)
	b := modeWorkspace(t, m.config, dir, HostOS)
	if _, err = b.readDocument(doc.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = a.documentState(rawJSON(map[string]any{"action": "pin", "id": doc.ID, "pinned": true, "expected_revision": 0})); err != nil {
		t.Fatal(err)
	}
	if _, err = b.documentState(rawJSON(map[string]any{"action": "close", "id": doc.ID, "expected_revision": 0})); err == nil {
		t.Fatal("stale report revision accepted")
	}
	if _, err = b.documentState(rawJSON(map[string]any{"action": "close", "id": doc.ID, "expected_revision": 1})); err != nil {
		t.Fatal(err)
	}
	a.Close()
	b.Close()
	c := modeWorkspace(t, m.config, dir, HostOS)
	got, err := c.readDocument(doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	saved := got.(map[string]any)["document"].(WorkspaceDocument)
	if saved.Pinned || !saved.Dismissed || saved.Revision != 2 || got.(map[string]any)["content"] != "retained artifact" {
		t.Fatal(saved)
	}
	// 只清理明确标记且未加锁的目录；并行窗口、CLI 和未知目录不动。
	stale := filepath.Join(filepath.Dir(c.dir), workspaceID())
	unknown := filepath.Join(filepath.Dir(c.dir), workspaceID())
	for _, p := range []string{stale, unknown} {
		if err := os.MkdirAll(p, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(stale, ".ephemeral-os"), []byte("aieyra-os-ephemeral/1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	modeWorkspace(t, m.config, dir, HostOS)
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatal("stale marked runtime not removed", err)
	}
	for _, p := range []string{c.dir, unknown} {
		if _, err := os.Stat(p); err != nil {
			t.Fatal("active or unknown directory removed", err)
		}
	}
}

func TestOSReportSnapshotCacheAndExplicitRefresh(t *testing.T) {
	m, project := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected provider call") })
	a := modeWorkspace(t, m.config, project, HostOS)
	b := modeWorkspace(t, m.config, project, HostOS)
	b.mu.Lock()
	err := b.refreshReportsLocked()
	readAt := b.reportsReadAt
	b.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	r, err := a.report(rawJSON(map[string]any{"title": "cache", "format": "md", "content": "shared"}))
	if err != nil {
		t.Fatal(err)
	}
	id := r.(map[string]any)["document"].(WorkspaceDocument).ID
	b.mu.Lock()
	err = b.refreshSnapshotReportsLocked(readAt.Add(100 * time.Millisecond))
	cached := len(b.state.Documents)
	b.mu.Unlock()
	if err != nil || cached != 0 {
		t.Fatal("snapshot reread within cache window", cached, err)
	}
	if _, err = b.readDocument(id); err != nil {
		t.Fatal("explicit read failed to see new report", err)
	}
	b.mu.Lock()
	err = b.refreshSnapshotReportsLocked(readAt.Add(2 * time.Second))
	count := len(b.state.Documents)
	b.mu.Unlock()
	if err != nil || count != 1 {
		t.Fatal("expired snapshot cache failed to refresh", count, err)
	}
}

func TestUnifiedHostsHaveOnePrimaryAndRejectSavedSessions(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected provider call") })
	for _, mode := range []HostMode{HostCLI, HostOS} {
		t.Run(string(mode), func(t *testing.T) {
			host := NewWorkspaceHost(m.config, "", "")
			defer host.Close()
			if mode == HostCLI {
				host.SetTerminal()
			}
			if err := host.SetMode(mode); err != nil {
				t.Fatal(err)
			}
			if _, err := host.Open(workspaceID(), dir); err == nil {
				t.Fatal("saved session accepted")
			}
			one, err := host.Open("", dir)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = host.Open("", dir); err == nil {
				t.Fatal("second primary accepted")
			}
			if _, err = host.Open(one["session_id"].(string), dir); err == nil {
				t.Fatal("resume accepted")
			}
		})
	}
}
