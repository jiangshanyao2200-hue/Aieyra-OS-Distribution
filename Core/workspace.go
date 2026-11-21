// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Workspace; workspaceMessage; workspaceState; workspaceTalk; workspaceContextKey; workspaceTrustedKey; workspaceContext; workspaceID; validWorkspaceRole; workspacePermissions; NewWorkspace; newWorkspace; newWorkspaceWithSplit; Close; stop; saveLocked; modelLocked; modelSettingsLocked; enqueue; enqueueState; enqueueStateWithHash; enqueueAttachments; enqueueAttachmentsLocked; enqueueMessageLocked; enqueueMessageWithRepairLocked; Send; dispatchLocked; pump; drain; withdraw; recordOutput; reconcileDeliveredLocked; recordOutputLocked; Cancel; cancelLocked; beginTurnFilesLocked
// Impact: python -B scripts/code-atlas.py show Core/workspace.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	WorkspaceMatrix    = "matrix"
	WorkspaceProject   = "project"
	WorkspaceExecution = "execution"
)

// The workspace supervises fixed sibling roles. Delegation authority is not
// inherited from Matrix's project tool permissions. Only this trusted boundary
// can create a role; model-created agents cannot nominate themselves as one.
type Workspace struct {
	projectProducts      string   // Optional managed work-products subtree, never a private state root.
	privateAgentScope    bool     // Instance-owned Memory, maps and reports; not a primary role.
	teamGrants           sync.Map // 角色 → Eyra 这次派工分配的 toolbox 能力
	contextCatalogDigest string
	contextBook          *eyraContextBook
	contextUsageBase     map[string]any // Saved total before this runtime's current role was created.
	initialContextID     string         // Owns background requests begun before the first durable conversation.
	contextRoot          string
	contextWorkdir       string // Immutable physical workdir at context admission.
	contextOrigin        string // Former workdir identity selected from a durable catalog.
	compaction           *contextCompaction
	identity             *motherIdentity
	contextClean         *contextCleaning
	contextUnlock        func()
	contextMemoryOff     atomic.Bool
	mu                   sync.Mutex
	config, dir, prompt  string
	state                workspaceState
	manager              *AgentManager
	service              *SettingsService
	feed                 workspaceFeed
	cancel               context.CancelFunc
	done                 chan struct{}
	closeOnce            sync.Once
	stopOnce             sync.Once
	stopError            error
	live                 map[string]WorkspaceLive
	turnFiles            map[string]fileStamp // 本轮开工时的工作目录清单（B1 产物）；回复落地后清空
	artifactNotes        int                  // 本次启动已写入记忆原文的交付文件记录数
	host                 *WorkspaceHost
	epoch                string
	notified             chan struct{}
	greeting             WorkspaceGreeting
	greetingCancel       context.CancelFunc
	greetingWG           sync.WaitGroup
	greetingUsage        []AgentUsage
	greetingEpoch        uint64
	startupPrepared      bool
	startupDeferred      bool
	startupWorkers       int
	startupCheckpoint    *Checkpoint
	startupEpoch         uint64
	startupCancel        context.CancelFunc
	startupDone          chan struct{}
	startupStarted       bool
	startupError         string
	startupSource        string
	startupCount         int
	startupDigest        string
	startupHistory       *RestoredSession
	closed               bool
	coreLinkRegistered   atomic.Bool // host has registered this real enqueue/pump endpoint
	updateFrozen         bool
	workflowPlan         *PlanState
	workflowAgent        string
	workflowGeneration   int
	priorGeneration      int
	runtimeUnlock        func()
	reportsReadAt        time.Time
	history              workspaceHistory
	historySession       string // Non-executing managed-history reader, limited to this session.
	retiredMessages      map[string]workspaceRetiredMessage
	collaboration        workspaceCollaboration
	split                *workspaceSplit
	fast                 fastMemory   // 完整原文持久待写队列；旧状态兼容
	sub                  subconscious // 退役潜意识的历史快照与旧共享日记读取兼容
}

type workspaceMessage struct {
	Repair       *motherRepairEvent      `json:"repair,omitempty"`
	CoreLink     *conversationLinkOrigin `json:"core_link,omitempty"`
	DeliveryName string                  `json:"delivery_name,omitempty"`
	DisplayText  string                  `json:"display_text,omitempty"`
	Origin       string                  `json:"origin,omitempty"`
	Attachments  []ComposerAttachment    `json:"attachments,omitempty"`
	RunTime      *AgentRunTime           `json:"run_time,omitempty"`
	Generation   int                     `json:"generation,omitempty"`
	AgentID      string                  `json:"agent_id,omitempty"`
	TurnID       string                  `json:"turn_id,omitempty"`
	ID           string                  `json:"id"`
	From         string                  `json:"from"`
	To           string                  `json:"to"`
	Text         string                  `json:"text"`
	MessageHash  string                  `json:"message_hash,omitempty"`
	Reference    bool                    `json:"reference,omitempty"`
	State        string                  `json:"state"`
	Error        string                  `json:"error,omitempty"`
	DocumentID   string                  `json:"document_id,omitempty"`
	Artifacts    []WorkspaceArtifact     `json:"artifacts,omitempty"`
	At           string                  `json:"at"`
}

type workspaceState struct {
	AskRequests    []WorkspaceAskRequest `json:"ask_requests,omitempty"`
	Revision       uint64                `json:"revision"`
	Version        int                   `json:"version"`
	ID             string                `json:"id"`
	Workdir        string                `json:"workdir"`
	Models         map[string]string     `json:"models"`
	Roles          map[string]string     `json:"roles"`
	Messages       []workspaceMessage    `json:"messages"`
	Theme          WorkspaceTheme        `json:"theme"`
	PreviousTheme  *WorkspaceTheme       `json:"previous_theme,omitempty"`
	TeamTalk       []workspaceTalk       `json:"team_talk,omitempty"`
	LastRead       string                `json:"last_project_read,omitempty"`
	Review         *workspaceReview      `json:"review,omitempty"`
	Documents      []WorkspaceDocument   `json:"documents,omitempty"`
	HistorySegment string                `json:"history_segment,omitempty"`
	HistoryAfter   string                `json:"history_after,omitempty"`
	// 派出去没等的成员：角色 → 代数。做完后主动告诉 Eyra，见 deliverTeamResultsLocked。
	TeamAwait map[string]int `json:"team_await,omitempty"`
}

// 团队成员之间给人看的一句话（brief）。原文留在各自上下文和执行记录里，聊天只显示这一句。
type workspaceTalk struct {
	ID         string `json:"id"`
	From       string `json:"from"`
	To         string `json:"to"`
	Brief      string `json:"brief"`
	Kind       string `json:"kind"`
	Generation int    `json:"generation,omitempty"`
	At         string `json:"at"`
}

type workspaceContextKey struct{}
type workspaceTrustedKey struct{}
type workspaceContext struct {
	workspace *Workspace
	role      string
}

func workspaceID() string { var b [16]byte; _, _ = rand.Read(b[:]); return hex.EncodeToString(b[:]) }
func validWorkspaceRole(role string) bool {
	return role == WorkspaceMatrix || role == WorkspaceProject || role == WorkspaceExecution
}

func workspacePermissions(role string) []string {
	switch role {
	case WorkspaceMatrix:
		return []string{"models", "image_gen", "memory", "community", "link", "server", "updates", "apps", "workspace", "project", "terminal", "exec_command", "write_stdin", "read_shell_output", "apply_patch", "exec", "wait", "update_plan", "view_image", "web_search", "ask_subconscious", "share_diary", "settings", "compact", "human", "browser", "tool_factory"}
	case WorkspaceProject:
		return []string{"team", "project", "compact"}
	case WorkspaceExecution:
		return []string{"team", "project", "terminal", "exec_command", "write_stdin", "read_shell_output", "apply_patch", "exec", "wait", "update_plan", "view_image", "web_search", "compact", "browser", "tool_factory"}
	}
	return nil
}

func NewWorkspace(config, id, workdir, prompt string, service *SettingsService) (*Workspace, error) {
	return newWorkspace(config, id, workdir, prompt, service, nil)
}

func newWorkspace(config, id, workdir, prompt string, service *SettingsService, host *WorkspaceHost) (*Workspace, error) {
	return newWorkspaceWithSplit(config, id, workdir, prompt, service, host, nil)
}

func newWorkspaceWithSplit(config, id, workdir, prompt string, service *SettingsService, host *WorkspaceHost, split *workspaceSplit) (*Workspace, error) {
	if id == "" {
		id = workspaceID()
	}
	if !sessionIDPattern.MatchString(id) {
		return nil, fmt.Errorf("invalid workspace ID")
	}
	abs, err := filepath.Abs(workdir)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(abs)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("工作目录不存在")
	}
	mode := HostLegacy
	if host != nil {
		mode = host.mode
	}
	dir := workspaceDirectory(config, id, mode)
	if err = os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	w := &Workspace{config: config, dir: dir, prompt: prompt, service: service, done: make(chan struct{}), live: map[string]WorkspaceLive{}, epoch: workspaceID(), notified: make(chan struct{}, 1)}
	w.host = host
	w.startupDeferred = host != nil && host.moduleOnly
	w.split = split
	if split != nil {
		// 在 pump 和任何请求启动前固定任务身份，不继承父任务的启动工作。
		w.collaboration.Mode = "split"
		w.startupPrepared = true
		w.greeting.State = "skipped"
	}
	if mode.unified() {
		if err = w.prepareOSRuntime(); err != nil {
			return nil, err
		}
		defer func() {
			if w.cancel == nil {
				w.releaseOSRuntime()
			}
		}()
	}
	w.state = workspaceState{Version: 1, ID: id, Workdir: abs, Models: map[string]string{}, Roles: map[string]string{}, Messages: []workspaceMessage{}, Theme: defaultWorkspaceTheme()}
	if data, e := os.ReadFile(filepath.Join(dir, "workspace.json")); e == nil {
		if json.Unmarshal(data, &w.state) != nil || w.state.ID != id || w.state.Version != 1 || w.state.Models == nil || w.state.Roles == nil {
			return nil, fmt.Errorf("工作区记录损坏；原文件已保留")
		}
		// Never automatically replay a queued mutation after core interruption.
		for i := range w.state.Messages {
			if w.state.Messages[i].State == "queued" || w.state.Messages[i].State == "context" {
				w.state.Messages[i].State = "interrupted"
			}
		}
	} else if !os.IsNotExist(e) {
		return nil, e
	}
	w.manager, err = newAgentManager(config, id, service, managerDirectory(config, id, mode))
	if err != nil {
		if sessionInUse(err) {
			return nil, fmt.Errorf("%w: %s", ErrWorkspaceInUse, id)
		}
		return nil, err
	}
	w.manager.workspace = w
	if host != nil && mode == HostOS && split == nil {
		w.manager.linkContacts = host.conversationManager
	}
	if err = w.retireFixedExecution(); err != nil {
		w.manager.Close()
		return nil, err
	}
	if split != nil {
		w.manager.taskWindow = func(string, string) error { return nil }
		w.manager.taskWindowHide = func(string) error { return nil }
	}
	if err = w.refreshReportsLocked(); err != nil {
		w.manager.Close()
		return nil, err
	}
	workflow, workflowErr := w.loadWorkflowLocked()
	if workflowErr != nil {
		w.manager.Close()
		return nil, workflowErr
	}
	w.workflowPlan = ClonePlan(workflow.Plan)
	w.workflowAgent, w.workflowGeneration = workflow.Agent, workflow.Generation
	for _, record := range w.manager.List(id) {
		if validWorkspaceRole(record.Spec.WorkspaceRole) {
			w.state.Roles[record.Spec.WorkspaceRole] = record.ID
			if record.Spec.WorkspaceRole == WorkspaceMatrix {
				w.priorGeneration = record.Generation
			}
		}
	}
	// 派发回执与最终结果分开落盘。进程中断后，不能让旧消息永久显示运行中。
	for i := range w.state.Messages {
		message := &w.state.Messages[i]
		if message.State != "delivered" {
			continue
		}
		record, e := w.manager.Status(id, w.state.Roles[message.To])
		if e == nil && record.Generation == message.Generation && record.State == "waiting_user" {
			continue // 人工答复仍绑定原任务，不能把有效等待改成可重发任务。
		}
		message.State = "interrupted"
		message.Error = "上次运行已中断，请先检查实际结果，再决定是否继续。"
		if e == nil && record.Generation == message.Generation && !activeAgent(record.State) {
			switch record.State {
			case "completed", "failed", "cancelled", "timed_out", "persistence_failed":
				message.State, message.Error = record.State, record.Error
			}
		}
	}
	if err = w.loadContextBookLocked(); err != nil {
		w.manager.Close()
		return nil, err
	}
	if err = w.saveLocked(); err != nil {
		if w.contextUnlock != nil {
			w.contextUnlock()
			w.contextUnlock = nil
		}
		w.manager.Close()
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	w.cancel = cancel
	// Replay durable originals left by prior launches without requiring a new
	// user message or a model request. The writer remains asynchronous.
	w.transcribe(nil)
	go w.pump(ctx)
	return w, nil
}

func (w *Workspace) Close() {
	if w != nil {
		w.closeOnce.Do(func() {
			_ = w.stop()
			if w.contextUnlock != nil {
				w.contextUnlock()
				w.contextUnlock = nil
			}
			w.releaseOSRuntime()
		})
	}
}

// Stop execution and finish membership while the native host still owns its
// bridges. Runtime/profile files are released only after that host has exited.
func (w *Workspace) stop() error {
	if w != nil {
		w.stopOnce.Do(func() {
			w.mu.Lock()
			w.closed = true
			if w.contextClean != nil && w.contextClean.cancel != nil {
				w.contextClean.cancel()
			}
			if w.split != nil {
				w.split.mu.Lock()
				if !w.split.Started {
					w.split.Cancelled = true
				}
				if w.split.CancelJoin != nil {
					w.split.CancelJoin()
				}
				w.split.mu.Unlock()
			}
			if w.greetingCancel != nil {
				w.greetingCancel()
			}
			if w.startupCancel != nil {
				w.startupCancel()
			}
			w.mu.Unlock()
			w.cancel()
			<-w.done
			w.greetingWG.Wait()
			w.manager.Close()
			w.flushTranscript(3 * time.Second)
			if w.split != nil {
				// The tasks share project memory. Cancel workers in parallel, but
				// serialize this host's CAS saves so a full set of tasks cannot
				// exhaust each other's bounded conflict retries.
				w.host.stationFinish.Lock()
				w.stopError = w.splitStationBoundary(context.Background(), "finish")
				w.host.stationFinish.Unlock()
				w.split.mu.Lock()
				member := w.split.Membership
				w.split.mu.Unlock()
				if w.stopError == nil {
					switch {
					case member.Error != "":
						w.stopError = fmt.Errorf("%s", member.Error)
					case member.State == "not_joined":
					case member.Stale || (member.State != "closed" && member.State != "finished"):
						w.stopError = fmt.Errorf("station_finish_unconfirmed")
					}
				}
			}
		})
		return w.stopError
	}
	return nil
}

func (w *Workspace) saveLocked() error {
	w.state.Revision++
	if w.Mode().unified() {
		return w.persistContextChatLocked()
	}
	b, err := json.MarshalIndent(w.state, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(w.dir, ".workspace-*.tmp")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err = f.Write(b); err == nil {
		err = f.Sync()
	}
	ce := f.Close()
	if err == nil {
		err = ce
	}
	if err != nil {
		return err
	}
	return os.Rename(name, filepath.Join(w.dir, "workspace.json"))
}

func (w *Workspace) modelLocked(role string) (string, error) {
	id, _, err := w.modelSettingsLocked(role)
	return id, err
}

func (w *Workspace) modelSettingsLocked(role string) (string, *Settings, error) {
	id := w.state.Models[role]
	if id == "" {
		s, e := Load(w.config)
		if e != nil {
			return "", nil, e
		}
		id = s.roleProfile(role)
		if id == "" {
			id = s.defaultMotherModel()
		}
	}
	settings, err := w.manager.settings(id)
	if err != nil {
		return id, nil, fmt.Errorf("请先接入一个经过验证的模型：%w", err)
	}
	return id, settings, nil
}

func (w *Workspace) enqueue(from, to, id, text string) (workspaceMessage, error) {
	return w.enqueueState(from, to, id, text, "queued")
}
func (w *Workspace) enqueueState(from, to, id, text, state string) (workspaceMessage, error) {
	return w.enqueueStateWithHash(from, to, id, text, state, "")
}
func (w *Workspace) enqueueStateWithHash(from, to, id, text, state, messageHash string) (workspaceMessage, error) {
	return w.enqueueAttachments(from, to, id, text, state, messageHash, nil)
}
func (w *Workspace) enqueueAttachments(from, to, id, text, state, messageHash string, attachments []ComposerAttachment) (workspaceMessage, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.enqueueAttachmentsLocked(from, to, id, text, state, messageHash, attachments)
}

// Ask answers and their queue receipt commit under the same workspace lock.
func (w *Workspace) enqueueAttachmentsLocked(from, to, id, text, state, messageHash string, attachments []ComposerAttachment, displayText ...string) (workspaceMessage, error) {
	return w.enqueueMessageLocked(from, to, id, text, state, messageHash, attachments, nil, displayText...)
}

func (w *Workspace) enqueueMessageLocked(from, to, id, text, state, messageHash string, attachments []ComposerAttachment, origin *conversationLinkOrigin, displayText ...string) (workspaceMessage, error) {
	return w.enqueueMessageWithRepairLocked(from, to, id, text, state, messageHash, attachments, origin, nil, displayText...)
}

func (w *Workspace) enqueueMessageWithRepairLocked(from, to, id, text, state, messageHash string, attachments []ComposerAttachment, origin *conversationLinkOrigin, repair *motherRepairEvent, displayText ...string) (workspaceMessage, error) {
	if w.closed || w.updateFrozen {
		return workspaceMessage{}, fmt.Errorf("更新交接中，草稿已保留，请稍候")
	}
	if w.split != nil {
		w.split.mu.Lock()
		cancelled := w.split.Cancelled && !w.split.Started
		pending := !w.split.Started
		member := w.split.Membership
		initial := id == "split-"+w.split.ID && from == "user" && to == WorkspaceMatrix && member.State == "connected" && !member.Stale
		w.split.mu.Unlock()
		if cancelled {
			return workspaceMessage{}, fmt.Errorf("pending split was cancelled; it cannot replay")
		}
		if pending && !initial {
			return workspaceMessage{}, fmt.Errorf("split enrollment must succeed before sending; retry the original task")
		}
	}
	if !validWorkspaceRole(to) || id == "" || len(id) > 128 || (strings.TrimSpace(text) == "" && len(attachments) == 0) || len(text) > 64<<10 {
		return workspaceMessage{}, fmt.Errorf("消息、角色或请求标识无效")
	}
	for _, m := range w.state.Messages {
		if m.ID == id {
			if m.From != from || m.To != to || attachmentMessageHash(m.Text, m.Attachments) != attachmentMessageHash(text, attachments) || messageHash != "" && workspaceMessageHash(m) != messageHash {
				return m, fmt.Errorf("请求标识冲突")
			}
			return m, nil
		}
	}
	if old, ok := w.retiredMessages[id]; ok {
		m := old.Message
		if m.From != from || m.To != to || old.TextHash != attachmentMessageHash(text, attachments) || messageHash != "" && m.MessageHash != messageHash {
			return m, fmt.Errorf("请求标识冲突")
		}
		return m, nil
	}
	// Only a fresh request beyond deduplication can be rejected as not admitted.
	// Errors after appending/saving still require the ordinary receipt check.
	notAdmitted := func(err error) error {
		return &composerSendRejection{TaskID: w.state.ID, RequestID: id, Code: "not_admitted", Cause: err}
	}
	if w.manager != nil {
		if err := w.manager.admitFixedRole(context.Background(), to); err != nil {
			return workspaceMessage{}, notAdmitted(err)
		}
	}
	w.retainChatLocked()
	if len(w.state.Messages) >= 10000 {
		return workspaceMessage{}, notAdmitted(fmt.Errorf("会话消息已达上限，请创建新会话"))
	}
	model, err := w.modelLocked(to)
	if err != nil {
		return workspaceMessage{}, notAdmitted(err)
	}
	if len(attachments) > 0 {
		settings, e := w.manager.settings(model)
		if e != nil {
			return workspaceMessage{}, notAdmitted(e)
		}
		if _, e = prepareComposerAttachments(w.config, attachments, settings); e != nil {
			return workspaceMessage{}, &composerSendRejection{TaskID: w.state.ID, RequestID: id, Cause: e}
		}
	}
	if w.coreLinkRegistered.Load() && w.contextBook == nil {
		if err := w.beginContextBookLocked(); err != nil {
			return workspaceMessage{}, notAdmitted(err)
		}
	}
	m := workspaceMessage{Repair: repair, ID: id, From: from, To: to, Text: text, Attachments: append([]ComposerAttachment(nil), attachments...), CoreLink: origin, MessageHash: messageHash, State: state, At: time.Now().UTC().Format(time.RFC3339Nano)}
	if len(displayText) > 0 {
		m.DisplayText = displayText[0]
	}
	if len(displayText) > 1 {
		m.Origin = displayText[1]
	}
	w.state.Messages = append(w.state.Messages, m)
	if err := w.saveLocked(); err != nil {
		w.state.Messages = w.state.Messages[:len(w.state.Messages)-1]
		return m, err
	}
	w.retainChatLocked()
	w.feed.publish(to, "message", m)
	if w.split != nil {
		// 与入队和取消共用工作区锁，首条提交不能被误报为仍待接入。
		w.split.mu.Lock()
		w.split.Started = true
		w.split.Message = ""
		w.split.mu.Unlock()
	}
	if to == WorkspaceMatrix {
		// New work owns the voice immediately; a late greeting cannot replace it
		// or acknowledge a dream that the user never had a chance to see.
		if from == "user" && w.greeting.State == "connecting" {
			w.greetingEpoch++
			if w.greetingCancel != nil {
				w.greetingCancel()
				w.greetingCancel = nil
			}
			w.greeting = WorkspaceGreeting{State: "skipped", Revision: w.greeting.Revision + 1}
		}
		select {
		case w.notified <- struct{}{}:
		default:
		}
	}
	return m, nil
}

func (w *Workspace) Send(id, text string) (workspaceMessage, error) {
	return w.enqueue("user", WorkspaceMatrix, id, text)
}

func (w *Workspace) dispatchLocked(role, request, message string, attachments ...ComposerAttachment) (AgentRecord, error) {
	if w.coreLinkRegistered.Load() && w.contextBook == nil {
		if err := w.beginContextBookLocked(); err != nil {
			return AgentRecord{}, err
		}
	}
	for _, pending := range w.state.Messages {
		if pending.ID == request && pending.CoreLink != nil {
			w.manager.linkOperation.Lock()
			defer w.manager.linkOperation.Unlock()
			if err := w.checkCoreLinkMessageLocked(pending); err != nil {
				return AgentRecord{}, err
			}
			break
		}
	}
	if !validWorkspaceRole(role) || role != WorkspaceMatrix && !w.collaborationRoleLocked(role) {
		return AgentRecord{}, fmt.Errorf("团队任务尚未启用，请由 Matrix 直接完成")
	}
	if err := w.manager.admitFixedRole(context.Background(), role); err != nil {
		return AgentRecord{}, err
	}
	model, err := w.modelLocked(role)
	if err != nil {
		return AgentRecord{}, err
	}
	if settings, e := w.manager.settings(model); e == nil && role == WorkspaceMatrix {
		w.startupDeferred = false
		w.startStartupLocked(settings, false)
	}
	id := w.state.Roles[role]
	dispatchContext := context.WithValue(context.Background(), workspaceTrustedKey{}, true)
	for _, pending := range w.state.Messages {
		if pending.ID == request && pending.Repair != nil {
			if ready, _ := w.repairReadyLocked(pending); !ready {
				return AgentRecord{}, errAgentFinishing
			}
			e := pending.Repair
			dispatchContext = context.WithValue(dispatchContext, motherRepairRunKey{}, request)
			dispatchContext = context.WithValue(dispatchContext, conversationLinkOriginKey{}, conversationLinkOrigin{Scope: w.coreLinkScopeLocked(), From: e.Source, Generation: e.Generation, Kind: "intervention"})
			break
		}
	}
	for _, pending := range w.state.Messages {
		if pending.ID == request && pending.CoreLink != nil {
			dispatchContext = context.WithValue(dispatchContext, conversationLinkOriginKey{}, *pending.CoreLink)
			break
		}
	}
	if id != "" {
		w.beginTurnFilesLocked(role)
		generation := 0
		if _, internal := conversationOrigin(dispatchContext); internal {
			if current, e := w.manager.Status(w.state.ID, id); e == nil {
				generation = current.Generation
			}
		}
		r, e := w.manager.sendGenerationScoped(dispatchContext, w.state.ID, id, request, message, attachmentMessageHash(message, attachments), generation, attachments)
		if e == nil {
			w.live[role] = WorkspaceLive{Phase: "waiting", Revision: w.live[role].Revision + 1}
		}
		return r, e
	}
	w.beginTurnFilesLocked(role)
	spec := AgentSpec{RequestID: request, ModelID: model, Task: message, Attachments: attachments, Prompt: w.prompt, Workdir: w.state.Workdir, Tools: w.permissions(role), Title: role, WorkspaceRole: role, TimeoutSeconds: 3600}
	record, err := w.manager.Create(dispatchContext, w.state.ID, spec)
	if err == nil {
		w.state.Roles[role] = record.ID
		err = w.saveLocked()
	}
	return record, err
}

func (w *Workspace) pump(ctx context.Context) {
	defer close(w.done)
	ticker := time.NewTicker(120 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		w.mu.Lock()
		if w.closed || w.updateFrozen {
			w.mu.Unlock()
			continue
		}
		if err := w.reconcileDeliveredLocked(); err != nil {
			w.feed.publish(WorkspaceMatrix, "error", map[string]string{"message": "任务最终状态同步失败"})
			w.mu.Unlock()
			continue
		}
		w.deliverTeamResultsLocked()
		w.deliverWorkboxResultsLocked()
		for i := range w.state.Messages {
			m := &w.state.Messages[i]
			if m.State != "queued" {
				continue
			}
			if ready, terminal := w.repairReadyLocked(*m); !ready {
				if terminal != "" {
					m.State = terminal
					_ = w.saveLocked()
				}
				continue
			}
			// Preserve suspended team queues for a later stage; never auto-dispatch them.
			if m.To != WorkspaceMatrix && !CurrentReleaseStage().TeamCollaboration {
				continue
			}
			if id := w.state.Roles[m.To]; id != "" {
				r, e := w.manager.Status(w.state.ID, id)
				if e == nil && activeAgent(r.State) {
					continue
				}
			}
			if w.archivedProgramResultReadLocked(*m) {
				m.State = "completed"
				if err := w.saveLocked(); err != nil {
					m.State = "queued"
				}
				continue
			}
			record, err := w.dispatchLocked(m.To, m.ID, m.Text, m.Attachments...)
			if errors.Is(err, errAgentFinishing) {
				continue
			}
			if record.ID != "" {
				// 已启动的工作即使保存回执失败，也不能重新派发。
				m.State, m.Generation, m.AgentID = "delivered", record.Generation, record.ID
			} else {
				m.State = "failed"
				if errors.Is(err, errCoreLinkStopped) {
					m.State = "cancelled"
				}
			}
			if err != nil {
				m.Error = "任务派发未完成：" + w.manager.redact(err.Error())
				if record.ID != "" {
					m.Error = "任务已启动，但派发回执未完整保存：" + w.manager.redact(err.Error())
				}
				w.feed.publish(m.To, "error", map[string]string{"message": m.Error, "request_id": m.ID})
			}
			if err = w.saveLocked(); err != nil {
				w.feed.publish(m.To, "error", map[string]string{"message": "消息状态保存失败"})
			}
			// Keep the original message ID with its delivery result after the
			// bounded chat snapshot retires it from the visible conversation.
			w.feed.publish(m.To, "message", *m)
		}
		w.retainChatLocked()
		w.mu.Unlock()
	}
}

// Steering is consumed only at safe request boundaries. Protocol/tool pairs
// remain intact. Message IDs in the archive make acknowledgement retry-safe.
func (w *Workspace) drain(role string, archive *SessionArchive, history []Message) ([]Message, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	deferMembers := role == WorkspaceMatrix && identityOpen(w.identity.snapshot())
	seen := map[string]bool{}
	for _, m := range history {
		seen[m.Name] = true
	}
	var added []Message
	var users []int
	requestImageBytes := 0
	changed := false
	generation := 0
	explicitMotherTurn := false
	deferRepairs := false
	if id := w.state.Roles[role]; id != "" {
		if record, err := w.manager.Status(w.state.ID, id); err == nil {
			generation = record.Generation
			deferRepairs = role == WorkspaceMatrix && record.RepairRun != nil
			if role == WorkspaceMatrix && w.coreLinkRegistered.Load() {
				explicitMotherTurn = w.explicitMotherTurnLocked(id, generation)
			}
		}
	}
	mark := func(indices []int, name string) {
		for _, i := range indices {
			m := &w.state.Messages[i]
			m.State, m.Generation, m.AgentID, m.DeliveryName = "delivered", generation, w.state.Roles[role], name
			if role == WorkspaceMatrix && m.From == "user" {
				w.manager.mu.Lock()
				if job := w.manager.jobs[w.state.Roles[role]]; job != nil && job.record.RepairRun != nil {
					job.record.RepairRun = nil
					_ = w.manager.saveLocked(job)
				}
				w.manager.mu.Unlock()
			}
		}
		changed = true
	}
	// Batch only user supplements. Other roles keep their distinct provenance.
	flush := func() error {
		if len(users) == 0 {
			return nil
		}
		name := "workspace_" + w.state.Messages[users[0]].ID
		if previous := w.state.Messages[users[0]].DeliveryName; previous != "" {
			name = previous
		}
		var parts []string
		var images []ImageAttachment
		for n, i := range users {
			m := w.state.Messages[i]
			if len(m.Attachments) > 0 {
				_, settings, err := w.modelSettingsLocked(role)
				if err != nil {
					return err
				}
				own, err := prepareComposerAttachments(w.config, m.Attachments, settings)
				if err != nil {
					return err
				}
				images = append(images, own...)
			}
			parts = append(parts, fmt.Sprintf("%d. %s", n+1, attachmentContent(m.Text, m.Attachments)))
		}
		next := Message{Role: RoleUser, Name: name, Images: images, Content: formatPromptText(runtimePrompt("Matrix/辅助指令/用户补充消息.txt"), len(users), strings.Join(parts, "\n"))}
		// Persist batch membership before appending to a durable archive. If
		// acknowledgement fails, every member can recognize the same receipt.
		previous := make([]string, len(users))
		for n, i := range users {
			previous[n] = w.state.Messages[i].DeliveryName
			w.state.Messages[i].DeliveryName = name
		}
		if err := w.saveLocked(); err != nil {
			for n, i := range users {
				w.state.Messages[i].DeliveryName = previous[n]
			}
			return err
		}
		if err := archive.Append("message", next); err != nil {
			return err
		}
		added = append(added, next)
		for _, i := range users {
			for _, a := range w.state.Messages[i].Attachments {
				if a.Kind == "image" {
					requestImageBytes += a.Bytes
				}
			}
		}
		mark(users, name)
		users = nil
		return nil
	}
	for i := range w.state.Messages {
		m := &w.state.Messages[i]
		recoverRepair := explicitMotherTurn && m.undeliveredInterruptedRepair()
		if m.To != role || (m.State != "queued" && m.State != "context" && !recoverRepair) {
			continue
		}
		// A specialist handoff keeps other members' requests in the durable
		// inbox until the same actor returns to its mother role. User steering
		// still reaches the active task at this boundary.
		if deferMembers && m.From != "user" {
			continue
		}
		// Each automatic repair owns its own delivery state and request budget.
		if deferRepairs && m.Repair != nil {
			continue
		}
		if recoverRepair && m.CoreLink != nil && m.CoreLink.Scope != w.coreLinkScopeLocked() {
			continue
		}
		name := "workspace_" + m.ID
		// A direct repair dispatch uses a Core Link name even without a
		// mailbox origin. A drained notice may have reached the archive
		// before its workspace acknowledgement was saved.
		if recoverRepair && (seen[name] || seen["core-link-"+workflowHash(m.ID)] || m.DeliveryName != "" && seen[m.DeliveryName]) {
			continue
		}
		if ready, terminal := w.repairReadyLocked(*m); !ready {
			if terminal != "" && terminal != m.State {
				m.State, changed = terminal, true
			}
			continue
		}
		if m.CoreLink != nil {
			if err := w.checkCoreLinkMessageLocked(*m); err != nil {
				if errors.Is(err, errCoreLinkStopped) {
					m.State, changed = "cancelled", true
					continue
				}
				return added, err
			}
			if programResultRead(history, *m) {
				m.State, changed = "completed", true
				continue
			}
			name = "core-link-" + workflowHash(m.ID)
			if err := w.rememberCoreLinkLocked(*m, generation); err != nil {
				return added, err
			}
		}
		if m.DeliveryName != "" {
			name = m.DeliveryName
		}
		if seen[name] {
			mark([]int{i}, name)
			continue
		}
		if m.From == "user" {
			if len(users) > 0 && m.DeliveryName != w.state.Messages[users[0]].DeliveryName {
				if err := flush(); err != nil {
					return added, err
				}
			}
			// Keep excess image supplements queued for the following boundary;
			// never silently replace a newly accepted image with a text fallback.
			imageBytes := requestImageBytes
			for _, i := range users {
				for _, a := range w.state.Messages[i].Attachments {
					if a.Kind == "image" {
						imageBytes += a.Bytes
					}
				}
			}
			for _, a := range m.Attachments {
				if a.Kind == "image" {
					imageBytes += a.Bytes
				}
			}
			if imageBytes > imageRequestByteLimit {
				break
			}
			users = append(users, i)
			continue
		}
		if err := flush(); err != nil {
			return added, err
		}
		imageBytes := requestImageBytes
		for _, a := range m.Attachments {
			if a.Kind == "image" {
				imageBytes += a.Bytes
			}
		}
		if imageBytes > imageRequestByteLimit {
			break
		}
		if !seen[name] {
			var images []ImageAttachment
			if len(m.Attachments) > 0 {
				model, e := w.modelLocked(role)
				if e != nil {
					return added, e
				}
				settings, e := w.manager.settings(model)
				if e != nil {
					return added, e
				}
				images, e = prepareComposerAttachments(w.config, m.Attachments, settings)
				if e != nil {
					return added, e
				}
			}
			next := Message{Role: RoleUser, Name: name, Images: images, Content: "[" + m.From + runtimePrompt("Matrix/辅助指令/任务中补充.txt") + attachmentContent(m.Text, m.Attachments)}
			if err := archive.Append("message", next); err != nil {
				return added, err
			}
			added = append(added, next)
			requestImageBytes = imageBytes
		}
		mark([]int{i}, name)
	}
	if err := flush(); err != nil {
		return added, err
	}
	if changed {
		if err := w.saveLocked(); err != nil {
			return added, err
		}
	}
	w.retainChatLocked()
	return added, nil
}

// Withdrawal races the same lock as dispatch/drain. A delivered message cannot
// be retracted, and a repeated withdrawal never revives an accepted request.
func (w *Workspace) withdraw(id string) (any, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed || w.updateFrozen {
		return nil, fmt.Errorf("工作区正在交接，请稍后重试")
	}
	for i := range w.state.Messages {
		m := &w.state.Messages[i]
		if m.ID != id || !workspaceChatInput(*m) {
			continue
		}
		if m.State == "withdrawn" {
			return map[string]any{"ok": true, "id": id}, nil
		}
		if (m.State != "queued" && m.State != "context") || m.DeliveryName != "" {
			return nil, fmt.Errorf("消息已经送达，无法撤回")
		}
		previous := m.State
		m.State = "withdrawn"
		if err := w.saveLocked(); err != nil {
			m.State = previous
			return nil, err
		}
		w.feed.publish(WorkspaceMatrix, "message_withdrawn", map[string]string{"id": id})
		return map[string]any{"ok": true, "id": id}, nil
	}
	return nil, fmt.Errorf("没有找到尚未送达的消息")
}

func (w *Workspace) recordOutput(role, text, state string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	generation := 0
	if id := w.state.Roles[role]; id != "" {
		if record, err := w.manager.Status(w.state.ID, id); err == nil {
			generation = record.Generation
		}
	}
	_ = w.recordOutputLocked(role, text, state, generation)
}

// Waiting for a human ends the run goroutine. Later cancellation or expiry has
// no run callback, so reconcile only a finished generation before dispatching
// another turn. The manager remains the sole owner of the execution state.
func (w *Workspace) reconcileDeliveredLocked() error {
	checked := map[string]bool{}
	for _, message := range w.state.Messages {
		role := message.To
		if message.State != "delivered" || checked[role] {
			continue
		}
		checked[role] = true
		w.manager.mu.Lock()
		job := w.manager.jobs[w.state.Roles[role]]
		var record AgentRecord
		if job != nil {
			if err := w.manager.expireHumanLocked(job); err != nil {
				w.manager.mu.Unlock()
				return err
			}
			select {
			case <-job.done:
				record = copyRecord(job.record)
			default:
			}
		}
		w.manager.mu.Unlock()
		switch record.State {
		case "completed", "failed", "cancelled", "timed_out", "persistence_failed":
		default:
			continue
		}
		pending := false
		for _, candidate := range w.state.Messages {
			pending = pending || candidate.To == role && candidate.State == "delivered" && candidate.Generation == record.Generation
		}
		if !pending {
			continue
		}
		text := record.Result
		if record.Error != "" {
			text = record.Error
		}
		if err := w.recordOutputLocked(role, text, record.State, record.Generation); err != nil {
			return err
		}
	}
	return nil
}

func (w *Workspace) recordOutputLocked(role, text, state string, generation int) error {
	if v := w.live[role]; state != "commentary" && v.Generation == generation && v.ReasoningStartedAt != 0 {
		finishWorkspaceReasoning(&v, time.Now().UnixMilli())
		v.Revision++
		w.live[role] = v
	}
	text = w.manager.redact(text)
	if state == "cancelled" {
		text = "已停止。已经执行的操作不会自动撤销。"
	}
	changed := false
	turnID := ""
	retryReply := -1
	if state != "commentary" {
		if record, err := w.manager.Status(w.state.ID, w.state.Roles[role]); err == nil && record.Generation == generation && record.ChatRetryAttempt > 0 {
			for i := range w.state.Messages {
				message := &w.state.Messages[i]
				if message.From == role && message.AgentID == record.ID && message.Generation == generation && (message.State == "failed" || message.State == "timed_out") {
					retryReply = i
				}
			}
		}
	}
	for _, message := range w.state.Messages {
		if workspaceChatInput(message) && message.Generation == generation && (message.AgentID == "" || message.AgentID == w.state.Roles[role]) && message.State != "queued" && message.State != "context" && message.State != "withdrawn" {
			turnID = message.ID
		}
	}
	if state != "commentary" {
		for i := range w.state.Messages {
			message := &w.state.Messages[i]
			if message.To == role && message.State == "delivered" && message.Generation == generation && (message.AgentID == "" || message.AgentID == w.state.Roles[role]) {
				message.State = state
				changed = true
			}
		}
	}
	if strings.TrimSpace(text) != "" {
		documentID := ""
		if role == WorkspaceMatrix && (len([]rune(text)) > 320 || strings.Count(text, "\n") >= 6 || state == "failed" || state == "timed_out" || state == "persistence_failed") {
			// 长回复的完整副本只供 CLI / Link 读取全文，不是报告：报告圆里只有 Eyra 用 report 发布的文档。
			doc, err := w.publishMessageLocked(workspaceID(), "record", "这次的记录", "md", text)
			if err != nil {
				// 保存失败不能丢掉唯一可见的回复，也不能承诺 OS 有会话档案。
				w.feed.publish(role, "error", map[string]string{"message": "报告未能保存，完整回复保留在当前窗口；关闭前请另行保存重要内容。"})
			} else {
				documentID = doc.ID
				// The report is an additional durable copy. Replacing the live
				// text here truncates both intermediate bodies and final replies.
			}
		}
		m := workspaceMessage{ID: workspaceID(), From: role, To: "user", Text: text, State: state, At: time.Now().UTC().Format(time.RFC3339Nano), Generation: generation, AgentID: w.state.Roles[role]}
		if role != WorkspaceMatrix {
			m.To = WorkspaceMatrix
			turnID = ""
		}
		m.TurnID = turnID
		if state != "commentary" {
			if record, err := w.manager.Status(w.state.ID, w.state.Roles[role]); err == nil && record.Generation == generation {
				m.RunTime = cloneRunTime(record.RunTime)
				if record.CompletedAt != "" {
					m.At = record.CompletedAt
				}
			}
		}
		m.DocumentID = documentID
		if role == WorkspaceMatrix && state != "commentary" && w.turnFiles != nil {
			m.Artifacts = diffArtifacts(w.turnFiles, scanWorkdir(w.state.Workdir, artifactStatePaths(w.config)))
			w.turnFiles = nil
			if len(m.Artifacts) > 0 && w.Mode().unified() {
				// 统一宿主的聊天不落盘；交付文件随记忆原文保存，重开后的历史仍有文件卡片。
				w.transcribeAt(w.state.ID, w.state.Workdir, []transcriptRow{artifactNoteRow(w.state.ID, w.artifactNotes, m)})
				w.artifactNotes++
			}
		}
		if bodyID := w.live[role].BodyID; bodyID != "" {
			m.ID = bodyID
		}
		if retryReply >= 0 {
			m.ID = w.state.Messages[retryReply].ID
			w.state.Messages[retryReply] = m
		} else {
			w.state.Messages = append(w.state.Messages, m)
		}
		changed = true
		w.feed.publish(role, "message", m)
	}
	if changed {
		w.retainChatLocked()
		if err := w.saveLocked(); err != nil {
			w.feed.publish(role, "error", map[string]string{"message": "输出未能保存"})
			return err
		}
	}
	return nil
}

func (w *Workspace) Cancel() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	err := w.cancelLocked()
	if err == nil {
		w.feed.publish(WorkspaceMatrix, "cancel_requested", map[string]bool{"requested": true})
	}
	return err
}

func (w *Workspace) cancelLocked() error {
	if w.split != nil {
		w.split.mu.Lock()
		if !w.split.Started {
			w.split.Cancelled = true
		}
		if w.split.CancelJoin != nil {
			w.split.CancelJoin()
		}
		w.split.mu.Unlock()
	}
	if w.greetingCancel != nil {
		w.greetingCancel()
	}
	// The same stop also covers source receipts that have not reached the inbox.
	var repairSession *eyraContextSession
	if w.coreLinkRegistered.Load() {
		repairSession = w.contextSessionLocked()
		if repairSession != nil {
			repairSession.RepairEpoch++
		}
	}
	for i := range w.state.Messages {
		m := &w.state.Messages[i]
		if m.State == "queued" || m.State == "context" || m.undeliveredInterruptedRepair() {
			m.State = "cancelled"
		}
	}
	w.retainChatLocked()
	var failures []error
	if err := w.saveLocked(); err != nil {
		if repairSession != nil {
			repairSession.RepairEpoch--
		}
		failures = append(failures, fmt.Errorf("停止请求状态保存失败: %w", err))
	}
	for _, id := range w.state.Roles {
		if err := w.manager.Cancel(w.state.ID, id); err != nil {
			failures = append(failures, fmt.Errorf("停止任务 %s 失败: %w", id, err))
		}
	}
	return errors.Join(failures...)
}

// 只在没有进行中的一轮时记清单：一轮里插话（同一轮继续）不能把开工前的基准换掉。
func (w *Workspace) beginTurnFilesLocked(role string) {
	if role == WorkspaceMatrix && w.turnFiles == nil && w.state.Workdir != "" {
		w.turnFiles = scanWorkdir(w.state.Workdir, artifactStatePaths(w.config))
	}
}
