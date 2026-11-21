// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestCustomToolLifecycleThroughToolbox
// Impact: python -B scripts/code-atlas.py show Core/tool_factory_lifecycle_test.go
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

func TestCustomToolLifecycleThroughToolbox(t *testing.T) {
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { fixtureAnswer(w, "assigned", "ready", nil) })
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	shell, err := NewShellManager(dir, filepath.Join(dir, "custom-shell"))
	if err != nil {
		t.Fatal(err)
	}
	defer shell.Close()
	w := &Workspace{manager: m}
	ctx := WithAgentManager(context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{w, WorkspaceMatrix}), m, testMatrixOwner, shell)
	ctx = WithToolPermissions(ctx, []string{"tool_factory", "apply_patch", "exec_command"})
	state := &ToolboxState{}
	ctx = WithToolbox(ctx, state, m.config)
	call := func(id, action, name, section string, args any) ToolboxResult {
		t.Helper()
		r := state.Execute(ctx, m.config, ToolCall{ID: id, Function: FunctionCall{Name: "toolbox", Arguments: string(rawJSON(map[string]any{"action": action, "name": name, "section": section, "arguments": args}))}})
		if !r.OK {
			t.Fatal(r.Error)
		}
		return r
	}
	call("open-factory", "open", "system", "tools", nil)
	register := func(name, code string, caps []string) string {
		t.Helper()
		r := call("register-"+name, "call", "system", "tools", map[string]any{"action": "register", "name": name, "description": "Local lifecycle verification", "code": code, "capabilities": caps, "schema": map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false}})
		var result struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(r.Data, &result) != nil || result.ID == "" {
			t.Fatal(string(r.Data))
		}
		return result.ID
	}
	pure := register("delayed", `const until=Date.now()+1400; while(Date.now()<until){}; return {verified:true};`, []string{})
	if !packageWaitAvailable(ctx) || !toolAllowed(ctx, "wait") || toolAllowed(ctx, "exec") {
		t.Fatal("custom lifecycle requires wait without arbitrary exec")
	}
	assigned := WithToolPermissions(ctx, []string{pure})
	if !toolAllowed(assigned, "wait") || toolAllowed(assigned, "exec") {
		t.Fatal("assigned version did not expose only its wait route")
	}
	if r := state.Execute(assigned, m.config, toolboxCall("open-pure", "open", pure)); !r.OK {
		t.Fatal(r.Error)
	}
	r := state.Execute(assigned, m.config, toolPackageCall("run-pure", pure, map[string]any{}))
	if !r.OK || r.State != "running" || r.CellID == "" {
		t.Fatal("long custom call did not yield", r)
	}
	// Use the public turn dispatcher, including permission checks and receipts.
	delay := 10000
	turn, err := ExecuteToolTurn(assigned, &PlanEngine{}, shell, Message{Role: RoleAssistant, ToolCalls: []ToolCall{executionCall("wait", WaitRequest{CellID: r.CellID, YieldTimeMS: &delay})}}, "wait-pure", func(string, any) error { return nil })
	if err != nil || len(turn.Messages) != 2 {
		t.Fatal(err, turn)
	}
	var execution ExecResult
	if json.Unmarshal([]byte(turn.Messages[1].Content), &execution) != nil || !execution.OK || execution.State != "completed" || !strings.Contains(selectedText(execution), `"verified":true`) {
		t.Fatal(turn)
	}
	writer := register("file_work", portableTestCode(`const patched=await tools.apply_patch("*** Begin Patch\n*** Add File: generated.txt\n+factory-lifecycle\n*** End Patch"); if(!patched.ok) throw Error("patch failed"); const read=await tools.exec_command({cmd:"Get-Content -LiteralPath generated.txt",yield_time_ms:30000}); if(!read.ok||read.exit_code!==0) throw Error("read failed"); text(read.output);`), []string{"apply_patch", "exec_command"})
	call("open-writer", "open", writer, "", nil)
	result := awaitPackage(t, ctx, shell, call("run-writer", "call", writer, "", map[string]any{}))
	actual, err := os.ReadFile(filepath.Join(dir, "generated.txt"))
	if err != nil || strings.TrimSpace(string(actual)) != "factory-lifecycle" || !strings.Contains(selectedText(result), "factory-lifecycle") {
		t.Fatal("independent read disagrees", err, result)
	}
	if r := state.Execute(WithToolPermissions(ctx, []string{writer}), m.config, toolboxCall("missing-dependency", "open", writer)); r.OK {
		t.Fatal("nested dependency bypassed")
	}
	if r := state.Execute(ctx, m.config, toolPackageCall("invalid-input", writer, map[string]any{"unexpected": true})); r.OK {
		t.Fatal("schema violation executed")
	}
	second := register("file_work", "return 2;", []string{})
	if second == writer {
		t.Fatal("changed implementation reused version")
	}
	if _, err = m.Create(ctx, testMatrixOwner, AgentSpec{RequestID: "missing-capability", ModelID: "local-model", Task: "ready", Workdir: dir, Tools: []string{writer}}); err == nil {
		t.Fatal("assignment ignored dependencies")
	}
	job, err := m.Create(ctx, testMatrixOwner, AgentSpec{RequestID: "assign-version", ModelID: "local-model", Task: "ready", Workdir: dir, Tools: []string{pure}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.Wait(context.Background(), testMatrixOwner, job.ID, 10000); err != nil {
		t.Fatal(err)
	}
	if _, err = m.toolFactory(ctx, rawJSON(map[string]any{"action": "remove", "id": pure})); err == nil {
		t.Fatal("removed a persisted assignment")
	}
	call("remove-unassigned", "call", "system", "tools", map[string]any{"action": "remove", "id": second})
	listed := call("discover", "call", "system", "tools", map[string]any{"action": "list"})
	if !strings.Contains(string(listed.Data), writer) || strings.Contains(string(listed.Data), second) {
		t.Fatal(string(listed.Data))
	}
	m.Close()
	reopened, err := NewAgentManager(m.config, testMatrixOwner, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if _, err = reopened.customTool(writer); err != nil {
		t.Fatal("reopen lost immutable version", err)
	}
	if _, err = reopened.customTool(second); err == nil {
		t.Fatal("reopen restored removed version")
	}
}
