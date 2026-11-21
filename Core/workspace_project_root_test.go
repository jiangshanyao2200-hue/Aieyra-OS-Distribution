// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestProjectDefaultAndExplicitOSRootsRemainSeparate
// Impact: python -B scripts/code-atlas.py show Core/workspace_project_root_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestProjectDefaultAndExplicitOSRootsRemainSeparate(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("project indexing must not call a model") })
	app := t.TempDir()
	work := filepath.Join(app, "工作目录")
	for _, name := range []string{"工作目录", "Core", "Config", "Data", "Prompt"} {
		if err := os.MkdirAll(filepath.Join(app, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	for name, text := range map[string]string{
		"工作目录/user.go":      "package user\nfunc UserProject(){}",
		"Core/core.go":      "package core\nfunc SystemSource(){}",
		"Config/private.go": "package private\nfunc SecretConfig(){}",
		"Data/private.go":   "package private\nfunc SecretData(){}",
		"Prompt/private.go": "package private\nfunc SecretPrompt(){}",
	} {
		if err := os.WriteFile(filepath.Join(app, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("AIEYRA_ROOT", app)
	w.mu.Lock()
	w.state.Workdir = work
	w.mu.Unlock()
	if root, err := w.projectWorkdir(""); err != nil || root != work {
		t.Fatal("default project silently moved to OS root", root, err)
	}
	if root, err := w.projectWorkdir("os"); err != nil || root != app {
		t.Fatal("explicit OS selection unavailable", root, err)
	}
	if _, err := w.projectWorkdir("../"); err == nil {
		t.Fatal("invalid root was accepted")
	}
	call := func(p map[string]any) map[string]any {
		t.Helper()
		v, err := w.project(context.Background(), WorkspaceMatrix, rawJSON(p))
		if err != nil {
			t.Fatal(err)
		}
		return v.(map[string]any)
	}
	if got := call(map[string]any{"action": "index_refresh"})["files"]; got != 1 {
		t.Fatal("default indexed outside user workspace", got)
	}
	if got := call(map[string]any{"action": "index_query", "query": "SystemSource"})["matches"].([]any); len(got) != 0 {
		t.Fatal("OS source leaked into default index", got)
	}
	call(map[string]any{"action": "index_refresh", "root": "os", "path": "Core"})
	if got := call(map[string]any{"action": "index_query", "root": "os", "query": "SystemSource"})["matches"].([]any); len(got) != 1 {
		t.Fatal("explicit OS index missing", got)
	}
	for _, scope := range []string{"Config", "Data", "Prompt"} {
		if _, err := w.project(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "read", "root": "os", "path": scope + "/private.go"})); err == nil {
			t.Fatal("private OS path read", scope)
		}
	}
	call(map[string]any{"action": "index_refresh", "root": "os"})
	if got := call(map[string]any{"action": "index_query", "root": "os", "query": "Secret"})["matches"].([]any); len(got) != 0 {
		t.Fatal("private OS content indexed", got)
	}
	if root, err := w.projectWorkdir(""); err != nil || root != work {
		t.Fatal("explicit OS read mutated default workspace", root, err)
	}
}
