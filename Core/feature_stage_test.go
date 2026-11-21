// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: stageTestResources; useTestStage; TestStageConfigRejectsNonBooleanAndMissingValues; TestBasicStageToolExposureAndStaleCalls; TestBasicStageDirectAgentsDurableCreateAndReplay; TestBasicStageMemoryAndSubconscious
// Impact: python -B scripts/code-atlas.py show Core/feature_stage_test.go
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
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aieyra/aieyra-os/contracts/resources"
)

// Dormant capabilities remain regression-tested in an isolated public resource tree.
// Tests for the shipping basic stage explicitly close all switches in their own tree.
func stageTestResources(source, dest string, stage ReleaseStage) error {
	if err := os.MkdirAll(filepath.Join(dest, "Config"), 0700); err != nil {
		return err
	}
	for _, name := range []string{"默认设置.json", "模型目录.json", "模型资料.json", "OpenCode模型.json", "运行参数.json", "提示词索引.json", "终端配色.json"} {
		data, err := os.ReadFile(filepath.Join(source, "Config", name))
		if err != nil {
			return err
		}
		if name == "运行参数.json" {
			var values map[string]any
			if err = json.Unmarshal(data, &values); err != nil {
				return err
			}
			values["release_stage"] = stage
			// This helper explicitly selects a legacy full/basic test stage.
			// Production's selective whitelist must not silently alter those fixtures.
			// Selective-stage tests add their own list after staging the resources.
			delete(values, "toolbox_capabilities")
			data, err = json.Marshal(values)
			if err != nil {
				return err
			}
		}
		if err = os.WriteFile(filepath.Join(dest, "Config", name), data, 0600); err != nil {
			return err
		}
	}
	data, err := os.ReadFile(filepath.Join(source, "Config", "提示词索引.json"))
	if err != nil {
		return err
	}
	index, err := resources.ParsePromptIndex(data)
	if err != nil {
		return err
	}
	names := index.Files()
	for _, name := range names {
		data, err = os.ReadFile(filepath.Join(source, filepath.FromSlash(name)))
		if err != nil {
			return err
		}
		file := filepath.Join(dest, filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			return err
		}
		if err = os.WriteFile(file, data, 0600); err != nil {
			return err
		}
	}
	return nil
}

func useTestStage(t *testing.T, stage ReleaseStage) {
	t.Helper()
	root := t.TempDir()
	if err := stageTestResources(ResourceRoot(), root, stage); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AIEYRA_RESOURCE_ROOT", root)
}

func TestStageConfigRejectsNonBooleanAndMissingValues(t *testing.T) {
	root := t.TempDir()
	t.Setenv("AIEYRA_RESOURCE_ROOT", root)
	if CurrentReleaseStage() != (ReleaseStage{}) {
		t.Fatal("missing config enabled features")
	}
	if err := os.Mkdir(filepath.Join(root, "Config"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "Config", "运行参数.json"), []byte(`{"release_stage":{"team_collaboration":false,"toolbox":true,"link_situation":true,"cli":"true"}}`), 0600); err != nil {
		t.Fatal(err)
	}
	if got := CurrentReleaseStage(); got != (ReleaseStage{Toolbox: true, LinkSituation: true}) {
		t.Fatal("invalid type enabled capability", got)
	}
}

func TestBasicStageToolExposureAndStaleCalls(t *testing.T) {
	useTestStage(t, ReleaseStage{})
	w := collaborationFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected provider call") }, nil)
	setTeamProfiles(t, w, "local-model", "", nil)
	ctx := WithToolPermissions(context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{w, WorkspaceMatrix}), w.permissions(WorkspaceMatrix))
	settings, err := Load(w.config)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, d := range FilterToolDefinitions(ctx, CodingToolDefinitions(settings)) {
		names = append(names, d.Name)
	}
	for _, name := range []string{"agents", "memory", "project", "update_plan", "report", "image_gen"} {
		if !slices.Contains(names, name) {
			t.Fatalf("missing %s: %v", name, names)
		}
	}
	if slices.Contains(names, "toolbox") {
		t.Fatal("Toolbox advertised")
	}
	if slices.Contains(names, "models") {
		t.Fatal("model discovery must use the shared agents entry")
	}
	for _, name := range w.permissions(WorkspaceMatrix) {
		if !stageToolAllowed(name) {
			t.Errorf("stage-disabled capability assigned to Eyra: %s", name)
		}
	}
	// Direct coding is part of Eyra's basic task execution. Optional teams and
	// toolbox capabilities remain subject to the release stage.
	for _, name := range []string{"terminal", "apply_patch"} {
		if !slices.Contains(names, name) || permittedCall(ctx, executionCall(name, map[string]any{})) != nil {
			t.Fatalf("direct coding tool unavailable: %s", name)
		}
	}
	for _, name := range []string{"team", "ask_subconscious", "share_diary", "browser", "computer", "custom:old"} {
		if slices.Contains(names, name) || permittedCall(ctx, executionCall(name, map[string]any{})) == nil {
			t.Fatalf("hidden tool usable: %s", name)
		}
	}
	old := []Message{{Role: RoleTool, Name: "toolbox", Content: `{"ok":true,"open":{"browser":true},"manuals":{"browser":"old instructions"}}`}}
	if restored := RestoreToolbox(old); len(restored.Open) != 0 || restored.Details() != "" {
		t.Fatal("restored disabled Toolbox")
	}
	if result := (&ToolboxState{Open: map[string]bool{"browser": true}}).Execute(ctx, w.config, toolboxCall("old", "call", "browser")); result.OK || result.Error == nil {
		t.Fatal("stale toolbox call accepted")
	}
	if ready, _ := w.collaborationReady(); ready {
		t.Fatal("saved team preference bypassed stage")
	}
	for _, action := range []string{"status", "collaboration_status"} {
		if _, err := w.collaborationCall(ctx, WorkspaceMatrix, rawJSON(map[string]any{"action": action})); err != nil {
			t.Fatal("read-only compatibility status rejected", err)
		}
	}
	if _, err := w.collaborationCall(ctx, WorkspaceMatrix, rawJSON(map[string]any{"action": "collaboration_configure", "mode": "natural"})); err == nil {
		t.Fatal("stage bypassed by configure")
	}
	if _, err := w.team(ctx, WorkspaceMatrix, rawJSON(map[string]any{"action": "dispatch", "role": "project", "message": "work"})); err == nil {
		t.Fatal("team dispatched")
	}
	if !strings.Contains(w.roleContract(WorkspaceMatrix), "未声明的 team、toolbox 或专业身份接口在当前阶段不可用") {
		t.Fatal("incorrect stage contract")
	}
}

func TestBasicStageDirectAgentsDurableCreateAndReplay(t *testing.T) {
	useTestStage(t, ReleaseStage{})
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	var calls atomic.Int32
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, req *http.Request) {
		calls.Add(1)
		close(entered)
		select {
		case <-release:
		case <-req.Context().Done():
			return
		}
		fixtureAnswer(rw, "home", "done", nil)
	})
	h, w := openCoreLinkHome(t, m.config, dir)
	defer h.Close()
	defer once.Do(func() { close(release) })
	if _, err := w.Send("user-task", "create a contact"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("primary actor did not start")
	}
	w.mu.Lock()
	actor := w.state.Roles[WorkspaceMatrix]
	w.mu.Unlock()
	ctx := context.WithValue(context.Background(), agentManagerKey{}, agentManagerContext{manager: w.manager, owner: actor})
	ctx = context.WithValue(ctx, conversationLinkCallerKey{}, conversationLinkCaller{ID: actor, Generation: 1})
	ctx = WithToolPermissions(ctx, []string{"agents"})
	call := executionCall("agents", map[string]any{"action": "create", "kind": "conversation", "request_id": "direct-create", "reason": "用户要求创建独立联系人", "model_id": "local-model", "title": "直达", "prompt": "独立对话"})
	call.ID = "direct-agent-call"
	engine := &PlanEngine{Receipts: map[string]ToolReceipt{}}
	response := Message{Role: RoleAssistant, ToolCalls: []ToolCall{call}}
	var receipts int
	persist := func(kind string, _ any) error {
		if kind == "tool_progress" {
			receipts++
		}
		return nil
	}
	turn, err := ExecuteToolTurn(ctx, engine, nil, response, "direct-agent-turn", persist)
	if err != nil {
		t.Fatal(err)
	}
	var result ToolboxResult
	if err = json.Unmarshal([]byte(turn.Messages[1].Content), &result); err != nil || !result.OK {
		t.Fatal(result, err)
	}
	var created AgentRecord
	if err = json.Unmarshal(result.Data, &created); err != nil || created.State != "idle" {
		t.Fatal(created, err)
	}
	// Adopt the committed receipts exactly as the runtime does, then replay.
	if len(turn.Receipts) == 0 {
		t.Fatal("missing durable receipt")
	}
	for _, receipt := range turn.Receipts {
		engine.Receipts[receipt.Key] = receipt
	}
	replay, err := ExecuteToolTurn(ctx, engine, nil, response, "direct-agent-turn", persist)
	if err != nil || !replay.Replayed {
		t.Fatal("replay", err, replay.Replayed)
	}
	manager, err := w.host.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, got := range manager.List(manager.owner) {
		if got.Spec.RequestID == "direct-create" {
			count++
			if got.ID != created.ID {
				t.Fatal("creation identity changed")
			}
		}
	}
	if count != 1 || calls.Load() != 1 {
		t.Fatal("conversation duplicated or creation called a model", count, calls.Load())
	}
	if receipts != 1 {
		t.Fatal(fmt.Sprintf("receipts=%d", receipts))
	}
}

func TestBasicStageMemoryAndSubconscious(t *testing.T) {
	useTestStage(t, ReleaseStage{})
	t.Run("diary_readback", TestSharedDiaryReadThroughWorkspaceCall)
	t.Run("legacy_deep_memory", TestSubconsciousStoreOrganizesDiariesDreamsAndDeepSearch)
	t.Run("eyra_pac_compression", TestPACIgnoresLegacySubconsciousAndCompactsWithEyra)
}
