// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestInteractionToolboxRoutesAndPreservesFailure
// Impact: python -B scripts/code-atlas.py show Core/toolbox_interaction_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestInteractionToolboxRoutesAndPreservesFailure(t *testing.T) {
	var methods []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Method  string `json:"method"`
			Payload struct {
				Session   string          `json:"session_id"`
				Arguments json.RawMessage `json:"arguments"`
			} `json:"payload"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Error(err)
		}
		methods = append(methods, req.Method)
		if req.Payload.Session != "owned-session" || !strings.Contains(string(req.Payload.Arguments), "snapshot") {
			t.Error("lost session or action")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":false,"error":"stale_snapshot"}`))
	}))
	defer server.Close()
	service := &SettingsService{config: filepath.Join(t.TempDir(), "config.json"), endpoint: server.URL + "/private/renderer/index.html"}
	ctx := WithSettingsService(context.Background(), service, "owned-session")
	state := &ToolboxState{}
	for _, name := range []string{"browser", "computer"} {
		call := ToolCall{ID: name, Function: FunctionCall{Name: "toolbox", Arguments: `{"action":"call","name":"` + name + `","arguments":{"action":"snapshot"}}`}}
		if state.Execute(ctx, "", call).OK || len(methods) > 0 {
			t.Fatal("closed optional tool executed")
		}
		if !state.Execute(ctx, "", toolboxCall("open", "open", name)).OK {
			t.Fatal("open failed")
		}
		r := state.Execute(ctx, "", call)
		if r.OK || !strings.Contains(string(r.Data), "stale_snapshot") || methods[0] != "agent:"+name {
			t.Fatal("dispatch or failure lost", r, methods)
		}
		methods = nil
		state.Execute(ctx, "", toolboxCall("close", "close", name))
		if state.Details() != "" {
			t.Fatal("manual persisted after close")
		}
	}
}
