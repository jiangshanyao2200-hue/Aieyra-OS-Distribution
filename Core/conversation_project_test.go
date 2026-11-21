// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestConversationProjectIndexesWorkProductsWithoutPrivateStores; TestToolboxProjectUsesSelectedConversationDirectoryAndRespectsRevocation
// Impact: python -B scripts/code-atlas.py show Core/conversation_project_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConversationProjectIndexesWorkProductsWithoutPrivateStores(t *testing.T) {
	m, _ := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("project discovery called a model") })
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	v, e := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "create", "request_id": "project", "model_id": "local-model", "tools": []string{"project"}}))
	if e != nil {
		t.Fatal(e)
	}
	r := v.(AgentRecord)
	cm, _ := h.conversationManager()
	if e = os.WriteFile(filepath.Join(r.Spec.Workdir, "hello.go"), []byte("package hello\nfunc WorkProduct() {}\n"), 0600); e != nil {
		t.Fatal(e)
	}
	result, e := cm.conversationProject(context.Background(), r.ID, rawJSON(map[string]any{"action": "index_refresh"}))
	if e != nil || result.(map[string]any)["files"] != 1 {
		t.Fatal(result, e)
	}
	result, e = cm.conversationProject(context.Background(), r.ID, rawJSON(map[string]any{"action": "index_query", "query": "WorkProduct"}))
	if e != nil || len(result.(map[string]any)["matches"].([]any)) != 1 {
		t.Fatal(result, e)
	}
	if _, e = cm.conversationProject(context.Background(), r.ID, rawJSON(map[string]any{"action": "read", "path": "../contacts/" + r.ID + ".json"})); e == nil {
		t.Fatal("read escaped selected work products")
	}
	if e = os.Symlink(m.config, filepath.Join(r.Spec.Workdir, "linked.go")); e == nil {
		if _, e = cm.conversationProject(context.Background(), r.ID, rawJSON(map[string]any{"action": "read", "path": "linked.go"})); e == nil {
			t.Fatal("private configuration read through work-product link")
		}
	}
}

func TestToolboxProjectUsesSelectedConversationDirectoryAndRespectsRevocation(t *testing.T) {
	useTestStage(t, ReleaseStage{Toolbox: true, TeamCollaboration: true})
	m, _ := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("toolbox project invoked model") })
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	v, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "create", "request_id": "project-toolbox", "model_id": "local-model", "tools": []string{"project"}}))
	if err != nil {
		t.Fatal(err)
	}
	r := v.(AgentRecord)
	cm, _ := h.conversationManager()
	if err = os.WriteFile(filepath.Join(r.Spec.Workdir, "scope.go"), []byte("package scope\nfunc OwnedProjectEvidence() {}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	ctx := WithToolPermissions(WithAgentManager(context.Background(), cm, r.ID, nil), []string{"project"})
	ctx = context.WithValue(ctx, toolDefinitionRoleKey{}, "cota")
	defs := conversationToolDefinitions(ctx, Defaults(), []string{"project"})
	seen := map[string]int{}
	for _, d := range defs {
		seen[d.Name]++
	}
	if seen["project"] != 0 || seen["toolbox"] != 1 {
		t.Fatal("project schema was not deferred", seen)
	}
	state := &ToolboxState{}
	if opened := state.Execute(ctx, m.config, toolboxCall("open", "open", "project")); !opened.OK {
		t.Fatal(opened)
	}
	call := func(action string) ToolCall {
		return ToolCall{ID: action, Function: FunctionCall{Name: "toolbox", Arguments: string(rawJSON(map[string]any{"action": "call", "name": "project", "arguments": map[string]any{"action": action, "query": "OwnedProjectEvidence"}}))}}
	}
	if indexed := state.Execute(ctx, m.config, call("index_refresh")); !indexed.OK {
		t.Fatal(indexed)
	}
	found := state.Execute(ctx, m.config, call("index_query"))
	if !found.OK || !strings.Contains(string(found.Data), "scope.go") || !strings.Contains(string(found.Data), "OwnedProjectEvidence") {
		t.Fatal("did not query selected workdir", found)
	}
	if denied := state.Execute(WithToolPermissions(ctx, nil), m.config, call("index_query")); denied.OK {
		t.Fatal("open tool bypassed revoked permission")
	}
	ctx = context.WithValue(ctx, toolDefinitionRoleKey{}, "vaya")
	defs = conversationToolDefinitions(ctx, Defaults(), []string{"project"})
	seen = map[string]int{}
	for _, d := range defs {
		seen[d.Name]++
	}
	if seen["project"] != 1 {
		t.Fatal("Vaya lost direct project tool", seen)
	}
}
