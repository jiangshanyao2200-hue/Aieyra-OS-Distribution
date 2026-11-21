// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: installWorkflowSample; workflowTestCall; workflowTestWait; workflowCommandArgs; TestWorkboxRealToolsReviewRestartAndIdempotency; TestWorkboxDependencyChangesBlockNewStepsAndPreserveResults; TestWorkboxImagePauseRecoveryNeverResubmits; TestWorkboxSpecialistUsesExistingManagerAndIsolatedTemplate; TestWorkboxNativeServiceUsesSameOwnerReceiptsAndRejectsCrossTask; TestWorkboxUnknownImageNeverReplaysAcrossCommands; TestWorkboxCompletionOutboxRetainsEveryGeneration
// Impact: python -B scripts/code-atlas.py show Core/workbox_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aieyra/aieyra-os/CORE/modules"
	"github.com/aieyra/aieyra-os/tool/workbox"
)

func installWorkflowSample(t *testing.T, m *AgentManager, sample string) string {
	t.Helper()
	source := filepath.Join(mustProjectRoot(t), "SDK", "examples", sample)
	p, err := modules.Load(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	r := packageMutation(t, m.toolPackages(), "install", source, "", p.Manifest.Permissions)
	packageMutation(t, m.toolPackages(), "enable", "", p.Manifest.ID, p.Manifest.Permissions)
	return "mod:" + p.Manifest.ID + "@" + r.Digest
}
func workflowTestCall(t *testing.T, m *AgentManager, ctx context.Context, id string, args any) workbox.Instance {
	t.Helper()
	i, err := m.workflowCall(ctx, testMatrixOwner, id, rawJSON(args))
	if err != nil {
		t.Fatalf("workflow call %s: %v", string(rawJSON(args)), err)
	}
	return i
}
func workflowTestWait(t *testing.T, m *AgentManager, ctx context.Context, identity, id, want string) workbox.Instance {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		i := workflowTestCall(t, m, ctx, identity, map[string]any{"action": "status", "id": id})
		if i.State == want {
			return i
		}
		if i.State != "running" && i.State != "pause_requested" && i.State != "cancel_requested" {
			t.Fatalf("workflow expected %s got %+v", want, i)
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("workflow did not settle")
	return workbox.Instance{}
}
func workflowCommandArgs(action string, i workbox.Instance) map[string]any {
	return map[string]any{"action": action, "id": i.ID, "expected_revision": i.Revision, "request_id": action + "-" + imageBatchToken()}
}

func TestWorkboxRealToolsReviewRestartAndIdempotency(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model") })
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	ctx := context.Background()
	installWorkflowSample(t, m, "tool-statistics")
	installWorkflowSample(t, m, "toolbox-report")
	identity := installWorkflowSample(t, m, "workbox-statistics")
	input := map[string]any{"values": []any{2, 3, 7}, "workdir": dir, "file": "workflow-report.json"}
	create := map[string]any{"action": "create", "request_id": "actual-statistics", "workdir": dir, "input": input}
	i := workflowTestCall(t, m, ctx, identity, create)
	retry := workflowTestCall(t, m, ctx, identity, create)
	if retry.ID != i.ID || retry.Revision != i.Revision {
		t.Fatal("create replay changed instance")
	}
	denied := WithToolPermissions(ctx, []string{identity, "wait"})
	if _, err := m.workflowCall(denied, testMatrixOwner, identity, rawJSON(workflowCommandArgs("run", i))); err == nil {
		t.Fatal("workflow bypassed dependency permissions")
	}
	run := workflowCommandArgs("run", i)
	workflowTestCall(t, m, ctx, identity, run)
	i = workflowTestWait(t, m, ctx, identity, i.ID, "awaiting_review")
	if i.Steps[0].Attempts != 1 || !strings.Contains(string(i.Steps[0].Result), `"sum":12`) {
		t.Fatal(i)
	}
	if _, err := os.Stat(filepath.Join(dir, "workflow-report.json")); !os.IsNotExist(err) {
		t.Fatal("export bypassed review", err)
	}
	replay := workflowTestCall(t, m, ctx, identity, run)
	if replay.State != "awaiting_review" || replay.Steps[0].Attempts != 1 {
		t.Fatal("duplicate run replayed", replay)
	}
	if _, err := m.workflowCall(ctx, "different-owner", identity, rawJSON(map[string]any{"action": "status", "id": i.ID})); err == nil {
		t.Fatal("cross-owner workflow read")
	}
	// New command reads persisted state after the runner and its owned shell
	// have ended. Approval cannot dispatch anything until an explicit resume.
	approve := workflowCommandArgs("approve", i)
	approve["step"] = "review"
	i = workflowTestCall(t, m, ctx, identity, approve)
	workflowTestCall(t, m, ctx, identity, workflowCommandArgs("resume", i))
	i = workflowTestWait(t, m, ctx, identity, i.ID, "completed")
	raw, err := os.ReadFile(filepath.Join(dir, "workflow-report.json"))
	if err != nil || !strings.Contains(string(raw), `"value": 12`) {
		t.Fatal(string(raw), err)
	}
	if i.Steps[0].Attempts != 1 || i.Steps[2].Attempts != 1 || i.Outputs["report"] == nil {
		t.Fatal("missing preserved result", i)
	}
	// Even a disabled old package remains readable through an already opened
	// Toolbox; current discovery does not resurrect it.
	packageMutation(t, m.toolPackages(), "disable", "", "example.statistics-workflow", nil)
	state := &ToolboxState{Open: map[string]bool{identity: true}}
	toolctx := WithAgentManager(ctx, m, testMatrixOwner, nil)
	receipt := state.Execute(toolctx, m.config, toolPackageCall("saved-status", identity, map[string]any{"action": "status", "id": i.ID}))
	if !receipt.OK || receipt.State != "completed" || !strings.Contains(string(receipt.Data), "workflow-report.json") {
		t.Fatal(receipt)
	}
}

func TestWorkboxDependencyChangesBlockNewStepsAndPreserveResults(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model") })
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	ctx := context.Background()
	installWorkflowSample(t, m, "tool-statistics")
	installWorkflowSample(t, m, "toolbox-report")
	identity := installWorkflowSample(t, m, "workbox-statistics")
	i := workflowTestCall(t, m, ctx, identity, map[string]any{"action": "create", "request_id": "locked", "workdir": dir, "input": map[string]any{"values": []int{12}, "workdir": dir, "file": "locked.json"}})
	workflowTestCall(t, m, ctx, identity, workflowCommandArgs("run", i))
	i = workflowTestWait(t, m, ctx, identity, i.ID, "awaiting_review")
	before := string(i.Steps[0].Result)
	packageMutation(t, m.toolPackages(), "install", toolSample(t, "tool-statistics", "1.1.0", "return {sum:999};"), "", nil)
	approve := workflowCommandArgs("approve", i)
	approve["step"] = "review"
	if _, err := m.workflowCall(ctx, testMatrixOwner, identity, rawJSON(approve)); err == nil {
		t.Fatal("updated dependency silently changed workflow plan")
	}
	status := workflowTestCall(t, m, ctx, identity, map[string]any{"action": "status", "id": i.ID})
	if string(status.Steps[0].Result) != before {
		t.Fatal("update erased receipt")
	}
	if _, err := os.Stat(filepath.Join(dir, "locked.json")); !os.IsNotExist(err) {
		t.Fatal("update dispatched a different tool")
	}
	packageMutation(t, m.toolPackages(), "rollback", "", "example.statistics", nil)
	i = workflowTestCall(t, m, ctx, identity, approve)
	if i.State != "paused" {
		t.Fatal(i)
	}
}

func TestWorkboxImagePauseRecoveryNeverResubmits(t *testing.T) {
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
		_ = json.NewEncoder(w).Encode(map[string]any{"usage": map[string]int{"input_tokens": 39, "output_tokens": 515}, "data": []any{map[string]string{"b64_json": base64.StdEncoding.EncodeToString(picture)}}})
	}))
	defer server.Close()
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected language model") })
	m.config = imageGenTestConfig(t, server.URL, true)
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	ctx := context.WithValue(context.Background(), imageUsageWriterKey{}, func(AgentUsage) error { return fmt.Errorf("stale caller generation") })
	identity := installWorkflowSample(t, m, "workbox-images")
	i := workflowTestCall(t, m, ctx, identity, map[string]any{"action": "create", "request_id": "images", "workdir": dir, "input": map[string]any{"prompt": "watercolor landscape", "edit_prompt": "add a small tree", "profile_id": "", "size": "1536x1024"}})
	workflowTestCall(t, m, ctx, identity, workflowCommandArgs("run", i))
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("image never reached provider")
	}
	i = workflowTestCall(t, m, ctx, identity, map[string]any{"action": "status", "id": i.ID})
	workflowTestCall(t, m, ctx, identity, workflowCommandArgs("pause", i))
	close(release)
	i = workflowTestWait(t, m, ctx, identity, i.ID, "paused")
	if calls.Load() != 1 || i.Steps[0].State != "completed" {
		t.Fatal(i, calls.Load())
	}
	// Simulate a crash between receipt persistence and workflow commit. The
	// original batch contains the paid response; recovery must only read it.
	store, _ := m.workflowStore(testMatrixOwner, i.ID)
	_, err := store.update(ctx, func(d *workboxDocument) error {
		d.Instance.State = "running"
		d.Instance.Steps[0].State = "in_flight"
		d.Instance.Steps[0].Result = nil
		workflowTouch(&d.Instance)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	i = workflowTestCall(t, m, ctx, identity, map[string]any{"action": "status", "id": i.ID})
	i = workflowTestCall(t, m, ctx, identity, workflowCommandArgs("recover", i))
	if i.State != "paused" || i.Steps[0].State != "completed" || calls.Load() != 1 {
		t.Fatal("recovery resubmitted", i, calls.Load())
	}
	workflowTestCall(t, m, ctx, identity, workflowCommandArgs("resume", i))
	i = workflowTestWait(t, m, ctx, identity, i.ID, "awaiting_review")
	approve := workflowCommandArgs("approve", i)
	approve["step"] = "review"
	i = workflowTestCall(t, m, ctx, identity, approve)
	workflowTestCall(t, m, ctx, identity, workflowCommandArgs("resume", i))
	i = workflowTestWait(t, m, ctx, identity, i.ID, "completed")
	if calls.Load() != 2 || i.Steps[0].Attempts != 1 || i.Steps[2].Attempts != 1 || len(i.Usage) != 2 || !i.Usage[0].Reported || i.Usage[0].Input != 39 || i.Usage[1].Output != 515 {
		t.Fatal(i, calls.Load())
	}
	for _, key := range []string{"original", "edited"} {
		paths, ok := i.Outputs[key].([]any)
		if !ok || len(paths) != 1 {
			t.Fatal(i.Outputs)
		}
		if _, err := os.Stat(paths[0].(string)); err != nil {
			t.Fatal(err)
		}
	}
}

func TestWorkboxSpecialistUsesExistingManagerAndIsolatedTemplate(t *testing.T) {
	var requests atomic.Int32
	var identity, instanceID string
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		encoded := string(rawJSON(body))
		if strings.Contains(encoded, "PRIVATE_PARENT_BASELINE") || strings.Contains(encoded, "shared_baseline") || strings.Contains(encoded, "pac_memory") {
			t.Error("specialist inherited parent context")
		}
		switch requests.Add(1) {
		case 1:
			fixtureAnswer(w, "open", "", []any{map[string]any{"type": "function_call", "id": "wf-open", "call_id": "wf-open", "name": "toolbox", "arguments": string(rawJSON(map[string]any{"action": "open", "name": identity}))}})
		case 2:
			fixtureAnswer(w, "status", "", []any{map[string]any{"type": "function_call", "id": "wf-status", "call_id": "wf-status", "name": "toolbox", "arguments": string(rawJSON(map[string]any{"action": "call", "name": identity, "arguments": map[string]any{"action": "status", "id": instanceID}}))}})
		default:
			if !strings.Contains(encoded, `aieyra.workbox-state/1`) {
				t.Error("specialist could not read its workflow")
			}
			fixtureAnswer(w, "done", "Workflow inspected; awaiting instruction.", nil)
		}
	})
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	ctx := context.Background()
	installWorkflowSample(t, m, "tool-statistics")
	installWorkflowSample(t, m, "toolbox-report")
	identity = installWorkflowSample(t, m, "workbox-statistics")
	parent := "11111111111111111111111111111111"
	parentTools := []string{"tool_factory", "apply_patch"}
	w := &Workspace{manager: m, config: m.config, live: map[string]WorkspaceLive{}, prompt: "PRIVATE_PARENT_BASELINE", state: workspaceState{ID: testMatrixOwner}}
	m.workspace = w
	m.jobs[parent] = &agentJob{record: AgentRecord{ID: parent, Parent: testMatrixOwner, State: "running", Depth: 1, Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix, Tools: parentTools}}}
	ctx = context.WithValue(WithToolPermissions(WithAgentManager(ctx, m, parent, nil), parentTools), workspaceContextKey{}, workspaceContext{workspace: w, role: WorkspaceMatrix})
	i, err := m.workflowCall(ctx, parent, identity, rawJSON(map[string]any{"action": "create", "request_id": "specialist", "workdir": dir, "input": map[string]any{"values": []int{12}, "workdir": dir, "file": "agent.json"}}))
	if err != nil {
		t.Fatal(err)
	}
	instanceID = i.ID
	create := workflowCommandArgs("create_agent", i)
	create["model_id"] = "local-model"
	i, err = m.workflowCall(ctx, parent, identity, rawJSON(create))
	if err != nil {
		t.Fatal(err)
	}
	r, err := m.Wait(context.Background(), parent, i.AgentID, 10000)
	if err != nil || r.State != "completed" || r.ToolTurns != 2 {
		t.Fatal(r, err)
	}
	if r.Parent != parent || r.Spec.WorkflowID != i.ID || r.Spec.MaxTokens != 8000 || r.Spec.TimeoutSeconds != 300 {
		t.Fatal("specialist lost template identity or budget", r)
	}
	again, err := m.workflowCall(ctx, parent, identity, rawJSON(create))
	if err != nil || again.AgentID != i.AgentID || requests.Load() != 3 {
		t.Fatal("repeated template created another Agent", again, err, requests.Load())
	}
	if _, err := m.workflowCall(ctx, i.AgentID, identity, rawJSON(map[string]any{"action": "status", "id": "w-" + strings.Repeat("0", 32)})); err == nil {
		t.Fatal("specialist crossed workflow binding")
	}
	forged := r.Spec
	forged.RequestID = "forged"
	if _, err = m.Create(context.Background(), parent, forged); err == nil {
		t.Fatal("ordinary agent creation forged a workflow binding")
	}
}

func TestWorkboxNativeServiceUsesSameOwnerReceiptsAndRejectsCrossTask(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model") })
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	identity := installWorkflowSample(t, m, "workbox-images")
	h := NewWorkspaceHost(m.config, "", "")
	w := &Workspace{host: h, manager: m, config: m.config, state: workspaceState{ID: testMatrixOwner, Workdir: dir}}
	create := map[string]any{"action": "create", "request_id": "native", "workdir": dir, "input": map[string]any{"prompt": "a tree", "edit_prompt": "add a bird", "profile_id": "", "size": "1536x1024"}}
	result, err := w.Call(context.Background(), "workspace.workflows", rawJSON(map[string]any{"action": "call", "package": identity, "command": create}))
	if err != nil {
		t.Fatal(err)
	}
	response := result.(map[string]any)
	if response["ok"] != true {
		t.Fatal(response)
	}
	i := response["instance"].(workbox.Instance)
	status := workflowTestCall(t, m, context.Background(), identity, map[string]any{"action": "status", "id": i.ID})
	if status.Revision != i.Revision {
		t.Fatal("UI created a separate workflow state")
	}
	for _, bad := range []map[string]any{{"action": "list", "package": identity, "task_id": "other"}, {"action": "list", "package": identity, "owner": "other"}} {
		if _, err := w.Call(context.Background(), "workspace.workflows", rawJSON(bad)); err == nil {
			t.Fatal("native service accepted another owner/task", bad)
		}
	}
	w.split = &workspaceSplit{}
	if _, err := w.Call(context.Background(), "workspace.workflows", rawJSON(map[string]any{"action": "list", "package": identity})); err == nil {
		t.Fatal("split task acquired root workflow authority")
	}
}

func TestWorkboxUnknownImageNeverReplaysAcrossCommands(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(500) }))
	defer server.Close()
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model") })
	m.config = imageGenTestConfig(t, server.URL, true)
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	ctx := context.Background()
	identity := installWorkflowSample(t, m, "workbox-images")
	create := map[string]any{"action": "create", "request_id": "unknown", "workdir": dir, "input": map[string]any{"prompt": "one uncertain image", "edit_prompt": "no replay", "profile_id": "", "size": "1536x1024"}}
	i := workflowTestCall(t, m, ctx, identity, create)
	workflowTestCall(t, m, ctx, identity, workflowCommandArgs("run", i))
	i = workflowTestWait(t, m, ctx, identity, i.ID, "unknown")
	if calls.Load() != 1 || i.Steps[0].Attempts != 1 {
		t.Fatal(i, calls.Load())
	}
	recovery := workflowCommandArgs("recover", i)
	i = workflowTestCall(t, m, ctx, identity, recovery)
	workflowTestCall(t, m, ctx, identity, recovery)
	workflowTestCall(t, m, ctx, identity, create)
	if _, err := m.workflowCall(ctx, testMatrixOwner, identity, rawJSON(workflowCommandArgs("resume", i))); err == nil {
		t.Fatal("unknown effect resumed")
	}
	i = workflowTestCall(t, m, ctx, identity, workflowCommandArgs("cancel", i))
	if i.State != "cancelled" || i.Steps[0].State != "unknown" || i.Steps[0].Receipt == "" || calls.Load() != 1 {
		t.Fatal("cancellation erased or replayed uncertain effect", i, calls.Load())
	}
}

func TestWorkboxCompletionOutboxRetainsEveryGeneration(t *testing.T) {
	m, _ := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model") })
	id := "22222222222222222222222222222222"
	r := AgentRecord{ID: id, Parent: testMatrixOwner, Depth: 1, Generation: 2, State: "completed", Result: "Second result", History: []AgentOutcome{{Generation: 1, State: "completed", Result: "First result"}}, Spec: AgentSpec{WorkflowID: "w-" + strings.Repeat("a", 32), Title: "Workflow specialist"}}
	m.jobs[id] = &agentJob{record: r}
	w := &Workspace{manager: m, dir: t.TempDir(), state: workspaceState{ID: testMatrixOwner}}
	m.workspace = w
	pump := func() { w.mu.Lock(); defer w.mu.Unlock(); w.deliverWorkboxResultsLocked() }
	pump()
	pump()
	if len(w.state.Messages) != 1 || !strings.Contains(w.state.Messages[0].Text, "First result") || !internalTeamNotification(w.state.Messages[0]) {
		t.Fatal(w.state.Messages)
	}
	// Loss of the ephemeral workspace cannot lose a queued completion.
	noticeID := w.state.Messages[0].ID
	w.state.Messages = nil
	pump()
	if len(w.state.Messages) != 1 || w.state.Messages[0].ID != noticeID {
		t.Fatal("pending outbox was lost", w.state.Messages)
	}
	w.state.Messages[0].State = "delivered"
	pump()
	pump()
	if len(w.state.Messages) != 2 || !strings.Contains(w.state.Messages[1].Text, "Second result") {
		t.Fatal(w.state.Messages)
	}
	w.state.Messages[1].State = "completed"
	pump()
	pump()
	if len(w.state.Messages) != 2 || m.jobs[id].record.WorkflowNotified != 2 || m.jobs[id].record.WorkflowNotice != nil {
		t.Fatal("completion duplicated")
	}
	w.state.Messages = nil
	pump()
	if len(w.state.Messages) != 0 {
		t.Fatal("acknowledged notices replayed")
	}
}
