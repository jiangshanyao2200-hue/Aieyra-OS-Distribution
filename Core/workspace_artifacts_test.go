// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestTurnArtifactsListCreatedAndChangedFiles; TestTurnArtifactsAreBounded; TestArtifactPathStaysInsideWorkdir; TestTurnArtifactsSkipOSState
// Impact: python -B scripts/code-atlas.py show Core/workspace_artifacts_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestTurnArtifactsListCreatedAndChangedFiles(t *testing.T) {
	root := t.TempDir()
	write := func(rel, text string) {
		path := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("README.md", "old")
	write("keep.txt", "same")
	write("node_modules/lib/index.js", "dep")
	before := scanWorkdir(root, nil)
	time.Sleep(20 * time.Millisecond)
	write("site/index.html", "<!doctype html>")
	write("README.md", "new text")
	write("node_modules/lib/other.js", "ignored")
	write(".env", "ignored")
	got := diffArtifacts(before, scanWorkdir(root, nil))
	if len(got) != 2 {
		t.Fatalf("artifacts = %+v", got)
	}
	seen := map[string]WorkspaceArtifact{}
	for _, a := range got {
		seen[a.Path] = a
	}
	if a := seen["site/index.html"]; a.Kind != "html" || !a.Created {
		t.Fatalf("html artifact = %+v", a)
	}
	if a := seen["README.md"]; a.Kind != "markdown" || a.Created || a.Size != 8 {
		t.Fatalf("changed artifact = %+v", a)
	}
}

func TestTurnArtifactsAreBounded(t *testing.T) {
	before := map[string]fileStamp{}
	after := map[string]fileStamp{}
	for i := 0; i < 30; i++ {
		after[filepath.ToSlash(filepath.Join("out", string(rune('a'+i%26))+string(rune('0'+i/26))+".txt"))] = fileStamp{1, int64(i)}
	}
	got := diffArtifacts(before, after)
	if len(got) != artifactListLimit || got[0].Path != "out/d1.txt" {
		t.Fatalf("artifacts = %+v", got)
	}
}

func TestArtifactPathStaysInsideWorkdir(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "site"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "site", "index.html"), []byte("<p>hi</p>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("no"), 0o644); err != nil {
		t.Fatal(err)
	}
	w := &Workspace{state: workspaceState{Workdir: root}}
	call := func(path string) (map[string]any, error) {
		raw, _ := json.Marshal(map[string]string{"path": path})
		v, err := w.artifactPath(raw)
		if err != nil {
			return nil, err
		}
		return v.(map[string]any), nil
	}
	got, err := call("site/index.html")
	if err != nil || got["kind"] != "html" || got["name"] != "index.html" || !strings.HasSuffix(got["path"].(string), filepath.Join("site", "index.html")) {
		t.Fatalf("artifact = %v, %v", got, err)
	}
	rel, _ := filepath.Rel(root, filepath.Join(outside, "secret.txt"))
	for _, bad := range []string{"", "../x", filepath.ToSlash(rel), filepath.Join(outside, "secret.txt"), "site", "missing.html"} {
		if _, err := call(bad); err == nil {
			t.Fatalf("path %q should be refused", bad)
		}
	}
}

// 工作目录包含 OS 自己的状态时（团队实验台：Eyra 的回复挂出 config.json、终端日志、Local State），这些不算产物。
func TestTurnArtifactsSkipOSState(t *testing.T) {
	root := t.TempDir()
	write := func(rel string) {
		path := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(rel+time.Now().String()), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	state := artifactStatePaths(filepath.Join(root, "config.json"))
	before := scanWorkdir(root, state)
	write("config.json")
	write("interface-preferences.json")
	write("os-appearance.json")
	write("matrix/os-tasks/a/workflow.json")
	write("matrix/os-tasks/a/b.shell/1.log")
	write("runtime/os/s/desktop/Local State")
	write("project-maps/source-hash/index.json")
	write("Agents/private/memory/eyra.sqlite")
	write("workflows/owner/result.json")
	write("Programs/notebook/state.json")
	write("servers/secrets.json")
	write("agent-browser/Local State")
	write("config.json.catalog-cache/private.json")
	write("docs/result.md")
	got := diffArtifacts(before, scanWorkdir(root, state))
	if len(got) != 1 || got[0].Path != "docs/result.md" {
		t.Fatalf("artifacts = %+v", got)
	}
	before = scanWorkdir(root, state)
	write("docs/index.json")
	got = diffArtifacts(before, scanWorkdir(root, state))
	if len(got) != 1 || got[0].Path != "docs/index.json" {
		t.Fatalf("user index must remain a deliverable: %+v", got)
	}
	state = artifactStatePaths(filepath.Join(root, "Config", "config.json"))
	before = scanWorkdir(root, state)
	write("Config/interface-preferences.json")
	write("Config/link/control-storage.json")
	write("Data/memory/eyra.sqlite")
	write("Data/runtime/os/s/desktop/Local State")
	write("docs/next.md")
	got = diffArtifacts(before, scanWorkdir(root, state))
	if len(got) != 1 || got[0].Path != "docs/next.md" {
		t.Fatalf("canonical layout artifacts = %+v", got)
	}
}
