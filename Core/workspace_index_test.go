// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestProjectMapIncrementalFreshnessAndSourceBoundSummary; TestProjectMapPrivatePathsIsolationCancellationAndCorruption; TestProjectGuardProtectsModuleStoresBesideExternalConfig
// Impact: python -B scripts/code-atlas.py show Core/workspace_index_test.go
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
)

func TestProjectMapIncrementalFreshnessAndSourceBoundSummary(t *testing.T) {
	w, dir := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("map must not call model") })
	call := func(role string, p map[string]any) map[string]any {
		t.Helper()
		v, e := w.project(context.Background(), role, rawJSON(p))
		if e != nil {
			t.Fatal(e)
		}
		return v.(map[string]any)
	}
	write := func(n, s string) {
		t.Helper()
		if e := os.WriteFile(filepath.Join(dir, n), []byte(s), 0600); e != nil {
			t.Fatal(e)
		}
	}
	write("pay.go", "package sample\nimport \"fmt\"\nfunc Payment() { fmt.Println(1) }\n")
	write("pay.test.ts", "export function paymentTest() {}\n")
	r := call(WorkspaceMatrix, map[string]any{"action": "index_refresh"})
	if r["parsed"] != 2 {
		t.Fatal(r)
	}
	r = call(WorkspaceMatrix, map[string]any{"action": "index_refresh"})
	if r["parsed"] != 0 || r["reused"] != 2 {
		t.Fatal(r)
	}
	r = call(WorkspaceMatrix, map[string]any{"action": "index_query", "query": "Payment"})
	items := r["matches"].([]any)
	if len(items) != 2 {
		t.Fatal(r)
	}
	var file map[string]any
	for _, v := range items {
		f := v.(map[string]any)
		if f["path"] == "pay.go" {
			file = f
		}
	}
	if file["precision"] != "go-ast" || file["freshness"] != "current" {
		t.Fatal(file)
	}
	arg := map[string]any{"action": "index_annotate", "path": "pay.go", "text": "Payment reports a diagnostic", "expected_version": file["sha256"]}
	if _, e := w.project(context.Background(), WorkspaceExecution, rawJSON(arg)); e == nil {
		t.Fatal("executor annotated map")
	}
	call(WorkspaceProject, arg)
	r = call(WorkspaceMatrix, map[string]any{"action": "index_query", "query": "pay.go"})
	if r["matches"].([]any)[0].(map[string]any)["summary_state"] != "current" {
		t.Fatal(r)
	}
	write("pay.go", "package sample\nfunc Refund() {}\n")
	r = call(WorkspaceMatrix, map[string]any{"action": "index_query", "query": "pay.go"})
	f := r["matches"].([]any)[0].(map[string]any)
	if f["summary_state"] != "stale" || f["summary"] != "" || f["sha256"] == file["sha256"] {
		t.Fatal(f)
	}
	if _, e := w.project(context.Background(), WorkspaceMatrix, rawJSON(arg)); e == nil {
		t.Fatal("stale source annotation accepted")
	}
	if e := os.Rename(filepath.Join(dir, "pay.go"), filepath.Join(dir, "refund.go")); e != nil {
		t.Fatal(e)
	}
	r = call(WorkspaceMatrix, map[string]any{"action": "index_refresh"})
	if r["removed"] != 1 || r["parsed"] != 1 {
		t.Fatal(r)
	}
	w2, e := NewWorkspace(w.config, workspaceID(), dir, "", nil)
	if e != nil {
		t.Fatal(e)
	}
	defer w2.Close()
	got, e := w2.project(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "index_query", "query": "Refund"}))
	if e != nil {
		t.Fatal(e)
	}
	b, _ := json.Marshal(got)
	if !strings.Contains(string(b), "refund.go") {
		t.Fatal(string(b))
	}
}

func TestProjectMapPrivatePathsIsolationCancellationAndCorruption(t *testing.T) {
	w, dir := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("no model") })
	os.Mkdir(filepath.Join(dir, "Prompt"), 0700)
	os.WriteFile(filepath.Join(dir, "Prompt", "secret.go"), []byte("package secret\nfunc Private(){}"), 0600)
	os.WriteFile(filepath.Join(dir, "good.go"), []byte("package test\nfunc Public(){}"), 0600)
	if _, e := w.project(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "index_refresh", "path": "../"})); e == nil {
		t.Fatal("escaped project")
	}
	r, e := w.project(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "index_refresh"}))
	if e != nil {
		t.Fatal(e)
	}
	if r.(map[string]any)["files"] != 1 {
		t.Fatal(r)
	}
	os.WriteFile(filepath.Join(dir, "invalid.go"), []byte{0xff, 0xfe}, 0600)
	r, e = w.project(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "index_refresh"}))
	if e != nil || r.(map[string]any)["partial"] != true || r.(map[string]any)["skipped"] != 1 {
		t.Fatal(r, e)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e = w.project(ctx, WorkspaceMatrix, rawJSON(map[string]any{"action": "index_refresh"})); e == nil {
		t.Fatal("cancellation ignored")
	}
	maps, e := filepath.Glob(filepath.Join(filepath.Dir(w.config), "project-maps", "*", "index.json"))
	if e != nil || len(maps) != 1 {
		t.Fatal(maps, e)
	}
	os.WriteFile(maps[0], []byte("broken"), 0600)
	if _, e = w.project(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "index_refresh"})); e == nil {
		t.Fatal("corrupt map silently replaced")
	}
	b, _ := os.ReadFile(maps[0])
	if string(b) != "broken" {
		t.Fatal(string(b))
	}
}

func TestProjectGuardProtectsModuleStoresBesideExternalConfig(t *testing.T) {
	root := t.TempDir()
	w := &Workspace{config: filepath.Join(root, "config.json"), dir: filepath.Join(root, "runtime", "owned")}
	for _, relative := range []string{"Agents/instance/secret.json", "workflows/owner/state.json", "Programs/example/data.json", "servers/secrets.json", "agent-browser/private.go", "config.json.catalog-cache/private.json"} {
		file := filepath.Join(root, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte("private fixture"), 0600); err != nil {
			t.Fatal(err)
		}
		if !w.projectPathGuard(root)(relative) {
			t.Fatal("private store visible", relative)
		}
	}
	if w.projectPathGuard(root)("docs/output.json") {
		t.Fatal("user output hidden")
	}
}
