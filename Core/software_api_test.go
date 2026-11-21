// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestToolboxRejectsMalformedNestedArgumentsBeforeDispatch; TestSoftwareAPIDesktopScopeAndStableInvocation; TestSoftwareAPISettingsDelegatesSameWorkspaceVersionAndRecovery; TestSoftwareAPIFailedHostReceiptRetainsCodeAndDoesNotBecomeSuccess; TestSoftwareAPIUpdatesUsesExistingServiceWithoutCloudCapability
// Impact: python -B scripts/code-atlas.py show Core/software_api_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestToolboxRejectsMalformedNestedArgumentsBeforeDispatch(t *testing.T) {
	useTestStage(t, ReleaseStage{Toolbox: true})
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		_, _ = w.Write([]byte(`{"ok":true,"state":"completed"}`))
	}))
	defer server.Close()
	service := NewSettingsService("")
	if err := service.SetCommunityBridge(server.URL + "/" + strings.Repeat("a", 64)); err != nil {
		t.Fatal(err)
	}
	w := &Workspace{host: &WorkspaceHost{mode: HostOS}, service: service}
	w.state.ID = "owned"
	ctx := WithSettingsService(context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{w, WorkspaceMatrix}), service, "owned")
	ctx = WithToolPermissions(ctx, []string{"browser", "software_api"})
	state := &ToolboxState{Open: map[string]bool{"browser": true, "software_api": true}}
	for _, name := range []string{"browser", "software_api"} {
		for _, argument := range []string{"", `,"arguments":null`, `,"arguments":[]`, `,"arguments":"{}"`, `,"arguments":42`, `,"module":"browser","operation":"detach"`} {
			input := `{"action":"call","name":"` + name + `"` + argument + `}`
			result := state.Execute(ctx, "", ToolCall{ID: "malformed", Function: FunctionCall{Name: "toolbox", Arguments: input}})
			if result.OK || result.Error == nil || result.Error.Code != "invalid_toolbox_arguments" || !strings.Contains(result.Error.Message, "arguments") {
				t.Fatalf("missing actionable nested-argument error for %s: %+v", input, result)
			}
		}
	}
	if calls != 0 {
		t.Fatalf("invalid input dispatched %d operations", calls)
	}
	valid := state.Execute(ctx, "", ToolCall{ID: "valid", Function: FunctionCall{Name: "toolbox", Arguments: `{"action":"call","name":"software_api","arguments": {"action":"modules"}}`}})
	if !valid.OK || calls != 1 {
		t.Fatalf("corrected explicit input did not dispatch once: %+v calls=%d", valid, calls)
	}
}

func TestSoftwareAPIDesktopScopeAndStableInvocation(t *testing.T) {
	useTestStage(t, ReleaseStage{Toolbox: true})
	var received []map[string]json.RawMessage
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var p struct {
			Action    string                     `json:"action"`
			Session   string                     `json:"session_id"`
			Arguments map[string]json.RawMessage `json:"arguments"`
		}
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			t.Error(err)
		}
		if p.Action != "_desktop" || p.Session != "owned" {
			t.Error("lost owner", p.Action, p.Session)
		}
		received = append(received, p.Arguments)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"state":"completed","current":{"main_open":true}}`))
	}))
	defer server.Close()
	service := NewSettingsService("")
	if err := service.SetCommunityBridge(server.URL + "/" + strings.Repeat("a", 64)); err != nil {
		t.Fatal(err)
	}
	w := &Workspace{host: &WorkspaceHost{mode: HostOS}, service: service}
	w.state.ID = "owned"
	ctx := WithToolPermissions(context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{w, WorkspaceMatrix}), []string{"software_api"})
	ctx = context.WithValue(ctx, toolInvocationKey{}, "durable invocation")
	state := &ToolboxState{Open: map[string]bool{"software_api": true}}
	call := ToolCall{ID: "call", Function: FunctionCall{Name: "toolbox", Arguments: `{"action":"call","name":"software_api","arguments":{"action":"module","module":"browser","operation":"detach"}}`}}
	for i := 0; i < 2; i++ {
		if r := state.Execute(ctx, "", call); !r.OK {
			t.Fatalf("dispatch failed: %+v", r)
		}
	}
	if len(received) != 2 || string(received[0]["request_id"]) != string(received[1]["request_id"]) || !strings.Contains(string(received[0]["request_id"]), "tool-") {
		t.Fatal("unstable request identity", received)
	}
	for _, role := range []string{WorkspaceProject, WorkspaceExecution} {
		denied := context.WithValue(ctx, workspaceContextKey{}, workspaceContext{w, role})
		if r := state.Execute(denied, "", call); r.OK {
			t.Fatal("worker operated desktop", role)
		}
	}
	w.host = &WorkspaceHost{mode: HostCLI, terminal: true}
	if r := state.Execute(ctx, "", call); r.OK {
		t.Fatal("CLI operated desktop")
	}
	if len(received) != 2 {
		t.Fatal("forbidden request reached host")
	}
}

func TestSoftwareAPISettingsDelegatesSameWorkspaceVersionAndRecovery(t *testing.T) {
	useTestStage(t, ReleaseStage{Toolbox: true})
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("settings invoked model") })
	ctx := WithToolPermissions(context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{w, WorkspaceMatrix}), []string{"settings", "software_api"})
	state := &ToolboxState{Open: map[string]bool{"settings": true, "software_api": true}}
	call := func(name string, args map[string]any) ToolboxResult {
		t.Helper()
		return state.Execute(ctx, "", ToolCall{ID: "settings", Function: FunctionCall{Name: "toolbox", Arguments: string(rawJSON(map[string]any{"action": "call", "name": name, "arguments": args}))}})
	}
	direct := call("settings", map[string]any{"action": "inspect", "scope": "workspace"})
	wrapped := call("software_api", map[string]any{"action": "settings", "arguments": map[string]any{"action": "inspect", "scope": "workspace"}})
	legacy := call("software_api", map[string]any{"action": "inspect", "scope": "workspace"})
	if !direct.OK || !wrapped.OK || !legacy.OK || string(direct.Data) != string(wrapped.Data) || string(direct.Data) != string(legacy.Data) {
		t.Fatalf("settings routes differ: %+v %+v %+v", direct, wrapped, legacy)
	}
	var view map[string]any
	_ = json.Unmarshal(direct.Data, &view)
	updated := call("software_api", map[string]any{"action": "settings", "arguments": map[string]any{"action": "apply", "scope": "workspace", "expected_version": view["version"], "patch": map[string]any{"accent": "#abcdef"}}})
	if !updated.OK || w.state.Theme.Accent != "#abcdef" {
		t.Fatal("shared apply failed", updated)
	}
	stale := call("settings", map[string]any{"action": "apply", "scope": "workspace", "expected_version": view["version"], "patch": map[string]any{"accent": "#123456"}})
	if stale.OK || !strings.Contains(string(stale.Data), "version_conflict") {
		t.Fatal("cross-entry conflict lost", stale)
	}
	for _, args := range []map[string]any{{"action": "settings", "arguments": nil}, {"action": "settings", "arguments": map[string]any{}, "script": "x"}} {
		if call("software_api", args).OK {
			t.Fatal("invalid delegation accepted")
		}
	}
}

func TestSoftwareAPIFailedHostReceiptRetainsCodeAndDoesNotBecomeSuccess(t *testing.T) {
	useTestStage(t, ReleaseStage{Toolbox: true})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":false,"state":"unknown","code":"STATE_UNCONFIRMED","error":"not visible","request_id":"one"}`))
	}))
	defer server.Close()
	service := NewSettingsService("")
	_ = service.SetCommunityBridge(server.URL + "/" + strings.Repeat("b", 64))
	w := &Workspace{host: &WorkspaceHost{mode: HostOS}, service: service}
	w.state.ID = "owned"
	ctx := WithToolPermissions(context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{w, WorkspaceMatrix}), []string{"software_api"})
	state := &ToolboxState{Open: map[string]bool{"software_api": true}}
	result := state.Execute(ctx, "", ToolCall{ID: "one", Function: FunctionCall{Name: "toolbox", Arguments: `{"action":"call","name":"software_api","arguments":{"action":"module","module":"browser","operation":"open","request_id":"one"}}`}})
	if result.OK || !strings.Contains(string(result.Data), "STATE_UNCONFIRMED") || result.Error == nil {
		t.Fatal("host failure lost", result)
	}
}

func TestSoftwareAPIUpdatesUsesExistingServiceWithoutCloudCapability(t *testing.T) {
	useTestStage(t, ReleaseStage{Toolbox: true})
	var received []map[string]json.RawMessage
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var p struct {
			Action    string                     `json:"action"`
			Session   string                     `json:"session_id"`
			Arguments map[string]json.RawMessage `json:"arguments"`
		}
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			t.Error(err)
		}
		if p.Action != "_updates" {
			t.Error("lost update service", p)
		}
		received = append(received, p.Arguments)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"phase":"unavailable"}`))
	}))
	defer server.Close()
	service := NewSettingsService("")
	if err := service.SetCommunityBridge(server.URL + "/" + strings.Repeat("a", 64)); err != nil {
		t.Fatal(err)
	}
	w := &Workspace{host: &WorkspaceHost{mode: HostOS}, service: service}
	w.state.ID = "owned"
	ctx := WithToolPermissions(context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{w, WorkspaceMatrix}), []string{"software_api"})
	state := &ToolboxState{Open: map[string]bool{"software_api": true}}
	call := func(action string) ToolboxResult {
		return state.Execute(ctx, "", ToolCall{ID: "update", Function: FunctionCall{Name: "toolbox", Arguments: string(rawJSON(map[string]any{"action": "call", "name": "software_api", "arguments": map[string]any{"action": action, "request_id": "stable-update", "update_id": "original-update", "revision": 3}}))}})
	}
	if result := call("update_status"); !result.OK {
		t.Fatalf("update query failed: %+v", result)
	}
	if len(received) != 1 || string(received[0]["action"]) != `"status"` || string(received[0]["request_id"]) != `"stable-update"` || string(received[0]["revision"]) != "3" {
		t.Fatal(received)
	}
	for _, action := range []string{"update_commit", "update_rollback"} {
		if result := call(action); result.OK {
			t.Fatal("trusted host operation escaped", action)
		}
	}
	if len(received) != 1 {
		t.Fatal("trusted host operations reached service", received)
	}
}
