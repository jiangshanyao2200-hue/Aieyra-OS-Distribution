// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: baseModeRun; TestBaseToolModeMatrixRequestAndCompletion; TestFullToolModeStillGatesPlannedDelivery; TestBaseToolPermissionsKeepOnlyGrantedBaseTools; TestTerminalHostUsesBaseToolsAndTerminalContract; TestEmptyFinalUsesLastCommentaryOrNudgesOnce
// Impact: python -B scripts/code-atlas.py show Core/base_tools_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// 基础工具模式（T1）：主角色只拿到五个基础工具；没有 toolbox 及其目录；角色合同如实列出工具；
// 做了计划也不会被已关闭的 workspace 交付工作流卡住（Codex B 报告的 P0）。完整模式下同一剧本会被完成门拦下，作为对照。
func baseModeRun(t *testing.T, base bool) (requests int32, tools []string, first string, result string) {
	t.Helper()
	baseToolMode = base
	t.Cleanup(func() { baseToolMode = false })
	var calls atomic.Int32
	var seenTools atomic.Value
	var seenBody atomic.Value
	w, _ := testWorkspace(t, func(res http.ResponseWriter, req *http.Request) {
		body, _ := io.ReadAll(req.Body)
		var request map[string]json.RawMessage
		_ = json.Unmarshal(body, &request)
		if len(request["tools"]) == 0 {
			fixtureAnswer(res, "continuity", "Retain completed task evidence.", nil)
			return
		}
		n := calls.Add(1)
		if n == 1 {
			var defs []struct{ Name string }
			_ = json.Unmarshal(request["tools"], &defs)
			var names []string
			for _, d := range defs {
				names = append(names, d.Name)
			}
			seenTools.Store(names)
			seenBody.Store(string(body))
			plan := map[string]any{"summary": "基础模式", "plan": []any{map[string]any{"id": "only", "description": "做完这件事", "status": "in_progress"}}}
			fixtureAnswer(res, "plan", "", []any{map[string]any{"type": "function_call", "id": "fc_plan", "call_id": "base_plan", "name": "update_plan", "arguments": string(rawJSON(plan))}})
			return
		}
		if n > 4 {
			fixtureAnswer(res, fmt.Sprintf("give-up-%d", n), "GATED", nil)
			return
		}
		fixtureAnswer(res, fmt.Sprintf("done-%d", n), "BASE_DONE", nil)
	})
	if _, err := w.Send("base-task", "做一件需要计划的小事。"); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		w.mu.Lock()
		id := w.state.Roles[WorkspaceMatrix]
		w.mu.Unlock()
		if id != "" {
			if r, err := w.manager.Status(w.state.ID, id); err == nil && (r.State == "completed" || r.State == "failed") {
				tools, _ = seenTools.Load().([]string)
				first, _ = seenBody.Load().(string)
				return calls.Load(), tools, first, r.State + ":" + r.Result
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("run did not settle")
	return
}

func TestBaseToolModeMatrixRequestAndCompletion(t *testing.T) {
	requests, tools, body, result := baseModeRun(t, true)
	if requests != 2 || result != "completed:BASE_DONE" {
		t.Fatal("base mode was held by a closed workflow", requests, result)
	}
	slices.Sort(tools)
	// Legacy host has no project map, agents or model-native search.
	// Image observation remains available through the shared OCR fallback.
	// Unified terminal replaces three separately declared shell operations.
	want := []string{"apply_patch", "toolbox", "memory", "models", "terminal", "update_plan", "view_image"}
	slices.Sort(want)
	if !slices.Equal(tools, want) {
		t.Fatal("base tools mismatch", tools)
	}
	for _, absent := range []string{"persistent_task_state", "workflow_deliver"} {
		if strings.Contains(body, absent) {
			t.Error("base request still mentions", absent)
		}
	}
	if !strings.Contains(body, "工具由当前请求的声明提供") {
		t.Error("base contract missing")
	}
}

func TestFullToolModeStillGatesPlannedDelivery(t *testing.T) {
	requests, _, _, _ := baseModeRun(t, false)
	if requests <= 2 {
		t.Fatal("control: full mode should ask for workflow delivery", requests)
	}
}

func TestBaseToolPermissionsKeepOnlyGrantedBaseTools(t *testing.T) {
	baseToolMode = true
	t.Cleanup(func() { baseToolMode = false })
	got := baseToolPermissions([]string{"memory", "team", "exec_command", "apply_patch", "toolbox", "update_plan"})
	if !slices.Equal(got, []string{"update_plan", "apply_patch", "exec_command", "memory"}) {
		t.Fatal(got)
	}
	baseToolMode = false
	if full := baseToolPermissions([]string{"memory", "team"}); !slices.Equal(full, []string{"memory", "team"}) {
		t.Fatal("full mode changed permissions", full)
	}
}

// CLI 同步（用户 2026-10-10 确认）：终端宿主与 OS 一样只拿基础工具；合同共用工具清单和结尾，只换宿主与叙述方式。
func TestTerminalHostUsesBaseToolsAndTerminalContract(t *testing.T) {
	baseToolMode = true
	t.Cleanup(func() { baseToolMode = false })
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected provider call") })
	host := NewWorkspaceHost(m.config, "", "")
	defer host.Close()
	host.SetTerminal()
	if err := host.SetMode(HostCLI); err != nil {
		t.Fatal(err)
	}
	opened, err := host.Open("", dir)
	if err != nil {
		t.Fatal(err)
	}
	host.mu.Lock()
	w := host.workspaces[fmt.Sprint(opened["session_id"])]
	host.mu.Unlock()
	if w == nil {
		t.Fatal("opened workspace missing", opened)
	}
	got := w.permissions(WorkspaceMatrix)
	for _, name := range got {
		if !slices.Contains(baseToolNames, name) && name != "memory" {
			t.Error("terminal matrix keeps a non-base tool", name)
		}
	}
	for _, name := range []string{"exec_command", "write_stdin", "read_shell_output", "apply_patch", "update_plan", "memory"} {
		if !slices.Contains(got, name) {
			t.Error("terminal matrix lost base tool", name)
		}
	}
	for _, name := range []string{"team", "agents", "workspace", "browser", "tool_factory"} {
		if slices.Contains(got, name) {
			t.Error("terminal mother acquired an unassigned capability", name)
		}
	}
	contract := w.roleContract(WorkspaceMatrix)
	if contract != baseTerminalContract() || !strings.Contains(contract, strings.TrimSpace(baseToolsSentence())) || !strings.HasSuffix(strings.TrimSpace(contract), strings.TrimSpace(baseContractTail())) || strings.Contains(contract, "desktop") || !strings.Contains(contract, "/api") {
		t.Fatal("terminal base contract", contract)
	}
	if !strings.HasPrefix(baseMatrixContract(), "You are Matrix, the single active runtime for Eyra on the Aieyra OS desktop. "+strings.TrimSpace(baseToolsSentence())) || !strings.HasSuffix(strings.TrimSpace(baseMatrixContract()), strings.TrimSpace(baseContractTail())) {
		t.Fatal("OS base contract changed shape")
	}
}

// 用户 2026-10-13：Eyra 在过程中已经把结果说完、最后只结束不再写字，界面却显示“任务中断，原因待核实”。
// 最后一次回复为空时，用本轮最后说过的话作为回复，正常完成；一个字都没说过时提醒一次。
func TestEmptyFinalUsesLastCommentaryOrNudgesOnce(t *testing.T) {
	run := func(t *testing.T, said string, second string, receiveMemberResult bool) (int32, string) {
		baseToolMode = true
		t.Cleanup(func() { baseToolMode = false })
		var calls atomic.Int32
		var w *Workspace
		w, _ = testWorkspace(t, func(res http.ResponseWriter, req *http.Request) {
			body, _ := io.ReadAll(req.Body)
			var request map[string]json.RawMessage
			_ = json.Unmarshal(body, &request)
			if len(request["tools"]) == 0 {
				fixtureAnswer(res, "continuity", "Retain completed task evidence.", nil)
				return
			}
			n := calls.Add(1)
			if n == 1 {
				if receiveMemberResult {
					w.mu.Lock()
					w.state.Messages = append(w.state.Messages, workspaceMessage{ID: "member-result", From: WorkspaceExecution, To: WorkspaceMatrix, State: "queued", Text: "MEMBER-VERIFIED-CODE"})
					w.mu.Unlock()
				}
				plan := map[string]any{"summary": "空结尾", "plan": []any{map[string]any{"id": "only", "description": "做完", "status": "completed"}}}
				output := []any{map[string]any{"type": "function_call", "id": "fc_plan", "call_id": "empty_plan", "name": "update_plan", "arguments": string(rawJSON(plan))}}
				if said != "" {
					output = append([]any{map[string]any{"type": "message", "id": "msg_said", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": said}}}}, output...)
				}
				fixtureAnswer(res, "plan", "", output)
				return
			}
			if n == 2 {
				if receiveMemberResult && !strings.Contains(string(body), "MEMBER-VERIFIED-CODE") {
					t.Error("member completion did not reach the model")
				}
				fixtureAnswer(res, "empty", "", nil)
				return
			}
			fixtureAnswer(res, fmt.Sprintf("after-%d", n), second, nil)
		})
		if _, err := w.Send("empty-final", "做一件小事。"); err != nil {
			t.Fatal(err)
		}
		deadline := time.Now().Add(20 * time.Second)
		for time.Now().Before(deadline) {
			w.mu.Lock()
			id := w.state.Roles[WorkspaceMatrix]
			w.mu.Unlock()
			if id != "" {
				if r, err := w.manager.Status(w.state.ID, id); err == nil && (r.State == "completed" || r.State == "failed") {
					heading := r.Result
					if r.State == "failed" {
						heading = failureHeading(r)
					}
					return calls.Load(), r.State + ":" + heading
				}
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatal("run did not settle")
		return 0, ""
	}
	t.Run("commentary", func(t *testing.T) {
		if n, got := run(t, "已经做完了，结果在这里。", "UNUSED", false); n != 2 || got != "completed:已经做完了，结果在这里。" {
			t.Fatal(n, got)
		}
	})
	t.Run("nudge", func(t *testing.T) {
		if n, got := run(t, "", "做完了。", false); n != 3 || got != "completed:做完了。" {
			t.Fatal(n, got)
		}
	})
	t.Run("still empty", func(t *testing.T) {
		if n, got := run(t, "", "", false); n != 3 || got != "failed:Eyra 结束了这一轮，但没有留下文字回复" {
			t.Fatal(n, got)
		}
	})
	t.Run("commentary before member result", func(t *testing.T) {
		if n, got := run(t, "Waiting for the member result.", "MEMBER-VERIFIED-CODE", true); n != 3 || got != "completed:MEMBER-VERIFIED-CODE" {
			t.Fatal(n, got)
		}
	})
}
