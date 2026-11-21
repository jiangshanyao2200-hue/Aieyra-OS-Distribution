// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: baseReportWorkspace; baseReportContext; baseReportCall; definitionNames; TestBaseReportToolOnOSDesktopHost; TestBaseReportToolAbsentOnTerminalHost; TestBaseToolsSentenceMentionsReportConditionally
// Impact: python -B scripts/code-atlas.py show Core/base_tools_report_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
)

// 用户 2026-10-14 选 A：基础模式只把 workspace 的报告三项作为独立 report 工具交回，
// 只在有报告查看器的 OS 桌面宿主出现；workspace 其余动作仍不可用，CLI 终端没有 report。
func baseReportWorkspace(t *testing.T, mode HostMode, terminal bool) *Workspace {
	t.Helper()
	// TestMain enables retained features. These checks exercise the basic stage,
	// where the fixed team roles are unavailable, rather than Cota's explicit
	// report grant in the full stage.
	useTestStage(t, ReleaseStage{})
	baseToolMode = true
	t.Cleanup(func() { baseToolMode = false })
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected provider call") })
	host := NewWorkspaceHost(m.config, "", "")
	t.Cleanup(host.Close)
	if terminal {
		host.SetTerminal()
	}
	if err := host.SetMode(mode); err != nil {
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
	return w
}

func baseReportContext(w *Workspace, role string) context.Context {
	ctx := context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{workspace: w, role: role})
	return WithToolPermissions(ctx, w.permissions(role))
}

func baseReportCall(ctx context.Context, tool string, args map[string]any) string {
	call := ToolCall{}
	call.Function.Name = tool
	call.Function.Arguments = string(rawJSON(args))
	return string(rawJSON(executeWorkspaceTool(ctx, call)))
}

func definitionNames(ctx context.Context) []string {
	var names []string
	for _, d := range FilterToolDefinitions(ctx, nil) {
		names = append(names, d.Name)
	}
	return names
}

func TestBaseReportToolOnOSDesktopHost(t *testing.T) {
	w := baseReportWorkspace(t, HostOS, false)
	perms := w.permissions(WorkspaceMatrix)
	if !slices.Contains(perms, "report") || slices.Contains(perms, "workspace") {
		t.Fatal("OS matrix base permissions", perms)
	}
	// 原本没有 workspace 权限的角色也拿不到 report。
	for _, role := range []string{WorkspaceExecution, WorkspaceProject} {
		if slices.Contains(w.permissions(role), "report") {
			t.Fatal("role without workspace got report", role)
		}
	}
	ctx := baseReportContext(w, WorkspaceMatrix)
	names := definitionNames(ctx)
	if !slices.Contains(names, "report") || slices.Contains(names, "workspace") {
		t.Fatal("OS base tool list", names)
	}

	published := baseReportCall(ctx, "report", map[string]any{"action": "report", "title": "长结果", "format": "md", "content": "# 标题\n\n正文"})
	if !strings.Contains(published, `"ok":true`) || !strings.Contains(published, "长结果") {
		t.Fatal("report publish", published)
	}
	w.mu.Lock()
	if len(w.state.Documents) != 1 {
		w.mu.Unlock()
		t.Fatal("document not saved", published)
	}
	id := w.state.Documents[0].ID
	w.mu.Unlock()
	if listed := baseReportCall(ctx, "report", map[string]any{"action": "reports"}); !strings.Contains(listed, id) {
		t.Fatal("reports list", listed)
	}
	if recalled := baseReportCall(ctx, "report", map[string]any{"action": "recall_report", "id": id}); !strings.Contains(recalled, `"ok":true`) || !strings.Contains(recalled, id) {
		t.Fatal("recall_report", recalled)
	}

	// report 只接受三个报告动作；workspace 的其它动作与文档的其它状态操作都被拒绝。
	for _, action := range []string{"workflow_status", "workflow_deliver", "connect", "theme", "model", "control", "sessions", "open_session", "link_open", "pin", "close", "read", ""} {
		if got := baseReportCall(ctx, "report", map[string]any{"action": action, "id": id}); !strings.Contains(got, "unknown report action") {
			t.Fatal("report accepted non-report action", action, got)
		}
	}
	// workspace 本身仍未分配。
	if got := baseReportCall(ctx, "workspace", map[string]any{"action": "report", "title": "x", "format": "md", "content": "x"}); !strings.Contains(got, "tool_not_assigned: workspace") {
		t.Fatal("workspace became available", got)
	}
}

func TestBaseReportToolAbsentOnTerminalHost(t *testing.T) {
	w := baseReportWorkspace(t, HostCLI, true)
	perms := w.permissions(WorkspaceMatrix)
	if slices.Contains(perms, "report") || slices.Contains(perms, "workspace") {
		t.Fatal("terminal base permissions", perms)
	}
	names := definitionNames(baseReportContext(w, WorkspaceMatrix))
	if slices.Contains(names, "report") || slices.Contains(names, "workspace") {
		t.Fatal("terminal base tool list", names)
	}
	// 即使权限不受限，终端宿主也没有查看器，report 调用被拒绝且不写文档。
	unrestricted := context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{workspace: w, role: WorkspaceMatrix})
	if got := baseReportCall(unrestricted, "report", map[string]any{"action": "report", "title": "x", "format": "md", "content": "x"}); !strings.Contains(got, "OS desktop viewer") {
		t.Fatal("terminal report call", got)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.state.Documents) != 0 {
		t.Fatal("terminal wrote a report")
	}
}

// 合同如实：基础工具句用条件句提到 report，不再声称没有文档查看器；CLI 自己的说明仍说终端没有文档页。
func TestBaseToolsSentenceMentionsReportConditionally(t *testing.T) {
	if !strings.Contains(baseToolsSentence(), "工具由当前请求的声明提供") || !strings.Contains(baseToolsSentence(), "report 保存文档") || !strings.Contains(baseToolsSentence(), "是否可用由当前阶段、配置与实际权限决定") || strings.Contains(baseToolsSentence(), "document viewer") {
		t.Fatal("base tools sentence", baseToolsSentence())
	}
	if !strings.Contains(baseTerminalContract(), "没有图形画布、浏览器或桌面设置服务") {
		t.Fatal("terminal contract lost its viewer note")
	}
}
