// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestDesktopStartupRestoresOnlyVisibleWorkspace; TestDesktopStartupRejectsInvalidPointer
// Impact: python -B scripts/code-atlas.py show Core/workspace_recent_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDesktopStartupRestoresOnlyVisibleWorkspace(t *testing.T) {
	w, project := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("startup selection must not call model") })
	config := w.config
	if id, _, err := DesktopStartupWorkspace(config, ""); err != nil || id != "" {
		t.Fatal("empty upgrade selected", id, err)
	}
	w.mu.Lock()
	w.state.Messages = append(w.state.Messages, workspaceMessage{ID: "history", Text: "retain", State: "completed"})
	if err := w.saveLocked(); err != nil {
		t.Fatal(err)
	}
	w.mu.Unlock()
	if id, dir, err := DesktopStartupWorkspace(config, ""); err != nil || id != w.state.ID || dir != project {
		t.Fatal("upgrade failed", id, dir, err)
	}
	if _, err := w.Call(context.Background(), "workspace.activate", nil); err != nil {
		t.Fatal(err)
	}
	other, err := NewWorkspace(config, "", project, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	other.mu.Lock()
	other.state.Messages = append(other.state.Messages, workspaceMessage{ID: "other", Text: "background", State: "completed"})
	if err := other.saveLocked(); err != nil {
		t.Fatal(err)
	}
	other.mu.Unlock()
	future := time.Now().Add(time.Hour)
	if err := os.Chtimes(filepath.Join(other.dir, "workspace.json"), future, future); err != nil {
		t.Fatal(err)
	}
	if id, _, err := DesktopStartupWorkspace(config, ""); err != nil || id != w.state.ID {
		t.Fatal("background workspace changed visible startup", id, err)
	}
	before, _ := os.ReadFile(filepath.Join(w.dir, "workspace.json"))
	if dup, e := NewWorkspace(config, w.state.ID, project, "", nil); !errors.Is(e, ErrWorkspaceInUse) {
		if dup != nil {
			dup.Close()
		}
		t.Fatal("busy workspace not distinguished", e)
	}
	after, _ := os.ReadFile(filepath.Join(w.dir, "workspace.json"))
	if string(before) != string(after) {
		t.Fatal("duplicate start modified saved history")
	}
	if _, err := other.Call(context.Background(), "workspace.activate", nil); err != nil {
		t.Fatal(err)
	}
	if id, _, err := DesktopStartupWorkspace(config, ""); err != nil || id != other.state.ID {
		t.Fatal("explicit new session not remembered", id, err)
	}
	different := t.TempDir()
	if id, dir, err := DesktopStartupWorkspace(config, different); err != nil || id != "" || dir != different {
		t.Fatal("explicit project crossed workspace", id, dir, err)
	}
	w.Close()
	other.Close()
	id, dir, err := DesktopStartupWorkspace(config, "")
	if err != nil || id != other.state.ID || dir != project {
		t.Fatal("restart lost pointer", id, dir, err)
	}
	resumed, err := NewWorkspace(config, id, dir, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer resumed.Close()
	if len(resumed.state.Messages) != 1 || resumed.state.Messages[0].Text != "background" {
		t.Fatal("restart lost exact history")
	}
}

func TestDesktopStartupRejectsInvalidPointer(t *testing.T) {
	root := t.TempDir()
	config := filepath.Join(root, "config.json")
	if id, _, err := DesktopStartupWorkspace(config, ""); err != nil || id != "" {
		t.Fatal(id, err)
	}
	if err := os.Mkdir(filepath.Join(root, "workspaces"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{`{"version":1,"id":"../private"}`, `broken`, `{"version":2,"id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`} {
		if err := os.WriteFile(filepath.Join(root, "workspaces", "active.json"), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		if _, _, err := DesktopStartupWorkspace(config, ""); err == nil {
			t.Fatal("invalid pointer accepted")
		}
		b, _ := os.ReadFile(filepath.Join(root, "workspaces", "active.json"))
		if string(b) != body {
			t.Fatal("bad pointer overwritten")
		}
	}
}
