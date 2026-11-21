// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestOfficialToolDisableBlocksAliasesButKeepsOwnedContinuation; TestOfficialToolWorkflowRefreshesInheritedAdmissionBeforeNextStep; TestOfficialToolDisablePreservesReceiptReplayAndRejectsNewPlan; TestOfficialToolDisableBlocksNestedPatchWithoutTouchingFile; TestOfficialToolConfiguredShellGatesDirectPatchWithoutManagerContext
// Impact: python -B scripts/code-atlas.py show Core/tool_official_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"github.com/aieyra/aieyra-os/CORE/modules"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestOfficialToolDisableBlocksAliasesButKeepsOwnedContinuation(t *testing.T) {
	_, _, manager, _, _ := packageAgentFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model request") })
	ctx := WithAgentManager(context.Background(), manager, testMatrixOwner, nil)
	m := manager.toolPackages()
	if !officialToolEnabled(ctx, "terminal") {
		t.Fatal("default terminal missing")
	}
	admitted := withOfficialToolAdmission(ctx)
	packageMutation(t, m, "disable", "", "aieyra.tool.terminal", nil)
	for _, call := range []ToolCall{terminalCall("exec", map[string]any{"cmd": "must-not-run"}), terminalCall("input", map[string]any{"session_id": 9, "chars": "new command"}), executionCall("exec_command", map[string]any{"cmd": "must-not-run"}), executionCall("write_stdin", map[string]any{"session_id": 9, "press_enter": true})} {
		if err := admitOfficialToolCall(ctx, call); err == nil {
			t.Fatal("disabled alias admitted", call)
		}
		if err := admitOfficialToolCall(admitted, call); err != nil {
			t.Fatal("accepted invocation lost its original adapter", err)
		}
	}
	for _, action := range []string{"wait", "read", "stop"} {
		if err := admitOfficialToolCall(ctx, terminalCall(action, map[string]any{"session_id": 9})); err != nil {
			t.Fatal("owned lifecycle blocked", action, err)
		}
	}
	if officialToolEnabled(WithAgentManager(context.Background(), manager, testMatrixOwner, nil), "exec_command") {
		t.Fatal("new context bypassed disable")
	}
	for _, row := range FilterToolDefinitions(ctx, ShellToolDefinitions()) {
		if IsShellTool(row.Name) {
			t.Fatal("disabled empty tool remained in schema", row.Name)
		}
	}
}

func TestOfficialToolWorkflowRefreshesInheritedAdmissionBeforeNextStep(t *testing.T) {
	picture := imageGenTestPNG(t)
	var calls atomic.Int32
	entered, release := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			close(entered)
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]string{"b64_json": base64.StdEncoding.EncodeToString(picture)}}})
	}))
	defer server.Close()
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected language model") })
	m.config = imageGenTestConfig(t, server.URL, true)
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	p, err := modules.Load(context.Background(), filepath.Join(mustProjectRoot(t), "SDK/examples/workbox-images"))
	if err != nil {
		t.Fatal(err)
	}
	var definition map[string]any
	if err = json.Unmarshal(p.Files["workflow.json"], &definition); err != nil {
		t.Fatal(err)
	}
	steps := definition["steps"].([]any)
	steps[2].(map[string]any)["needs"] = []string{"generate"}
	definition["steps"] = []any{steps[0], steps[2]}
	p.Files["workflow.json"] = rawJSON(definition)
	p.Manifest.Version = "1.1.0"
	source := t.TempDir()
	for name, raw := range p.Files {
		if name == "manifest.json" {
			continue
		}
		sum := sha256.Sum256(raw)
		p.Manifest.Files[name] = modules.File{SHA256: hex.EncodeToString(sum[:]), Size: int64(len(raw))}
		f := filepath.Join(source, name)
		if err = os.MkdirAll(filepath.Dir(f), 0700); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(f, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err = os.WriteFile(filepath.Join(source, "manifest.json"), rawJSON(p.Manifest), 0600); err != nil {
		t.Fatal(err)
	}
	installed := packageMutation(t, m.toolPackages(), "install", source, "", p.Manifest.Permissions)
	packageMutation(t, m.toolPackages(), "enable", "", p.Manifest.ID, p.Manifest.Permissions)
	identity := "mod:" + p.Manifest.ID + "@" + installed.Digest
	ctx := WithAgentManager(context.Background(), m, testMatrixOwner, nil)
	i := workflowTestCall(t, m, ctx, identity, map[string]any{"action": "create", "request_id": "native-step-admission", "workdir": dir, "input": map[string]any{"prompt": "first", "edit_prompt": "second", "profile_id": "", "size": "1536x1024"}})
	state := &ToolboxState{Open: map[string]bool{identity: true}}
	ctx = WithToolbox(ctx, state, m.config)
	_, err = ExecuteToolTurn(ctx, &PlanEngine{Receipts: map[string]ToolReceipt{}}, nil, Message{Role: RoleAssistant, ToolCalls: []ToolCall{toolPackageCall("start", identity, workflowCommandArgs("run", i))}}, "toolbox-native-workflow", func(string, any) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("first image did not start")
	}
	packageMutation(t, m.toolPackages(), "disable", "", "aieyra.tool.image_gen", nil)
	close(release)
	i = workflowTestWait(t, m, ctx, identity, i.ID, "failed")
	if calls.Load() != 1 || i.Steps[0].State != "completed" || !strings.Contains(i.Steps[1].Error, "tool_package_disabled") {
		t.Fatal("later workflow step reused prior admission", calls.Load(), i)
	}
}

func TestOfficialToolDisablePreservesReceiptReplayAndRejectsNewPlan(t *testing.T) {
	_, _, manager, _, _ := packageAgentFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model request") })
	ctx := WithAgentManager(context.Background(), manager, testMatrixOwner, nil)
	call := executionCall("update_plan", map[string]any{"action": "create", "objective": "retained plan", "acceptance": []string{"observed"}, "steps": []any{map[string]any{"text": "first"}}})
	engine := &PlanEngine{Receipts: map[string]ToolReceipt{}}
	response := Message{Role: RoleAssistant, ToolCalls: []ToolCall{call}}
	turn, err := ExecuteToolTurn(ctx, engine, nil, response, "official-plan", func(string, any) error { return nil })
	if err != nil || len(turn.Receipts) != 1 || engine.State == nil {
		t.Fatal(turn, err)
	}
	packageMutation(t, manager.toolPackages(), "disable", "", "aieyra.tool.update_plan", nil)
	if _, err = ExecuteToolTurn(ctx, engine, nil, response, "official-plan", func(string, any) error { return nil }); err != nil {
		t.Fatal("old receipt unavailable", err)
	}
	if _, err = ExecuteToolTurn(ctx, engine, nil, response, "new-plan", func(string, any) error { t.Error("disabled tool wrote intent"); return nil }); err == nil || !strings.Contains(err.Error(), "tool_package_disabled") {
		t.Fatal("new plan not denied", err)
	}
}

func TestOfficialToolDisableBlocksNestedPatchWithoutTouchingFile(t *testing.T) {
	_, _, manager, _, _ := packageAgentFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model request") })
	shell := shellTestManager(t)
	defer shell.Close()
	ctx := WithAgentManager(context.Background(), manager, testMatrixOwner, shell)
	packageMutation(t, manager.toolPackages(), "disable", "", "aieyra.tool.apply_patch", nil)
	call := executionCall("exec", map[string]any{"code": "text(await tools.apply_patch({patch:'*** Begin Patch\\n*** Add File: forbidden.txt\\n+should never be written\\n*** End Patch'}));", "yield_time_ms": 10000})
	r, _ := shell.execution.execute(ctx, call, "disabled-nested-patch")
	if r.OK || r.Error == nil || !strings.Contains(r.Error.Message, "tool_package_disabled") {
		t.Fatal("nested patch bypassed registry", r)
	}
	if _, err := os.Stat(filepath.Join(shell.root, "forbidden.txt")); !os.IsNotExist(err) {
		t.Fatal("disabled nested tool changed disk", err)
	}
}

func TestOfficialToolConfiguredShellGatesDirectPatchWithoutManagerContext(t *testing.T) {
	_, _, manager, dir, _ := packageAgentFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model request") })
	shell, err := newPrivateShellManager(manager.config, dir, filepath.Join(t.TempDir(), "execution"))
	if err != nil {
		t.Fatal(err)
	}
	defer shell.Close()
	packageMutation(t, manager.toolPackages(), "disable", "", "aieyra.tool.apply_patch", nil)
	call := executionCall("apply_patch", map[string]any{"patch": "*** Begin Patch\n*** Add File: must-not-exist.txt\n+forbidden\n*** End Patch"})
	_, err = ExecuteToolTurn(context.Background(), &PlanEngine{Receipts: map[string]ToolReceipt{}}, shell, Message{Role: RoleAssistant, ToolCalls: []ToolCall{call}}, "configured-shell-without-manager", func(string, any) error { t.Error("disabled tool wrote intent"); return nil })
	if err == nil || !strings.Contains(err.Error(), "tool_package_disabled") {
		t.Fatal("configured direct host bypassed registry", err)
	}
	if _, err = os.Stat(filepath.Join(dir, "must-not-exist.txt")); !os.IsNotExist(err) {
		t.Fatal("disabled direct patch changed disk", err)
	}
}
