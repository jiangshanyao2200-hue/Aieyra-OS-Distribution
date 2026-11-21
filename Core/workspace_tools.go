// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workspaceRoleContract; communityToolDescription; WorkspaceToolDefinitions; ReportToolDefinition; reportAction; reportCall; isWorkspaceTool; executeWorkspaceTool; team; workspaceTeamResult; workspaceReview; WorkspaceTheme; defaultWorkspaceTheme; workspaceColor; configure
// Impact: python -B scripts/code-atlas.py show Core/workspace_tools.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/tool/toolbox/official/videogen"
	"regexp"
	"strings"
	"time"
)

// These are execution contracts, not an embedded persona. Personality and
// baseline system text continue to come from the user's external Prompt files.
func workspaceRoleContract(role string) string {
	base := "Workspace role: " + role + runtimePrompt("Matrix/辅助指令/团队消息边界.txt")
	switch role {
	case WorkspaceMatrix:
		return runtimePrompt("Matrix/运行协定/主控身份.txt")
	case WorkspaceProject:
		return base + runtimePrompt("Matrix/运行协定/项目角色兼容.txt")
	default:
		return base + runtimePrompt("Matrix/运行协定/执行角色兼容.txt")
	}
}

func communityToolDescription() string { return runtimePrompt("Matrix/工具说明/社区.txt") }

func WorkspaceToolDefinitions() []ToolDefinition {
	return []ToolDefinition{
		AskUserToolDefinition(),
		ModelsToolDefinition(),
		ImageGenToolDefinition(),
		videogen.Definition(VideoGenManual()),
		MemoryToolDefinition(),
		LinkToolDefinition(),
		{Type: "function", Name: "apps", Description: runtimePrompt("Matrix/工具说明/内部模块.txt"), Parameters: schemaObject(map[string]any{"action": schemaEnum("list", "status"), "app_id": schemaEnum("aieyra.link", "aieyra.control")}, "action")},
		{Type: "function", Name: "community", Description: communityToolDescription(), Parameters: schemaObject(map[string]any{"action": schemaEnum("status", "home_status", "home_digest", "home_refresh", "home_preferences", "topics", "topic_read", "topic_updates", "replies", "sync", "topic_publish", "topic_like", "reply", "topic_state", "topic_withdraw", "reply_withdraw", "moderate", "list", "read", "publish", "receipt", "withdraw", "center_list", "center_read", "center_local", "center_acquire", "center_install", "center_migrate", "center_apply", "center_restore_theme", "center_open", "center_remove", "center_publish_file", "center_withdraw"), "kind": schemaEnum("program", "tool", "role", "drawing", "prompt", "theme"), "sort": schemaEnum("recommended", "hot", "latest"), "q": schemaString(), "origin": schemaEnum("local"), "expected_sha256": schemaString(), "expected_version": schemaString(), "expected_digest": schemaString(), "file": schemaString(), "manifest": map[string]any{"type": "object"}, "id": schemaString(), "reply_id": schemaString(), "cursor": schemaString(), "query": schemaString(), "after": map[string]any{"type": "integer"}, "request_id": schemaString(), "type": schemaEnum("project", "bug", "discussion", "proposal", "repair", "update"), "state": schemaEnum("open", "triaged", "in_progress", "resolved", "rejected"), "expected_revision": map[string]any{"type": "integer"}, "note": schemaString(), "title": schemaString(), "summary": schemaString(), "content": schemaString(), "project_url": schemaString(), "source_type": schemaEnum("feedback", "forum", "release", "issue"), "source_id": schemaString(), "source_revision": map[string]any{"type": "integer"}, "preferences": map[string]any{"type": "object", "properties": map[string]any{"sync": map[string]any{"type": "boolean"}, "participation": schemaEnum("read_only", "contribute")}, "additionalProperties": false}, "liked": map[string]any{"type": "boolean"}, "official": map[string]any{"type": "boolean"}, "confirmed": map[string]any{"type": "boolean"}}, "action")},
		{Type: "function", Name: "updates", Description: runtimePrompt("Matrix/工具说明/官方更新.txt"), Parameters: schemaObject(map[string]any{"action": schemaEnum("status", "check", "review", "read_file", "resolve_file", "prepare", "verify", "decide"), "path": schemaString(), "side": schemaEnum("base", "local", "incoming"), "choice": schemaEnum("local", "incoming", "merged", "delete"), "text": schemaString(), "reason": schemaString(), "review_digest": schemaString(), "candidate_digest": schemaString(), "decision": schemaEnum("defer", "reject", "apply"), "evidence": schemaString()}, "action")},
		{Type: "function", Name: "team", Description: runtimePrompt("Matrix/工具说明/固定协同.txt"), Parameters: schemaObject(map[string]any{"action": schemaEnum("dispatch", "message", "status", "wait", "cancel"), "role": schemaEnum("matrix", "project", "execution"), "message": schemaString(), "brief": schemaString(), "request_id": schemaString(), "wait": map[string]any{"type": "boolean"}, "toolbox": map[string]any{"type": "array", "items": schemaEnum(teamGrantableToolbox()...)}, "generation": map[string]any{"type": "integer"}, "verdict": schemaEnum("accepted", "rework"), "evidence": schemaString()}, "action", "role")},
		{Type: "function", Name: "project", Description: runtimePrompt("Matrix/工具说明/工程索引.txt"), Parameters: schemaObject(map[string]any{"root": map[string]any{"type": "string", "enum": []string{"workspace", "os"}, "description": "Default workspace indexes the selected user project. Explicit os selects Aieyra source for OS maintenance; private stores remain excluded."}, "action": schemaEnum("map_read", "map_write", "index_refresh", "index_query", "index_annotate"), "path": schemaString(), "query": schemaString(), "start_line": map[string]any{"type": "integer"}, "limit": map[string]any{"type": "integer"}, "offset": map[string]any{"type": "integer"}, "text": schemaString(), "expected_version": schemaString()}, "action")},
		{Type: "function", Name: "workspace", Description: runtimePrompt("Matrix/工具说明/工作区操作.txt"), Parameters: schemaObject(map[string]any{"title": schemaString(), "format": schemaEnum("md", "html"), "content": schemaString(), "session_id": schemaString(), "workdir": schemaString(), "action": schemaEnum("report", "reports", "recall_report", "connect", "theme", "theme_rollback", "model", "control", "sessions", "open_session", "new_session", "workflow_status", "workflow_capture", "workflow_evidence", "workflow_reconcile", "workflow_deliver"), "id": schemaString(), "label": schemaString(), "paths": schemaStrings(), "receipt_key": schemaString(), "evidence_ids": schemaStrings(), "expected_version": map[string]any{"type": "integer"}, "verdict": schemaEnum("complete", "partial", "blocked"), "summary": schemaString(), "unresolved": schemaStrings(), "role": schemaEnum("matrix", "project"), "model_id": schemaString(), "theme": map[string]any{"type": "object", "properties": map[string]any{"background": schemaString(), "foreground": schemaString(), "accent": schemaString(), "surface": schemaString(), "scale": map[string]any{"type": "number"}, "reduced_motion": map[string]any{"type": "boolean"}}, "additionalProperties": false}}, "action")},
		ReportToolDefinition(),
	}
}

// 基础模式下 workspace 不交给模型，只把报告三项作为独立工具交回（用户 2026-10-14 选 A），与 workspace 的同名动作共用实现。
func ReportToolDefinition() ToolDefinition {
	return ToolDefinition{Type: "function", Name: "report", Description: runtimePrompt("Matrix/工具说明/报告.txt"), Parameters: schemaObject(map[string]any{"action": schemaEnum("report", "reports", "recall_report"), "title": schemaString(), "format": schemaEnum("md", "html"), "content": schemaString(), "id": schemaString()}, "action")}
}

func reportAction(action string) bool {
	return action == "report" || action == "reports" || action == "recall_report"
}

// workspace 的报告动作与独立 report 工具走同一实现。
func (w *Workspace) reportCall(action string, raw json.RawMessage) (any, error) {
	if action == "report" {
		return w.report(raw)
	}
	return w.documentState(raw)
}

func isWorkspaceTool(name string) bool {
	return name == "link" || name == "models" || name == "image_gen" || name == "video_gen" || name == "ask_user" || isSubconsciousTool(name) || name == "memory" || name == "community" || name == "feedback" || name == "updates" || name == "apps" || name == "team" || name == "project" || name == "workspace" || name == "report"
}
func executeWorkspaceTool(ctx context.Context, call ToolCall) any {
	if call.Function.Name == "link" {
		if err := permittedCall(ctx, call); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		data, err := hostPluginTool(ctx, "link", json.RawMessage(call.Function.Arguments))
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		return data
	}
	if call.Function.Name == "video_gen" {
		config := ""
		if c, ok := ctx.Value(agentManagerKey{}).(agentManagerContext); ok && c.manager != nil {
			config = c.manager.config
		} else if c, ok := ctx.Value(workspaceContextKey{}).(workspaceContext); ok && c.workspace != nil {
			config = c.workspace.config
		}
		data, err := runVideoGen(ctx, config, json.RawMessage(call.Function.Arguments))
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error(), "data": data}
		}
		return data
	}
	if call.Function.Name == "project" {
		if c, ok := ctx.Value(agentManagerKey{}).(agentManagerContext); ok && c.manager != nil && isConversationToolContext(ctx) {
			if err := permittedCall(ctx, call); err != nil {
				return map[string]any{"ok": false, "error": err.Error()}
			}
			result, err := c.manager.conversationProject(ctx, c.owner, json.RawMessage(call.Function.Arguments))
			if err != nil {
				return map[string]any{"ok": false, "error": err.Error()}
			}
			return result
		}
	}
	if call.Function.Name == "report" && isConversationToolContext(ctx) {
		if err := permittedCall(ctx, call); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		c := ctx.Value(agentManagerKey{}).(agentManagerContext)
		var p struct {
			Action string `json:"action"`
		}
		if json.Unmarshal([]byte(call.Function.Arguments), &p) != nil || !reportAction(p.Action) {
			return map[string]any{"ok": false, "error": "invalid report action"}
		}
		w, err := c.manager.conversationReportScope(c.owner)
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		result, err := w.reportCall(p.Action, json.RawMessage(call.Function.Arguments))
		if err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		return result
	}
	c, ok := ctx.Value(workspaceContextKey{}).(workspaceContext)
	if !ok || c.workspace == nil {
		return map[string]any{"ok": false, "error": "workspace unavailable"}
	}
	if err := permittedCall(ctx, call); err != nil {
		return map[string]any{"ok": false, "error": err.Error()}
	}
	var result any
	var err error
	switch call.Function.Name {
	case "models":
		result, err = discoverModels(c.workspace.config, json.RawMessage(call.Function.Arguments))
	case "image_gen":
		ctx = context.WithValue(ctx, imageGenTaskKey{}, c.workspace.state.ID)
		data, failure := runImageGen(ctx, c.workspace.config, json.RawMessage(call.Function.Arguments))
		if failure != nil {
			return map[string]any{"ok": false, "error": failure.Error(), "data": data}
		}
		return data
	case "ask_user":
		result, err = c.workspace.askUser(ctx, c.role, json.RawMessage(call.Function.Arguments))
	case "ask_subconscious", "share_diary":
		return map[string]any{"ok": false, "error": "独立潜意识已退役，请通过memory检索旧资料，或由Eyra直接发言。"}
	case "memory":
		var a map[string]any
		if e := json.Unmarshal([]byte(call.Function.Arguments), &a); e != nil {
			return map[string]any{"ok": false, "error": "invalid memory arguments"}
		}
		if a["action"] == "compact" || a["action"] == "compact_status" {
			if c.role != WorkspaceMatrix {
				return map[string]any{"ok": false, "error": "当前角色未获本实例上下文整理权限"}
			}
			result, err = requestContextCompaction(ctx, a, call.ID)
			break
		}
		if action := memString(a["action"]); action == "context_clean" || action == "context_status" {
			if c.role != WorkspaceMatrix {
				return map[string]any{"ok": false, "error": "当前角色未获本实例上下文整理权限"}
			}
			mapped := "compact_status"
			if action == "context_clean" {
				mapped = "compact"
			}
			result, err = requestContextCompaction(ctx, map[string]any{"action": mapped}, call.ID)
			break
		}
		if memoryMutation(memString(a["action"])) {
			if c.role != WorkspaceMatrix {
				return map[string]any{"ok": false, "error": "当前角色未获本实例记忆编辑权限"}
			}
			result, err = c.workspace.editMemory(ctx, a)
			break
		}
		if action := memString(a["action"]); action == "seal" || action == "merge" || action == "packets" || action == "packet" || action == "original" || action == "snapshot" || action == "history" {
			result, err = c.workspace.pacTool(ctx, a)
			break
		}
		if a["action"] == "await_startup" {
			return c.workspace.awaitStartup(ctx)
		}
		if a["action"] == "dream" {
			return map[string]any{"ok": false, "error": "自动梦境与日记机制已退役；旧资料请用memory packets/history检索。"}
		}
		if a["action"] == "recall" {
			return recallArchive(ctx, a)
		}
		// 原文与记忆段只由宿主写入（记忆系统 M-A），模型不能伪造或改写。
		if action, _ := a["action"].(string); strings.HasPrefix(action, "pac_") || strings.HasPrefix(action, "transcript_") || strings.HasPrefix(action, "fast_") || strings.HasPrefix(action, "continuity_") || strings.HasPrefix(action, "diary_") || strings.HasPrefix(action, "deep_") || action == "dream_write" || action == "dream_state" {
			return map[string]any{"ok": false, "error": "这个记忆操作只由宿主执行"}
		}
		result, err = c.workspace.memory(ctx, a)
	case "community":
		if c.role != WorkspaceMatrix {
			return map[string]any{"ok": false, "error": "only Matrix shares projects"}
		}
		result, err = c.workspace.service.Community(ctx, json.RawMessage(call.Function.Arguments))
	case "feedback":
		if c.role != WorkspaceMatrix {
			return map[string]any{"ok": false, "error": "private feedback is retired; use community topic_publish with type bug"}
		}
		result, err = c.workspace.service.CallTool(ctx, "feedback", c.workspace.state.ID, json.RawMessage(call.Function.Arguments))
	case "updates":
		if c.role != WorkspaceMatrix {
			return map[string]any{"ok": false, "error": "only Matrix manages updates"}
		}
		var p struct {
			Action string `json:"action"`
		}
		_ = json.Unmarshal([]byte(call.Function.Arguments), &p)
		switch p.Action {
		case "status", "check", "review", "read_file", "resolve_file", "prepare", "verify", "decide":
		default:
			return map[string]any{"ok": false, "error": "trusted host operation is not a model tool"}
		}
		result, err = c.workspace.service.CallTool(ctx, "updates", c.workspace.state.ID, json.RawMessage(call.Function.Arguments))
	case "apps":
		if c.role != WorkspaceMatrix || c.workspace.isTerminal() {
			return map[string]any{"ok": false, "error": "apps requires the desktop Matrix host"}
		}
		var p struct {
			Action string `json:"action"`
		}
		if json.Unmarshal([]byte(call.Function.Arguments), &p) != nil {
			return map[string]any{"ok": false, "error": "invalid apps arguments"}
		}
		switch p.Action {
		case "list", "status", "resolve", "acquire", "install":
		default:
			return map[string]any{"ok": false, "error": "unknown apps action"}
		}
		result, err = c.workspace.service.CallTool(ctx, "apps", c.workspace.state.ID, json.RawMessage(call.Function.Arguments))
	case "team":
		result, err = c.workspace.team(ctx, c.role, json.RawMessage(call.Function.Arguments))
	case "project":
		result, err = c.workspace.project(ctx, c.role, json.RawMessage(call.Function.Arguments))
	case "report":
		var p struct {
			Action string `json:"action"`
		}
		if json.Unmarshal([]byte(call.Function.Arguments), &p) != nil {
			return map[string]any{"ok": false, "error": "invalid report arguments"}
		}
		if !reportAction(p.Action) {
			return map[string]any{"ok": false, "error": "unknown report action"}
		}
		if !c.workspace.reportViewerAvailable() {
			return map[string]any{"ok": false, "error": "report requires the OS desktop viewer; write the full answer in assistant content"}
		}
		result, err = c.workspace.reportCall(p.Action, json.RawMessage(call.Function.Arguments))
	case "workspace":
		var p struct {
			Action string `json:"action"`
		}
		_ = json.Unmarshal([]byte(call.Function.Arguments), &p)
		if c.workspace.isTerminal() && !terminalWorkspaceAction(p.Action) {
			return map[string]any{"ok": false, "error": "workspace action unavailable in CLI; output complete answers directly in assistant content"}
		}
		if p.Action == "new_session" || p.Action == "open_session" {
			return map[string]any{"ok": false, "error": "请由用户在界面中切换会话；当前任务继续在原会话执行"}
		}
		if workspaceDesktopAction(p.Action) {
			if c.role != WorkspaceMatrix || c.workspace.Mode() != HostOS || c.workspace.isTerminal() {
				return map[string]any{"ok": false, "error": "embedded desktop tools require the OS Matrix host"}
			}
			result, err = c.workspace.service.CallTool(ctx, "desktop", c.workspace.state.ID, json.RawMessage(call.Function.Arguments))
		} else if strings.HasPrefix(p.Action, "collaboration_") {
			result, err = c.workspace.collaborationCall(ctx, c.role, json.RawMessage(call.Function.Arguments))
		} else if strings.HasPrefix(p.Action, "workflow_") {
			if c.role != WorkspaceMatrix {
				return map[string]any{"ok": false, "error": "only Matrix maintains task delivery"}
			}
			result, err = c.workspace.workflow(ctx, json.RawMessage(call.Function.Arguments))
		} else if reportAction(p.Action) {
			result, err = c.workspace.reportCall(p.Action, json.RawMessage(call.Function.Arguments))
		} else {
			result, err = c.workspace.configure(c.role, json.RawMessage(call.Function.Arguments))
		}
	}
	if err != nil {
		return map[string]any{"ok": false, "error": err.Error()}
	}
	return result
}

func (w *Workspace) team(ctx context.Context, caller string, raw json.RawMessage) (any, error) {
	var p struct {
		Action     string   `json:"action"`
		Role       string   `json:"role"`
		Message    string   `json:"message"`
		Brief      string   `json:"brief"`
		RequestID  string   `json:"request_id"`
		Verdict    string   `json:"verdict"`
		Evidence   string   `json:"evidence"`
		Wait       *bool    `json:"wait"`
		Generation int      `json:"generation"`
		Toolbox    []string `json:"toolbox"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if !validWorkspaceRole(p.Role) {
		return nil, fmt.Errorf("unknown team role")
	}
	if w.Mode() == HostOS && p.Action == "review" {
		return nil, fmt.Errorf("Cota 的结果由 Eyra 直接核对：读改动、跑检查，不需要 review")
	}
	if p.Action == "dispatch" || p.Action == "message" && caller == WorkspaceMatrix && p.Role != WorkspaceMatrix {
		w.mu.Lock()
		enabled := w.collaborationRoleLocked(p.Role)
		w.mu.Unlock()
		if !enabled {
			return nil, fmt.Errorf("team role is not enabled in this host and collaboration configuration")
		}
	}
	if p.RequestID == "" {
		p.RequestID, _ = ctx.Value(toolInvocationKey{}).(string)
	}
	if p.Action == "message" {
		state := "context"
		if caller == WorkspaceMatrix {
			state = "queued"
		}
		m, err := w.enqueueState(caller, p.Role, p.RequestID, p.Message, state)
		if err == nil {
			w.talk(caller, p.Role, p.Brief, "message", 0)
		}
		return m, err
	}
	if p.Action == "dispatch" {
		if caller != WorkspaceMatrix || p.Role == WorkspaceMatrix {
			return nil, fmt.Errorf("only Matrix can dispatch subordinate work")
		}
		// 进入协同 = 计划已写入（最终搬家 R10）：派工前 Eyra 必须先用 update_plan 写下本次计划。
		if c, ok := ctx.Value(workflowContextKey{}).(workflowContext); ok && w.teamHost() && !planActive(c.Plan) {
			return nil, fmt.Errorf("write the plan with update_plan before dispatching the team")
		}
		if err := w.grantTeamToolbox(ctx, p.Role, p.Toolbox); err != nil {
			return nil, err
		}
		w.mu.Lock()
		r, err := w.dispatchLocked(p.Role, p.RequestID, p.Message)
		w.mu.Unlock()
		if err != nil {
			return nil, err
		}
		w.feed.publish(p.Role, "assignment", map[string]any{"from": caller, "message": p.Message, "brief": p.Brief, "generation": r.Generation})
		w.talk(caller, p.Role, p.Brief, "dispatch", r.Generation)
		w.talk(p.Role, caller, "收到！", "ack", r.Generation)
		// OS 里默认不等：Eyra 接着干，成员做完主动告知。
		wait := p.Wait == nil && !w.teamHost() || p.Wait != nil && *p.Wait
		if !wait {
			w.awaitTeamResult(p.Role, r.Generation)
			summary := agentSummary(r)
			summary["will_notify"] = true
			return summary, nil
		}
		for activeAgent(r.State) && r.State != "waiting_user" {
			r, err = w.waitTeamBoundary(ctx, r.ID)
			if err != nil {
				return nil, err
			}
			if activeAgent(r.State) {
				break
			}
		}
		// 等待被用户的新消息打断时成员还在跑，做完同样要告知。
		if activeAgent(r.State) {
			w.awaitTeamResult(p.Role, r.Generation)
		}
		w.talkResult(p.Role, r)
		return workspaceTeamResult(r), nil
	}
	w.mu.Lock()
	id, owner := w.state.Roles[p.Role], w.state.ID
	w.mu.Unlock()
	if id == "" {
		return map[string]any{"role": p.Role, "state": "idle"}, nil
	}
	r, err := w.manager.Status(owner, id)
	if err != nil {
		return nil, err
	}
	switch p.Action {
	case "status":
		w.talkResult(p.Role, r)
		w.settleTeamAwait(p.Role, r)
		return workspaceTeamResult(r), nil
	case "wait":
		if caller != WorkspaceMatrix && p.Role == WorkspaceMatrix {
			return nil, fmt.Errorf("%s", runtimePrompt("Matrix/辅助指令/等待主控说明.txt"))
		}
		// 用户说话时立刻返回，不让 Eyra 再干等 25 秒。
		waitCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
		defer cancel()
		r, err = w.waitTeamBoundary(waitCtx, id)
		if err != nil && ctx.Err() == nil {
			r, err = w.manager.Status(owner, id)
		}
		if err == nil {
			w.talkResult(p.Role, r)
			w.settleTeamAwait(p.Role, r)
		}
		return workspaceTeamResult(r), err
	case "cancel":
		if caller != WorkspaceMatrix {
			return nil, fmt.Errorf("only Matrix can cancel work")
		}
		return map[string]any{"ok": true}, w.manager.CancelGeneration(owner, id, p.Generation)
	case "review":
		if p.Role != WorkspaceExecution || r.Generation != p.Generation || r.State != "completed" || strings.TrimSpace(p.Evidence) == "" {
			return nil, fmt.Errorf("review requires completed execution, current generation and independent evidence")
		}
		if p.Verdict != "accepted" && p.Verdict != "rework" {
			return nil, fmt.Errorf("invalid review verdict")
		}
		if caller == WorkspaceProject {
			w.mu.Lock()
			defer w.mu.Unlock()
			readAt, readErr := time.Parse(time.RFC3339Nano, w.state.LastRead)
			deliveredAt, deliveryErr := time.Parse(time.RFC3339Nano, r.Updated)
			if readErr != nil || deliveryErr != nil || readAt.Before(deliveredAt) {
				return nil, fmt.Errorf("read current artifacts after delivery before independent review")
			}
			w.state.Review = &workspaceReview{Generation: r.Generation, Verdict: p.Verdict, Evidence: p.Evidence}
			if err = w.saveLocked(); err != nil {
				return nil, err
			}
			return map[string]any{"ok": true, "reviewer": "project", "generation": r.Generation, "verdict": p.Verdict, "evidence": p.Evidence}, nil
		}
		if caller != WorkspaceMatrix {
			return nil, fmt.Errorf("execution cannot accept its own work")
		}
		w.mu.Lock()
		review := w.state.Review
		w.mu.Unlock()
		if p.Verdict == "accepted" && (review == nil || review.Generation != r.Generation || review.Verdict != "accepted") {
			return nil, fmt.Errorf("independent project review is required for this generation")
		}
		return w.manager.Review(owner, id, p.Verdict, p.Evidence)
	}
	return nil, fmt.Errorf("unknown team action")
}

func workspaceTeamResult(r AgentRecord) any {
	s := agentSummary(r)
	s["generation"], s["result"], s["error"], s["usage"] = r.Generation, r.Result, r.Error, r.Usage
	return s
}

type workspaceReview struct {
	Generation int    `json:"generation"`
	Verdict    string `json:"verdict"`
	Evidence   string `json:"evidence"`
}
type WorkspaceTheme struct {
	Background    string  `json:"background"`
	Foreground    string  `json:"foreground"`
	Accent        string  `json:"accent"`
	Surface       string  `json:"surface"`
	Scale         float64 `json:"scale"`
	ReducedMotion bool    `json:"reduced_motion"`
}

func defaultWorkspaceTheme() WorkspaceTheme {
	return WorkspaceTheme{"#000000", "#f4f4f4", "#ffffff", "#0b0b0b", 1, false}
}

var workspaceColor = regexp.MustCompile("^#[0-9a-fA-F]{6}$")

func (w *Workspace) configure(role string, raw json.RawMessage) (any, error) {
	if role != WorkspaceMatrix {
		return nil, fmt.Errorf("only Matrix configures workspace")
	}
	var p struct {
		Action        string          `json:"action"`
		SessionID     string          `json:"session_id"`
		Workdir       string          `json:"workdir"`
		Role          string          `json:"role"`
		ModelID       string          `json:"model_id"`
		ExpectedModel *string         `json:"expected_model"`
		Theme         json.RawMessage `json:"theme"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	switch p.Action {
	case "theme", "theme_rollback":
		old := w.state.Theme
		previousTheme := w.state.PreviousTheme
		next := old
		if p.Action == "theme_rollback" {
			if w.state.PreviousTheme == nil {
				return nil, fmt.Errorf("没有可回退的主题")
			}
			next = *w.state.PreviousTheme
		} else {
			decoder := json.NewDecoder(strings.NewReader(string(p.Theme)))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&next); err != nil {
				return nil, err
			}
		}
		for _, color := range []string{next.Background, next.Foreground, next.Accent, next.Surface} {
			if !workspaceColor.MatchString(color) {
				return nil, fmt.Errorf("颜色必须是 #RRGGBB")
			}
		}
		if next.Scale < 0.85 || next.Scale > 1.4 {
			return nil, fmt.Errorf("scale must be 0.85..1.4")
		}
		w.state.PreviousTheme = &old
		w.state.Theme = next
		if err := w.saveLocked(); err != nil {
			w.state.Theme = old
			w.state.PreviousTheme = previousTheme
			return nil, err
		}
		w.feed.publish(role, "theme", next)
		return next, nil
	case "model":
		if p.SessionID != "" && p.SessionID != w.state.ID {
			return nil, fmt.Errorf("会话已经切换，请重新选择模型")
		}
		if p.ExpectedModel != nil {
			current, _ := w.modelLocked(p.Role)
			if current != *p.ExpectedModel {
				return nil, fmt.Errorf("模型已更新，请重新选择")
			}
		}
		if !validWorkspaceRole(p.Role) || w.Mode() == HostOS && p.Role == WorkspaceExecution && !CurrentReleaseStage().TeamCollaboration {
			return nil, fmt.Errorf("invalid role or team collaboration is off")
		}
		if _, err := w.manager.settings(p.ModelID); err != nil {
			return nil, err
		}
		if w.Mode() == HostOS && w.split == nil {
			if err := w.beginContextBookLocked(); err != nil {
				return nil, err
			}
		}
		previous := w.state.Models[p.Role]
		w.state.Models[p.Role] = p.ModelID
		if err := w.saveLocked(); err != nil {
			w.state.Models[p.Role] = previous
			return nil, err
		}
		return map[string]any{"ok": true, "effective": "next_request_boundary"}, nil
	case "open_session", "new_session":
		if w.host == nil {
			return nil, fmt.Errorf("desktop host unavailable")
		}
		id := p.SessionID
		if p.Action == "new_session" {
			id = ""
		}
		workdir := p.Workdir
		if workdir == "" {
			workdir = w.state.Workdir
		}
		next, err := w.host.Open(id, workdir)
		if err != nil {
			return nil, err
		}
		w.feed.publish(role, "activate_session", map[string]any{"session_id": next["session_id"]})
		return map[string]any{"ok": true, "session_id": next["session_id"]}, nil
	case "connect", "control":
		w.feed.publish(role, p.Action, map[string]bool{"requested": true})
		return map[string]any{"ok": true, "state": "requested"}, nil
	case "sessions":
		return w.listSessions()
	}
	return nil, fmt.Errorf("unknown workspace action")
}
