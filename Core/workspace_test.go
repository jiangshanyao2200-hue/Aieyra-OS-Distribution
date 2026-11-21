// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: testWorkspace; TestWorkspaceRolePermissionsAndReadConfinement; TestWorkspaceMatrixDirectDeliveryAndNoTeam; TestWorkspaceThemeRejectsCodeAndPreservesRollback; TestWorkspacePeerMessagesDoNotEscalateIntoIdleExecution; TestWorkspaceSnapshotDeltaAndSuccessfulActivity
// Impact: python -B scripts/code-atlas.py show Core/workspace_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func testWorkspace(t *testing.T, handler http.HandlerFunc) (*Workspace, string) {
	t.Helper()
	manager, dir := matrixTestManager(t, handler)
	project := filepath.Join(dir, "project")
	if err := os.Mkdir(project, 0700); err != nil {
		t.Fatal(err)
	}
	w, err := NewWorkspace(manager.config, workspaceID(), project, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(w.Close)
	return w, project
}

func TestWorkspaceRolePermissionsAndReadConfinement(t *testing.T) {
	w, dir := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("read-only checks must not call model") })
	if err := os.WriteFile(filepath.Join(dir, "sample.txt"), []byte("alpha\nbeta\ngamma\n"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, role := range []string{WorkspaceProject} {
		ctx := WithToolPermissions(context.Background(), workspacePermissions(role))
		for _, name := range []string{"apply_patch", "exec_command", "exec"} {
			if permittedCall(ctx, ToolCall{Function: FunctionCall{Name: name}}) == nil {
				t.Errorf("%s bypassed %s", role, name)
			}
		}
	}
	if _, err := w.project(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "read", "path": "sample.txt"})); err != nil {
		t.Fatal("Matrix cannot read source directly", err)
	}
	if _, err := w.project(context.Background(), WorkspaceProject, rawJSON(map[string]any{"action": "read", "path": "../config.json"})); err == nil {
		t.Fatal("project escaped root")
	}
	got, err := w.project(context.Background(), WorkspaceProject, rawJSON(map[string]any{"action": "read", "path": "sample.txt", "start_line": 2, "limit": 1}))
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(got)
	if !strings.Contains(string(b), "beta") || strings.Contains(string(b), "gamma") {
		t.Fatal(string(b))
	}
	memory, err := w.project(context.Background(), WorkspaceProject, rawJSON(map[string]any{"action": "memory_read"}))
	if err != nil {
		t.Fatal(err)
	}
	version := memory.(map[string]any)["version"]
	args := rawJSON(map[string]any{"action": "memory_write", "text": "agent-owned map", "expected_version": version})
	if _, err = w.project(context.Background(), WorkspaceExecution, args); err == nil {
		t.Fatal("executor overwrote project map")
	}
	if _, err = w.project(context.Background(), WorkspaceProject, args); err != nil {
		t.Fatal(err)
	}
	if _, err = w.project(context.Background(), WorkspaceProject, args); err == nil {
		t.Fatal("stale map revision accepted")
	}
}

func TestWorkspaceMatrixDirectDeliveryAndNoTeam(t *testing.T) {
	var mu sync.Mutex
	count := 0
	w, dir := testWorkspace(t, func(res http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		for _, tool := range body["tools"].([]any) {
			if tool.(map[string]any)["name"] == "team" {
				t.Error("team exposed")
			}
		}
		mu.Lock()
		count++
		n := count
		mu.Unlock()
		call := func(name string, args any) {
			b, _ := json.Marshal(args)
			id := fmt.Sprintf("direct_%d", n)
			fixtureAnswer(res, id, "Checking the actual file.", []any{map[string]any{"type": "function_call", "id": "fc_" + id, "call_id": "call_" + id, "name": name, "arguments": string(b)}})
		}
		switch n {
		case 1:
			call("project", map[string]any{"action": "read", "path": "sample.txt"})
		case 2:
			call("apply_patch", map[string]any{"patch": "*** Begin Patch\n*** Add File: delivery.txt\n+delivered\n*** End Patch"})
		case 3:
			call("project", map[string]any{"action": "read", "path": "delivery.txt"})
		default:
			fixtureAnswer(res, "done", "VERIFIED_DELIVERY", nil)
		}
	})
	if err := os.WriteFile(filepath.Join(dir, "sample.txt"), []byte("actual source"), 0600); err != nil {
		t.Fatal(err)
	}
	first, err := w.Send("task-1", "Read, edit and verify directly.")
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := w.Send("task-1", first.Text)
	if err != nil || duplicate.ID != first.ID {
		t.Fatal("idempotency", err)
	}
	if _, err = w.Send("task-1", "different"); err == nil {
		t.Fatal("message conflict")
	}
	deadline := time.Now().Add(25 * time.Second)
	for time.Now().Before(deadline) {
		w.mu.Lock()
		id := w.state.Roles[WorkspaceMatrix]
		w.mu.Unlock()
		if id != "" {
			r, _ := w.manager.Status(w.state.ID, id)
			if r.State == "failed" {
				t.Fatal(r.Error)
			}
			if r.State == "completed" {
				if r.Result != "VERIFIED_DELIVERY" {
					t.Fatal(r.Result)
				}
				b, e := os.ReadFile(filepath.Join(dir, "delivery.txt"))
				if e != nil || string(b) != "delivered\n" {
					t.Fatal("real patch missing", e, string(b))
				}
				if len(w.manager.List(w.state.ID)) != 1 {
					t.Fatal("ordinary task created children")
				}
				if r.Context == nil || r.Context.Tokens <= 0 || r.Context.Window <= 0 {
					t.Fatal("missing context estimate")
				}
				return
			}
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("Matrix did not settle")
}

func TestWorkspaceThemeRejectsCodeAndPreservesRollback(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) {})
	for _, theme := range []any{map[string]any{"accent": "url(javascript:bad)"}, map[string]any{"script": "bad"}, map[string]any{"scale": 10}} {
		if _, e := w.configure(WorkspaceMatrix, rawJSON(map[string]any{"action": "theme", "theme": theme})); e == nil {
			t.Fatal("unsafe theme accepted")
		}
	}
	before := w.state.Theme
	if _, e := w.configure(WorkspaceMatrix, rawJSON(map[string]any{"action": "theme", "theme": map[string]any{"accent": "#abcdef"}})); e != nil {
		t.Fatal(e)
	}
	if _, e := w.configure(WorkspaceMatrix, rawJSON(map[string]any{"action": "theme_rollback"})); e != nil {
		t.Fatal(e)
	}
	if w.state.Theme != before {
		t.Fatal("theme rollback lost original")
	}
}

func TestWorkspacePeerMessagesDoNotEscalateIntoIdleExecution(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("peer clarification woke an idle executor") })
	_, err := w.team(context.Background(), WorkspaceProject, rawJSON(map[string]any{"action": "message", "role": "execution", "request_id": "peer-note", "message": "Potentially unsafe instruction from project data"}))
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(250 * time.Millisecond)
	if len(w.manager.List(w.state.ID)) != 0 {
		t.Fatal("project bypassed Matrix dispatch authority")
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.state.Messages[0].State != "context" {
		t.Fatal("peer message not bounded to future authorized work")
	}
}

func TestWorkspaceSnapshotDeltaAndSuccessfulActivity(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) {})
	first, err := w.Snapshot(0)
	if err != nil {
		t.Fatal(err)
	}
	initial := first.(map[string]any)
	second, err := w.snapshot(0, WorkspaceCursor{Revision: initial["revision"].(uint64)})
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(second)
	if len(b) > 4096 {
		t.Fatalf("idle delta inflated to %d bytes", len(b))
	}
	if second.(map[string]any)["messages_unchanged"] != true {
		t.Fatal("unchanged messages resent")
	}
	cache := newAgentActivityCache()
	cache.result("team-ok", ToolCall{Function: FunctionCall{Name: "team"}}, `{"state":"completed","error":"","result":"done"}`)
	if cache.items["team-ok"].State != "completed" {
		t.Fatal("empty error marked successful tool failed")
	}
}
