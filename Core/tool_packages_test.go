// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: toolSample; packageMutation; toolPackageCall; awaitPackage; TestToolPackagesLifecyclePermissionsAndRealExecution; TestToolPackageNestedGrantAndDurableReplay; TestToolPackageRunningCancellationAndActivityContinuation; TestToolPackageDefaultRoleAndAssignedMemberUseOwnedWait; TestToolPackagePreviewBoundAndRepeatedContinuation; TestToolPackageFinalPageClearsPendingOutput
// Impact: python -B scripts/code-atlas.py show Core/tool_packages_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/modules"
)

func toolSample(t *testing.T, name, version, code string) string {
	t.Helper()
	source := filepath.Join(mustProjectRoot(t), "SDK", "examples", name)
	p, err := modules.Load(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	if version == "" {
		return source
	}
	dir := t.TempDir()
	p.Manifest.Version = version
	p.Files["run.js"] = []byte(code)
	for name, raw := range p.Files {
		if name == "manifest.json" {
			continue
		}
		sum := sha256.Sum256(raw)
		p.Manifest.Files[name] = modules.File{SHA256: hex.EncodeToString(sum[:]), Size: int64(len(raw))}
		if err = os.WriteFile(filepath.Join(dir, name), raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	raw, _ := json.Marshal(p.Manifest)
	if err = os.WriteFile(filepath.Join(dir, "manifest.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	return dir
}

func packageMutation(t *testing.T, m *modules.Manager, action, source, id string, grants []modules.Permission) modules.Result {
	t.Helper()
	ctx := context.Background()
	list, err := m.Call(ctx, modules.Request{Action: "list"})
	if err != nil {
		t.Fatal(err)
	}
	digest := ""
	if action == "install" {
		ins, e := m.Inspect(ctx, source)
		if e != nil || !ins.Compatibility.Compatible {
			t.Fatalf("inspect: %+v %v", ins, e)
		}
		digest = ins.Digest
	} else {
		for _, item := range list.Items {
			if item.Manifest.ID == id {
				digest = item.Digest
			}
		}
	}
	r, err := m.Call(ctx, modules.Request{Action: action, Source: source, ID: id, Origin: "local", ExpectedRevision: &list.Revision, ExpectedDigest: digest, RequestID: fmt.Sprintf("tool-test-%d-%s", list.Revision, action), Grants: grants})
	if err != nil || !r.OK {
		t.Fatalf("%s: %+v %v", action, r, err)
	}
	return r
}

func toolPackageCall(id, name string, args any) ToolCall {
	raw, _ := json.Marshal(map[string]any{"action": "call", "name": name, "arguments": args})
	return ToolCall{ID: id, Type: "function", Function: FunctionCall{Name: "toolbox", Arguments: string(raw)}}
}

func awaitPackage(t *testing.T, ctx context.Context, shell *ShellManager, r ToolboxResult) ExecResult {
	t.Helper()
	var result ExecResult
	if !r.OK || json.Unmarshal(r.Data, &result) != nil {
		t.Fatalf("package receipt: %+v", r)
	}
	if r.State != result.State || r.CellID != result.CellID {
		t.Fatal("outer receipt lied about cell state", r, result)
	}
	outputs := append([]ExecOutput(nil), result.Output...)
	for pages := 0; result.OK && (result.State == "running" || result.HasMore) && pages < 8; pages++ {
		delay := 10000
		result, _ = shell.execution.execute(ctx, executionCall("wait", WaitRequest{CellID: result.CellID, YieldTimeMS: &delay}), fmt.Sprint("pkg-wait-", pages))
		outputs = append(outputs, result.Output...)
	}
	result.Output = outputs
	if !result.OK || result.State != "completed" || result.HasMore {
		t.Fatal(result)
	}
	return result
}

func TestToolPackagesLifecyclePermissionsAndRealExecution(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model") })
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	shell, err := NewShellManager(dir, filepath.Join(dir, "package-shell"))
	if err != nil {
		t.Fatal(err)
	}
	defer shell.Close()
	ctx := WithAgentManager(context.Background(), m, testMatrixOwner, shell)
	store := m.toolPackages()
	installed := packageMutation(t, store, "install", toolSample(t, "tool-statistics", "", ""), "", nil)
	oldID := "mod:example.statistics@" + installed.Digest
	state := &ToolboxState{}
	if state.Execute(ctx, "", toolboxCall("disabled", "open", oldID)).OK {
		t.Fatal("disabled package opened")
	}
	packageMutation(t, store, "enable", "", "example.statistics", nil)
	child := WithToolPermissions(ctx, []string{oldID, "exec", "wait"})
	if !toolboxAvailable(child) || !strings.Contains(workspaceToolboxCatalog(child), oldID) {
		t.Fatal("explicit version grant missing from discoverable toolbox")
	}
	if strings.Contains(workspaceToolboxCatalog(WithToolPermissions(ctx, []string{"exec", "wait"})), oldID) {
		t.Fatal("unassigned package advertised")
	}
	if state.Execute(WithToolPermissions(ctx, []string{"exec", "wait"}), "", toolboxCall("denied", "open", oldID)).OK {
		t.Fatal("unassigned version opened")
	}
	if r := state.Execute(child, "", toolboxCall("open", "open", oldID)); !r.OK {
		t.Fatal(r)
	}
	if !strings.Contains(state.Details(), "10000") || strings.Contains(state.Details(), "reduce") {
		t.Fatal("manual missing or implementation leaked")
	}
	args := map[string]any{"values": []int{2, 3, 7}}
	r := awaitPackage(t, child, shell, state.Execute(child, "", toolPackageCall("first", oldID, args)))
	if !strings.Contains(selectedText(r), `"sum":12`) {
		t.Fatal(r)
	}
	if state.Execute(child, "", toolPackageCall("invalid", oldID, map[string]any{"values": []string{"bad"}})).OK {
		t.Fatal("invalid input executed")
	}
	next := packageMutation(t, store, "install", toolSample(t, "tool-statistics", "1.1.0", "return {version:2,sum:99};"), "", nil)
	newID := "mod:example.statistics@" + next.Digest
	if state.Execute(ctx, "", toolPackageCall("stale", oldID, args)).OK {
		t.Fatal("stale version executed after update")
	}
	if state.Execute(child, "", toolboxCall("new-unassigned", "open", newID)).OK {
		t.Fatal("old grant followed update")
	}
	if r := state.Execute(ctx, "", toolboxCall("new-open", "open", newID)); !r.OK {
		t.Fatal(r)
	}
	if r := awaitPackage(t, ctx, shell, state.Execute(ctx, "", toolPackageCall("new-run", newID, args))); !strings.Contains(selectedText(r), `"sum":99`) {
		t.Fatal(r)
	}
	packageMutation(t, store, "rollback", "", "example.statistics", nil)
	m.Close()
	reopened, err := NewAgentManager(m.config, testMatrixOwner, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	v, err := reopened.versionedTool(ctx, oldID)
	if err != nil || v.Presentation.Kind != "cards" {
		t.Fatal("restart did not recover enabled rollback", v, err)
	}
	packageMutation(t, store, "disable", "", "example.statistics", nil)
	if _, err = reopened.versionedTool(ctx, oldID); err == nil {
		t.Fatal("restart manager cached enabled tool")
	}
	packageMutation(t, store, "remove", "", "example.statistics", nil)
	if strings.Contains(packageToolCatalogue(ctx), oldID) {
		t.Fatal("removed tool remains discoverable")
	}
}

func TestToolPackageNestedGrantAndDurableReplay(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model") })
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	shell, err := NewShellManager(dir, filepath.Join(dir, "report-shell"))
	if err != nil {
		t.Fatal(err)
	}
	defer shell.Close()
	ctx := WithAgentManager(context.Background(), m, testMatrixOwner, shell)
	store := m.toolPackages()
	installed := packageMutation(t, store, "install", toolSample(t, "toolbox-report", "", ""), "", nil)
	name := "mod:example.report@" + installed.Digest
	if _, err = store.Call(ctx, modules.Request{Action: "enable", ID: "example.report", ExpectedRevision: &installed.Revision, ExpectedDigest: installed.Digest, RequestID: "no-user-grant"}); err == nil {
		t.Fatal("package enabled without user grant")
	}
	packageMutation(t, store, "enable", "", "example.report", installed.Item.Manifest.Permissions)
	state := &ToolboxState{}
	if state.Execute(WithToolPermissions(ctx, []string{name, "exec", "wait"}), "", toolboxCall("missing-inner", "open", name)).OK {
		t.Fatal("missing inner permission accepted")
	}
	child := WithToolPermissions(ctx, []string{name, "exec", "wait", "apply_patch"})
	if r := state.Execute(child, "", toolboxCall("open", "open", name)); !r.OK {
		t.Fatal(r)
	}
	child = WithToolbox(child, state, "")
	engine := &PlanEngine{}
	response := Message{Role: RoleAssistant, ToolCalls: []ToolCall{toolPackageCall("write", name, map[string]any{"values": []int{2, 3, 7}, "workdir": dir, "file": "report.json"})}}
	var kinds []string
	turn, err := ExecuteToolTurn(child, engine, shell, response, "report-invocation", func(kind string, v any) error { kinds = append(kinds, kind); return nil })
	if err != nil || len(kinds) < 3 || kinds[0] != "tool_intent" {
		t.Fatal(turn, err, kinds)
	}
	var result ToolboxResult
	if json.Unmarshal([]byte(turn.Messages[1].Content), &result) != nil {
		t.Fatal("missing result")
	}
	awaitPackage(t, child, shell, result)
	file := filepath.Join(dir, "report.json")
	before, err := os.ReadFile(file)
	if err != nil || !strings.Contains(string(before), "12") {
		t.Fatal(string(before), err)
	}
	again, err := ExecuteToolTurn(child, engine, shell, response, "report-invocation", func(string, any) error { t.Fatal("replay attempted persistence/execution"); return nil })
	if err != nil || !again.Replayed {
		t.Fatal(again, err)
	}
	after, _ := os.ReadFile(file)
	if string(after) != string(before) {
		t.Fatal("replay changed report")
	}
	// The opened manual is not a capability cache: check every new invocation.
	denied := state.Execute(WithToolPermissions(ctx, []string{name, "exec", "wait"}), "", response.ToolCalls[0])
	if denied.OK {
		t.Fatal("revoked inner permission executed")
	}
	stored := filepath.Join(installed.Item.Directory, "run.js")
	if err = os.WriteFile(stored, []byte("return 'tampered'"), 0600); err != nil {
		t.Fatal(err)
	}
	if state.Execute(child, "", toolPackageCall("tampered", name, map[string]any{"values": []int{}, "workdir": dir, "file": "other.json"})).OK {
		t.Fatal("tampered payload executed")
	}
}

func TestToolPackageRunningCancellationAndActivityContinuation(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model") })
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	shell, err := NewShellManager(dir, filepath.Join(dir, "running-shell"))
	if err != nil {
		t.Fatal(err)
	}
	defer shell.Close()
	ctx := WithAgentManager(context.Background(), m, testMatrixOwner, shell)
	store := m.toolPackages()
	installed := packageMutation(t, store, "install", toolSample(t, "tool-statistics", "1.2.0", "text({started:true}); await new Promise(()=>{});"), "", nil)
	name := "mod:example.statistics@" + installed.Digest
	packageMutation(t, store, "enable", "", "example.statistics", nil)
	state := &ToolboxState{}
	state.Execute(ctx, "", toolboxCall("open", "open", name))
	call := toolPackageCall("run", name, map[string]any{"values": []int{}})
	r := state.Execute(ctx, "", call)
	if !r.OK || r.State != "running" || r.CellID == "" {
		t.Fatal("running operation marked complete", r)
	}
	cache := newAgentActivityCache()
	cache.result("run", call, string(rawJSON(r)))
	packageMutation(t, store, "disable", "", "example.statistics", nil)
	cancelled, _ := shell.execution.execute(ctx, executionCall("wait", WaitRequest{CellID: r.CellID, Terminate: true}), "cancel-existing")
	if cancelled.State != "cancelled" {
		t.Fatal(cancelled)
	}
	wait := executionCall("wait", WaitRequest{CellID: r.CellID})
	cache.result("wait", wait, string(rawJSON(cancelled)))
	row := cache.items["run"]
	if row.State != "cancelled" || row.Presentation == nil || !strings.Contains(string(row.Preview), "started") || !strings.Contains(string(row.Preview), name) {
		t.Fatal(row)
	}
	// A later cell finish carries only state. It must retain prior output/view.
	cache.result("run", ToolCall{Function: FunctionCall{Name: "exec"}}, string(rawJSON(map[string]any{"cell_id": r.CellID, "state": "cancelled"})))
	if !strings.Contains(string(cache.items["run"].Preview), "started") {
		t.Fatal("finish erased package output")
	}
	if state.Execute(ctx, "", toolPackageCall("again", name, map[string]any{"values": []int{}})).OK {
		t.Fatal("disabled running package started again")
	}
}

func TestToolPackageDefaultRoleAndAssignedMemberUseOwnedWait(t *testing.T) {
	w := collaborationFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model") }, nil)
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	store := w.manager.toolPackages()
	before := WithAgentManager(context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{w, WorkspaceMatrix}), w.manager, testMatrixOwner, nil)
	before = WithToolPermissions(before, w.permissions(WorkspaceMatrix))
	if toolAllowed(before, "wait") {
		t.Fatal("empty installation changed default schemas")
	}
	installed := packageMutation(t, store, "install", toolSample(t, "tool-statistics", "", ""), "", nil)
	name := "mod:example.statistics@" + installed.Digest
	packageMutation(t, store, "enable", "", "example.statistics", installed.Item.Manifest.Permissions)
	ctx := WithAgentManager(context.Background(), w.manager, testMatrixOwner, nil)
	ctx = context.WithValue(ctx, workspaceContextKey{}, workspaceContext{w, WorkspaceMatrix})
	ctx = WithToolPermissions(ctx, w.permissions(WorkspaceMatrix))
	if !strings.Contains(packageToolCatalogue(ctx), name) || !toolAllowed(ctx, "wait") || toolAllowed(ctx, "exec") {
		t.Fatal("default role cannot use package or acquired arbitrary exec")
	}
	if err := w.grantTeamToolbox(ctx, WorkspaceProject, []string{name}); err != nil {
		t.Fatal(err)
	}
	child := WithToolPermissions(context.WithValue(ctx, workspaceContextKey{}, workspaceContext{w, WorkspaceProject}), w.permissions(WorkspaceProject))
	if !toolboxAvailable(child) || !toolAllowed(child, "wait") || toolAllowed(child, "exec") || !strings.Contains(packageToolCatalogue(child), name) {
		t.Fatal("assigned member cannot discover/query its package")
	}
	if err := w.grantTeamToolbox(ctx, WorkspaceProject, nil); err != nil {
		t.Fatal(err)
	}
	child = WithToolPermissions(child, w.permissions(WorkspaceProject))
	if toolAllowed(child, name) || toolAllowed(child, "wait") {
		t.Fatal("next dispatch retained package capability")
	}
	// An enabled writing package does not confer its missing inner capability.
	report := packageMutation(t, store, "install", toolSample(t, "toolbox-report", "", ""), "", nil)
	reportName := "mod:example.report@" + report.Digest
	packageMutation(t, store, "enable", "", "example.report", report.Item.Manifest.Permissions)
	if !strings.Contains(packageToolCatalogue(ctx), reportName) || w.grantTeamToolbox(ctx, WorkspaceProject, []string{reportName}) == nil {
		t.Fatal("mother lost direct patch capability or investigation member acquired an ungranted capability")
	}
	// A user may explicitly assign the same version to the executing role.
	cota := WithToolPermissions(ctx, append(w.permissions(WorkspaceExecution), reportName))
	v, err := w.manager.versionedTool(cota, reportName)
	if err != nil || versionedToolPermitted(cota, v) != nil || !toolAllowed(cota, "wait") || toolAllowed(cota, "exec") {
		t.Fatal("executor lost its granted package lifecycle", err)
	}
	vaya := WithToolPermissions(ctx, append(w.permissions(WorkspaceProject), reportName))
	if versionedToolPermitted(vaya, v) == nil {
		t.Fatal("recipient missing apply_patch accepted")
	}
}

func TestToolPackagePreviewBoundAndRepeatedContinuation(t *testing.T) {
	name := "mod:example.statistics@" + strings.Repeat("a", 64)
	result := ToolboxResult{Package: name, OK: true, State: "running", Presentation: &ToolPresentation{Kind: "cards", Title: "保留的标题"}, Data: rawJSON(ExecResult{OK: true, State: "running", CellID: "cell", Output: []ExecOutput{{Type: "text", Text: strings.Repeat("<&中文", 20000)}}})}
	preview := boundedPackagePreview(result)
	if len(preview) > 64<<10 || !strings.Contains(string(preview), `"preview_truncated":true`) {
		t.Fatal("preview unbounded or silently clipped", len(preview))
	}
	preview = continuePackagePreview(preview, rawJSON(ExecResult{OK: true, State: "completed", CellID: "cell", Output: []ExecOutput{{Type: "text", Text: "last actual output"}}}))
	if len(preview) > 64<<10 || !strings.Contains(string(preview), `"preview_truncated":true`) || !strings.Contains(string(preview), "保留的标题") {
		t.Fatal("continuation lost bounds or provenance")
	}
}

func TestToolPackageFinalPageClearsPendingOutput(t *testing.T) {
	result := ToolboxResult{Package: "mod:example.statistics@" + strings.Repeat("a", 64), OK: true, State: "running", Data: rawJSON(ExecResult{OK: true, State: "running", CellID: "cell", HasMore: true, Output: []ExecOutput{{Type: "text", Text: "first"}}})}
	next := continuePackagePreview(rawJSON(result), rawJSON(ExecResult{OK: true, State: "completed", CellID: "cell", Output: []ExecOutput{{Type: "text", Text: "last"}}}))
	var saved ToolboxResult
	_ = json.Unmarshal(next, &saved)
	var execution ExecResult
	_ = json.Unmarshal(saved.Data, &execution)
	if execution.HasMore || saved.State != "completed" || len(execution.Output) != 2 {
		t.Fatal("final page retained stale pending state or lost output", string(next))
	}
	next = continuePackagePreview(next, rawJSON(map[string]any{"state": "cancelled", "cell_id": "cell"}))
	_ = json.Unmarshal(next, &saved)
	_ = json.Unmarshal(saved.Data, &execution)
	if execution.OK != saved.OK {
		t.Fatal("cell completion and outer receipt disagree", string(next))
	}
}
