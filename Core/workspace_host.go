// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: WorkspaceHost; NewWorkspaceHost; SetVersion; SetTerminal; SetModuleOnly; isTerminal; roleContract; terminalToolboxCatalog; workspaceToolboxCatalog; terminalWorkspaceAction; toolDefinition; permissions; reportViewerAvailable; hostPermissions; requestPrompt; Open; Close; Call
// Impact: python -B scripts/code-atlas.py show Core/workspace_host.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// WorkspaceHost owns core lifetimes independently of renderer windows. It
// reuses MatrixControl for Control discovery, authentication and settings RPC.
type WorkspaceHost struct {
	conversations    *AgentManager
	programImageRuns map[string]*programImageRun
	mu               sync.Mutex
	config, prompt   string
	promptDir        string
	version          string
	service          *SettingsService
	workspaces       map[string]*Workspace
	controls         map[string]*MatrixControl
	taskWindows      map[string]*MatrixWindow
	closed           bool
	recentReopen     bool
	reopenStamp      shutdownStamp
	reopenChecked    bool
	startedAt        time.Time
	closeOnce        sync.Once
	shutdownDone     chan struct{}
	shutdownErrors   map[string]string
	stationFinish    sync.Mutex
	updateFrozen     bool
	terminal         bool
	moduleOnly       bool
	mode             HostMode
	control          bool
	attachmentUnlock func()
	attachmentGC     attachmentGCResult
	splits           map[string]*workspaceSplit
	stationAdapter   func(context.Context, *Workspace, string) (workspaceMembership, error)
}

func NewWorkspaceHost(config, prompt, promptDir string) *WorkspaceHost {
	return &WorkspaceHost{config: config, prompt: prompt, promptDir: promptDir, startedAt: time.Now(), service: NewSettingsService(config), workspaces: map[string]*Workspace{}, controls: map[string]*MatrixControl{}, taskWindows: map[string]*MatrixWindow{}}
}

// The native entrypoint supplies its actual build version, also for failure receipts.
func (h *WorkspaceHost) SetVersion(version string) { h.version = version }

// A terminal host supplies the same execution core without desktop-only services.
// Configure before Open; this is a capability boundary, not a separate runtime.
func (h *WorkspaceHost) SetTerminal() { h.terminal = true }

// SetModuleOnly defers implicit model work until an explicit user task or
// reconnect. It must be selected before Open, like the host mode.
func (h *WorkspaceHost) SetModuleOnly() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.workspaces) != 0 {
		return fmt.Errorf("module startup must be configured before opening a session")
	}
	h.moduleOnly = true
	return nil
}

func (w *Workspace) isTerminal() bool { return w != nil && w.host != nil && w.host.terminal }

func (w *Workspace) roleContract(role string) string {
	if w.teamHost() {
		return w.teamContract(role)
	}
	if baseToolMode && role == WorkspaceMatrix {
		if w.isTerminal() {
			return baseTerminalContract()
		}
		return baseMatrixContract()
	}
	if w.Mode() == HostOS {
		return w.collaborationContract(role)
	}
	if w.Mode().unified() && role == WorkspaceMatrix {
		contract := strings.Replace(workspaceRoleContract(role), runtimePrompt("Matrix/运行协定/单人派发状态.txt"), runtimePrompt("Matrix/运行协定/协同派发状态.txt"), 1) + runtimePrompt("Matrix/运行协定/共享身份.txt")
		if w.isTerminal() {
			contract += runtimePrompt("Matrix/运行协定/终端回复.txt")
		}
		return contract
	}
	if !w.isTerminal() {
		return workspaceRoleContract(role)
	}
	return runtimePrompt("Matrix/运行协定/终端兼容身份.txt")
}

func terminalToolboxCatalog() string { return runtimePrompt("Matrix/工具说明/终端工具箱.txt") }

func workspaceToolboxCatalog(ctx context.Context) string {
	if !toolboxAvailable(ctx) {
		return ""
	}
	if c, ok := ctx.Value(workspaceContextKey{}).(workspaceContext); ok && c.workspace.isTerminal() {
		return terminalToolboxCatalog() + "\n" + teamToolboxCatalog(ctx)
	}
	return teamToolboxCatalog(ctx)
}

func terminalWorkspaceAction(action string) bool {
	return strings.HasPrefix(action, "workflow_") || action == "model"
}

// 工具定义与实际宿主能力一致，旧会话恢复也不能带回桌面操作。
func (w *Workspace) toolDefinition(d ToolDefinition) ToolDefinition {
	if w.Mode() == HostOS && d.Name == "workspace" {
		if !homeTeamRetired {
			d = collaborationToolDefinition(d)
		}
		if !w.isTerminal() {
			d = desktopToolDefinition(d)
		}
	}
	if !w.isTerminal() {
		return d
	}
	switch d.Name {
	case "toolbox":
		d.Description = terminalToolboxCatalog()
	case "workspace":
		d.Description = runtimePrompt("Matrix/工具说明/终端工作区.txt")
		properties := d.Parameters.(map[string]any)["properties"].(map[string]any)
		properties["action"] = schemaEnum("model", "workflow_status", "workflow_capture", "workflow_evidence", "workflow_reconcile", "workflow_deliver")
	}
	return d
}

func (w *Workspace) permissions(role string) []string {
	if w.teamHost() {
		return w.teamPermissions(role)
	}
	// 基础工具模式对 OS 与终端宿主（CLI）同样生效（CLI 同步，用户 2026-10-10 确认）：
	// 权限、工具定义、toolbox 目录、工作流提示和完成门都由这里同源决定。
	permissions := w.hostPermissions(role)
	// 基础模式只把 workspace 里的报告三项拆成独立的 report 工具交回（用户 2026-10-14 选 A）；
	// 只有有报告查看器的 OS 桌面宿主才有，CLI 终端没有文档页。
	if baseToolMode && w.reportViewerAvailable() {
		for _, name := range permissions {
			if name == "workspace" {
				permissions = append(permissions, "report")
				break
			}
		}
	}
	result := baseToolPermissions(permissions)
	return result
}

// 报告查看器只在 OS 桌面宿主上存在。
func (w *Workspace) reportViewerAvailable() bool {
	if w.privateAgentScope {
		return w.manager != nil && w.manager.taskProjection != nil && w.manager.taskProjection.Mode() == HostOS
	}
	return w.Mode() == HostOS && !w.isTerminal()
}

func (w *Workspace) hostPermissions(role string) []string {
	permissions := workspacePermissions(role)
	if w.askUserAvailable(role) {
		permissions = append(permissions, "ask_user")
	}
	if w.Mode() == HostOS && !w.isTerminal() && role == WorkspaceMatrix {
		permissions = append(permissions, "agents")
	}
	if w.Mode() == HostOS && role == WorkspaceMatrix {
		permissions = append(permissions, "team")
	}
	if w.host == nil || !w.host.terminal {
		return permissions
	}
	result := make([]string, 0, len(permissions))
	for _, name := range permissions {
		switch name {
		case "browser", "settings", "community", "feedback", "updates", "apps", "exec", "wait", "tool_factory":
			continue
		}
		result = append(result, name)
	}
	return result
}

// 请求边界重新读取原提示词目录，编辑文件无需重启或中断工具事务。
func (w *Workspace) requestPrompt(settings *Settings) (string, error) {
	if w.host == nil {
		return w.prompt, nil
	}
	loaded, err := LoadPrompts(w.host.promptDir)
	if err != nil {
		return "", err
	}
	settings.SetLoadedPrompt(loaded.Text)
	return settings.EffectiveSystemPrompt(), nil
}

func (h *WorkspaceHost) Open(id, workdir string) (map[string]any, error) {
	if err := ValidatePrivateProfile(h.config); err != nil {
		return nil, err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || h.updateFrozen {
		return nil, fmt.Errorf("core is closed")
	}
	if h.attachmentUnlock == nil {
		h.attachmentGC = collectAttachments(h.config)
		var err error
		h.attachmentUnlock, err = attachmentLease(h.config)
		if err != nil {
			return nil, err
		}
	}
	if h.mode.unified() && (id != "" || len(h.workspaces) != 0) {
		return nil, fmt.Errorf("Eyra has one primary conversation; use split tasks, not saved sessions")
	}
	if h.mode == HostOS && !h.reopenChecked {
		h.reopenChecked = true
		h.reopenStamp, h.recentReopen = consumeRecentShutdown(h.config, h.startedAt, startupReopenPolicy().Seconds)
	}
	w := h.workspaces[id]
	if w == nil {
		if len(h.workspaces) >= 16 {
			return nil, fmt.Errorf("最多同时打开 16 个会话")
		}
		var err error
		service := h.service
		w, err = newWorkspace(h.config, id, workdir, h.prompt, service, h)
		if err != nil {
			return nil, err
		}
		w.host = h
		control, err := NewMatrixControl(w.manager)
		if err != nil {
			w.Close()
			return nil, err
		}
		h.workspaces[w.state.ID], h.controls[w.state.ID] = w, control
		w.coreLinkRegistered.Store(h.mode == HostOS && w.split == nil)
		if h.mode.unified() {
			// Hosts project children in tabs/task menus; opening a view never
			// creates a second executor or a competing native window.
			w.manager.taskWindow = func(id, mode string) error { return nil }
			w.manager.taskWindowHide = func(id string) error { return nil }
		}
	}
	c := h.controls[w.state.ID]
	return map[string]any{"session_id": w.state.ID, "url": c.address + "/v1/rpc", "token": c.token, "prompt_dir": h.promptDir, "version": h.version, "capabilities": []string{"workspace.conversation", "workspace.packages", "workspace.paths", "workspace.workflows", "workspace.agents"}, "mode": h.mode, "discovery": c.file}, nil
}

func (h *WorkspaceHost) Close() {
	h.closeOnce.Do(func() {
		<-h.beginShutdown()
		for _, window := range h.taskWindows {
			window.Close()
		}
		for _, c := range h.controls {
			c.Close()
		}
		greeting, greetingAfter := "", 0
		for _, w := range h.workspaces {
			if text, after := w.shownGreeting(); text != "" {
				greeting, greetingAfter = text, after
			}
			w.Close()
		}
		h.service.Close()
		h.mu.Lock()
		if h.mode == HostOS && len(h.workspaces) > 0 && len(h.shutdownErrors) == 0 {
			if err := saveNormalShutdown(h.config, time.Now(), greeting, greetingAfter); err != nil {
				h.shutdownErrors["startup_stamp"] = "shutdown_stamp_not_saved"
			}
		}
		h.mu.Unlock()
		if h.attachmentUnlock != nil {
			h.attachmentUnlock()
			h.attachmentUnlock = nil
		}
	})
}

func (w *Workspace) Call(ctx context.Context, action string, args json.RawMessage) (any, error) {
	if w.host != nil && w.host.terminal {
		switch action {
		case "workspace.community_bridge", "workspace.browser_bridge", "workspace.updates", "workspace.update_notice", "workspace.update_freeze", "workspace.update_unfreeze", "workspace.configure":
			return nil, fmt.Errorf("desktop service is unavailable in the CLI host")
		}
	}
	if len(args) == 0 {
		args = json.RawMessage("{}")
	}
	var p struct {
		TaskID      string               `json:"task_id"`
		RequestID   string               `json:"request_id"`
		Message     string               `json:"message"`
		CoreEpoch   string               `json:"core_epoch"`
		Display     string               `json:"display"`
		Attachments []ComposerAttachment `json:"attachments"`
		ID          string               `json:"id"`
		Workdir     string               `json:"workdir"`
	}
	if err := json.Unmarshal(args, &p); err != nil {
		return nil, err
	}
	if p.TaskID != "" && p.TaskID != w.state.ID && scopedWorkspaceAction(action) {
		return w.scopedTaskCall(ctx, action, args, p.TaskID)
	}
	switch action {
	case "workspace.paths", "workspace.packages", "workspace.workflows", "workspace.agents":
		if p.TaskID != "" && p.TaskID != w.state.ID {
			return nil, fmt.Errorf("package management requires the primary host")
		}
		if action == "workspace.agents" {
			return w.packageAgentsCall(ctx, args)
		}
		if action == "workspace.workflows" {
			return w.workboxesCall(ctx, args)
		}
		if action == "workspace.paths" {
			return w.packagesCall(ctx, json.RawMessage(`{"action":"capabilities"}`))
		}
		return w.packagesCall(ctx, args)
	case "workspace.program_images", "workspace.program_videos":
		if w.host == nil {
			return nil, fmt.Errorf("画布宿主不可用")
		}
		if action == "workspace.program_videos" {
			return w.host.programVideos(ctx, args)
		}
		return w.host.programImages(ctx, args)
	case "workspace.context":
		return w.contextCall(ctx, args)
	case "workspace.conversation":
		if w.host == nil {
			return nil, fmt.Errorf("对话智能体宿主不可用")
		}
		result, err := w.host.conversationCall(ctx, args)
		if partial, ok := result.(map[string]any); ok && partial["cleanup"] != nil && err != nil {
			// Preserve partial cleanup details across RPC; ok=false remains a failure.
			partial["ok"], partial["error"] = false, err.Error()
			return partial, nil
		}
		return result, err
	case "workspace.ask_reply":
		return w.replyAsk(args)
	case "workspace.withdraw":
		return w.withdraw(p.RequestID)
	case "workspace.shutdown":
		// A task's own authenticated endpoint cannot close its parent or siblings.
		if w.host == nil || w.isTerminal() || w.split != nil || (p.TaskID != "" && p.TaskID != w.state.ID) {
			return nil, fmt.Errorf("shutdown requires the primary desktop host")
		}
		return w.host.shutdownStatus(), nil
	case "workspace.activate":
		if w.Mode() != HostLegacy {
			return map[string]bool{"ok": true}, nil
		}
		return map[string]bool{"ok": true}, w.rememberActive()
	case "workspace.community_bridge":
		var bridge struct {
			URL string `json:"url"`
		}
		if err := json.Unmarshal(args, &bridge); err != nil {
			return nil, err
		}
		if err := w.service.SetCommunityBridge(bridge.URL); err != nil {
			return nil, err
		}
		return map[string]bool{"ok": true}, nil
	case "workspace.browser_bridge":
		var bridge struct {
			URL string `json:"url"`
		}
		if err := json.Unmarshal(args, &bridge); err != nil {
			return nil, err
		}
		if err := w.service.SetBrowserBridge(bridge.URL); err != nil {
			return nil, err
		}
		return map[string]bool{"ok": true}, nil
	case "workspace.updates":
		return w.service.CallTool(ctx, "updates", w.state.ID, args)
	case "workspace.update_notice":
		return w.updateNotice(ctx)
	case "workspace.update_freeze":
		if w.host == nil {
			return nil, fmt.Errorf("desktop host unavailable")
		}
		return w.host.freezeForUpdate(true)
	case "workspace.update_unfreeze":
		if w.host == nil {
			return nil, fmt.Errorf("desktop host unavailable")
		}
		return w.host.freezeForUpdate(false)
	case "workspace.tasks":
		return w.taskList(), nil
	case "workspace.collaboration":
		return w.collaborationCall(ctx, WorkspaceMatrix, args)
	case "workspace.terminals", "workspace.terminal_read", "workspace.terminal_input", "workspace.terminal_resize", "workspace.tool_image":
		return w.terminalCall(ctx, action, args)
	case "workspace.task_snapshot", "workspace.task_status", "workspace.task_send", "workspace.task_cancel":
		return w.taskCall(ctx, action, args)
	case "workspace.snapshot":
		var snapshot struct {
			Cursor uint64 `json:"cursor"`
			View   string `json:"view"`
		}
		if err := json.Unmarshal(args, &snapshot); err != nil {
			return nil, err
		}
		if snapshot.View == "internal_link" {
			return w.internalLinkBoard()
		}
		var cursors WorkspaceCursor
		if err := json.Unmarshal(args, &cursors); err != nil {
			return nil, err
		}
		return w.snapshot(snapshot.Cursor, cursors)
	case "workspace.artifact":
		return w.artifactPath(args)
	case "workspace.messages":
		return w.messagePage(args), nil
	case "workspace.history":
		return w.historyPage(args)
	case "workspace.receipt":
		return w.historyReceipt(args)
	case "workspace.send_receipt":
		return w.sendReceipt(args)
	case "workspace.retry_chat":
		return w.retryChat(args)
	case "matrix.status":
		return w.controlStatus(p.RequestID)
	case "matrix.events":
		return w.controlEvents(args)
	case "matrix.send":
		if _, err := w.controlSend(p.RequestID, p.Message, p.Attachments...); err != nil {
			return nil, err
		}
		return w.controlStatus(p.RequestID)
	case "matrix.cancel":
		return w.controlCancel(p.RequestID)
	case "workspace.send":
		return w.controlSend(p.RequestID, p.Message, p.Attachments...)
	case "workspace.send_scoped":
		if p.CoreEpoch == "" {
			return nil, fmt.Errorf("core_epoch is required")
		}
		return w.controlSendScoped(p.CoreEpoch, p.RequestID, p.Message, p.Attachments...)
	case "workspace.link_notice":
		return w.linkNotice(p.RequestID, p.Message, p.Display)
	case "workspace.cancel":
		return map[string]any{"ok": true}, w.Cancel()
	case "workspace.sessions":
		return w.listSessions()
	case "workspace.open":
		if w.host == nil {
			return nil, fmt.Errorf("desktop host unavailable")
		}
		if p.Workdir == "" {
			p.Workdir = w.state.Workdir
		}
		if !filepath.IsAbs(p.Workdir) {
			return nil, fmt.Errorf("workdir must be absolute")
		}
		return w.host.Open(p.ID, p.Workdir)
	case "workspace.configure":
		return w.configure(WorkspaceMatrix, args)
	case "workspace.selfcheck", "workspace.greet":
		return w.greet(args)
	case "workspace.document":
		return w.readDocument(p.ID)
	case "workspace.diary":
		return w.diaryAction(ctx, args)
	case "workspace.notice":
		return w.notice(args)
	case "workspace.document_state":
		return w.documentState(args)
	case "workspace.workflow":
		return w.workflow(ctx, rawJSON(map[string]any{"action": "workflow_status"}))
	case "workspace.acknowledge":
		w.mu.Lock()
		defer w.mu.Unlock()
		id := w.state.Roles[p.ID]
		if id == "" {
			return nil, fmt.Errorf("unknown role")
		}
		r, e := w.manager.Status(w.state.ID, id)
		if e != nil {
			return nil, e
		}
		if activeAgent(r.State) {
			return nil, fmt.Errorf("role is still active")
		}
		w.feed.publish(p.ID, "acknowledged", map[string]any{"generation": r.Generation})
		return map[string]bool{"ok": true}, nil
	}
	if strings.HasPrefix(action, "workspace.") {
		return nil, fmt.Errorf("unknown workspace action")
	}
	return nil, fmt.Errorf("unknown core command")
}
