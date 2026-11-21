// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: systemCall; TestSystemToolboxKeepsDomainGrantsAndRestore; TestSystemToolboxCredentialArchiveAndIdentity; TestSystemToolboxDiscoverySavings
// Impact: python -B scripts/code-atlas.py show Core/toolbox_system_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	toolboxowner "github.com/aieyra/aieyra-os/tool/toolbox"
	"strings"
	"testing"
)

func systemCall(action, section string, args map[string]any) ToolCall {
	return ToolCall{ID: "system-" + action + "-" + section, Type: "function", Function: FunctionCall{Name: "toolbox", Arguments: string(rawJSON(map[string]any{"action": action, "name": "system", "section": section, "arguments": args}))}}
}
func TestSystemToolboxKeepsDomainGrantsAndRestore(t *testing.T) {
	useTestStage(t, ReleaseStage{Toolbox: true})
	ctx := WithToolPermissions(context.Background(), []string{"settings"})
	state := &ToolboxState{}
	for _, section := range []string{"software", "tools", "", "unknown"} {
		if state.Execute(ctx, "", systemCall("open", section, nil)).OK {
			t.Fatal("unauthorized domain opened", section)
		}
	}
	response := Message{Role: RoleAssistant, ToolCalls: []ToolCall{systemCall("open", "settings", nil)}}
	turn, err := ExecuteToolTurn(WithToolbox(ctx, state, ""), &PlanEngine{}, nil, response, "system-open", func(string, any) error { return nil })
	if err != nil || !state.Open["settings"] {
		t.Fatal("domain did not open", err)
	}
	restored := RestoreToolbox(turn.Messages)
	if !restored.Open["settings"] || restored.Details() != state.Details() {
		t.Fatal("legacy state recovery diverged")
	}
	if restored.Execute(WithToolPermissions(ctx, nil), "", systemCall("call", "settings", map[string]any{"action": "read"})).OK {
		t.Fatal("open state bypassed revoked grant")
	}
	if !restored.Execute(ctx, "", toolboxCall("old-close", "close", "settings")).OK || restored.Details() != "" {
		t.Fatal("legacy close did not close facade manual")
	}
	if state.Execute(ctx, "", systemCall("call", "tools", map[string]any{"action": "list"})).OK {
		t.Fatal("cross-domain call bypassed grant")
	}
}
func TestSystemToolboxCredentialArchiveAndIdentity(t *testing.T) {
	for _, name := range []string{"system", "settings", "software_api"} {
		call := systemCall("call", "settings", map[string]any{"action": "connection_update", "patch": map[string]any{"api_key": "secret-new", "api_key_history": []any{"secret-old"}}, "items": []any{map[string]any{"api_key": "secret-array"}}})
		var args map[string]any
		_ = json.Unmarshal([]byte(call.Function.Arguments), &args)
		args["name"] = name
		call.Function.Arguments = string(rawJSON(args))
		clean := archiveToolCall(call)
		if strings.Contains(clean.Function.Arguments, "secret-") || ToolArgumentHash(clean) != ToolArgumentHash(call) || archiveToolCall(clean).Function.Arguments != clean.Function.Arguments {
			t.Fatal("credential or idempotency regression", name)
		}
	}
}
func TestSystemToolboxDiscoverySavings(t *testing.T) {
	useTestStage(t, ReleaseStage{Toolbox: true})
	w := &Workspace{host: &WorkspaceHost{mode: HostOS}}
	ctx := WithToolPermissions(context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{w, WorkspaceMatrix}), toolboxowner.Names())
	before := 0
	for _, entry := range toolboxDiscovery(ctx) {
		before += len(entry.text()) + len(toolboxowner.DescribeIndex(entry.Capability, entry.Queries, entry.Recovery)) + 2
	}
	after := len(toolboxDiscoveryText(ctx)) + len(toolboxDiscoveryIndex(ctx))
	if after >= before*8/10 {
		t.Fatal("discovery overhead was not materially reduced", before, after)
	}
	if strings.Count(toolboxDiscoveryText(ctx), "system:") != 1 {
		t.Fatal("system facade must appear once")
	}
	t.Logf("public discovery UTF-8 bytes: before=%d after=%d saved=%d; provider token counts not measured", before, after, before-after)
}
