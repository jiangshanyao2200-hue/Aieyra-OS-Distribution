// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestDesktopHostToolsAndBridge
// Impact: python -B scripts/code-atlas.py show Core/workspace_desktop_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
)

func TestDesktopHostToolsAndBridge(t *testing.T) {
	var calls atomic.Int32
	actions := []string{"link_status", "link_open", "eyra_open", "eyra_close"}
	server := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var p struct {
			Action    string         `json:"action"`
			Session   string         `json:"session_id"`
			Arguments map[string]any `json:"arguments"`
		}
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil || p.Action != "_desktop" || p.Session != "owned-os" || !slices.Contains(actions, p.Arguments["action"].(string)) {
			t.Error("desktop bridge lost session or action", p, err)
		}
		rw.Header().Set("Content-Type", "application/json")
		_, _ = rw.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	service := NewSettingsService("")
	if err := service.SetCommunityBridge(server.URL + "/" + strings.Repeat("a", 64)); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []HostMode{HostOS, HostCLI, HostLegacy} {
		for _, role := range []string{WorkspaceMatrix, WorkspaceExecution, WorkspaceProject} {
			for _, action := range actions {
				w := &Workspace{host: &WorkspaceHost{mode: mode, terminal: mode == HostCLI}, service: service}
				w.state.ID = "owned-os"
				ctx := context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{workspace: w, role: role})
				call := ToolCall{}
				call.Function.Name = "workspace"
				call.Function.Arguments = string(rawJSON(map[string]any{"action": action}))
				before := calls.Load()
				result := executeWorkspaceTool(ctx, call)
				allowed := mode == HostOS && role == WorkspaceMatrix
				if (calls.Load() == before+1) != allowed || strings.Contains(string(rawJSON(result)), `"ok":true`) != allowed {
					t.Fatal("desktop permission or routing drift", mode, role, action, result)
				}
			}
		}
	}
	for _, mode := range []HostMode{HostOS, HostCLI, HostLegacy} {
		w := &Workspace{host: &WorkspaceHost{mode: mode, terminal: mode == HostCLI}}
		for _, def := range WorkspaceToolDefinitions() {
			if def.Name != "workspace" {
				continue
			}
			def = w.toolDefinition(def)
			encoded := string(rawJSON(def))
			if strings.Contains(encoded, "link_status") != (mode == HostOS) {
				t.Fatal("desktop schema leaked", mode)
			}
			// Workspace 画布与 Editor 已移出：任何模式都不再发布它们。
			if strings.Contains(encoded, "canvas_") || strings.Contains(encoded, "editor_") {
				t.Fatal("removed canvas/editor actions still published", mode)
			}
			if mode == HostOS {
				properties := def.Parameters.(map[string]any)["properties"].(map[string]any)
				published := properties["action"].(map[string]any)["enum"].([]string)
				for _, action := range actions {
					if !slices.Contains(published, action) {
						t.Fatal("missing desktop action", action)
					}
				}
				// 第109轮：首页 Eyra 不再组建团队，workspace 工具不再发布协同派发动作。
				if _, ok := properties["mode"]; ok || slices.Contains(published, "collaboration_configure") {
					t.Fatal("home mother still publishes team collaboration actions")
				}
			}
		}
	}
	if strings.Contains(string(rawJSON(WorkspaceToolDefinitions())), "link_status") {
		t.Fatal("shared definition mutated")
	}
}
