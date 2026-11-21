// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: MatrixAgentManual; AgentContext; AgentRecord; agentJob; AgentManager; NewAgentManager; newAgentManager; activeAgent; Close; saveLocked; validateAgentSessionRecord; copyRecord; ownsLocked; List; Status; agentSummary; knownAgentCapability; settings; specSettings; settingsWith; Create; launchLocked; finish; redact; redactionSecrets; Redact; agentRequestKey; errAgentFinishing; WithAgentRequest; CancelRequest; Send; SendGeneration; sendGeneration; sendGenerationAttachments; sendGenerationScoped; Cancel; CancelGeneration; Review; Wait; agentManagerKey; agentManagerContext; WithAgentManager; Call
// Impact: python -B scripts/code-atlas.py show Core/matrix_agents.go
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
	"github.com/aieyra/aieyra-os/CORE/sessionservice"
	agentcontract "github.com/aieyra/aieyra-os/agent/contract"
	contextport "github.com/aieyra/aieyra-os/contracts/context"
	"github.com/aieyra/aieyra-os/contracts/storage"
	toolcontract "github.com/aieyra/aieyra-os/tool/contract"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

func MatrixAgentManual() string { return runtimePrompt("Matrix/工具说明/专项助手.txt") }

type AgentContext struct {
	Provider       *contextport.Reference `json:"provider,omitempty"`
	Tokens         int                    `json:"tokens"`
	Window         int                    `json:"window"`
	ModelWindow    int                    `json:"model_window,omitempty"`
	Target         int                    `json:"target,omitempty"`
	Threshold      int                    `json:"threshold,omitempty"`
	InputLimit     int                    `json:"input_limit,omitempty"`
	CapacitySource string                 `json:"capacity_source,omitempty"`
}

type AgentRecord struct {
	ChatRetryAttempt     int                                `json:"chat_retry_attempt,omitempty"`
	Greeting             *conversationGreeting              `json:"greeting,omitempty"`
	ConversationModel    string                             `json:"conversation_model,omitempty"`
	RepairRun            *motherRepairRun                   `json:"repair_run,omitempty"`
	MotherRepairNotice   *motherRepairNotice                `json:"mother_repair_notice,omitempty"`
	Compactions          map[string]*conversationCompaction `json:"compactions,omitempty"`
	CompactionRun        string                             `json:"compaction_run,omitempty"`
	MotherTakeover       *motherTakeover                    `json:"mother_takeover,omitempty"`
	Link                 *conversationLinkBinding           `json:"link,omitempty"`
	LinkCancelled        bool                               `json:"link_cancelled,omitempty"`
	LinkStoppedThrough   int                                `json:"link_stopped_through,omitempty"`
	LinkReceiptCursor    int64                              `json:"link_receipt_cursor,omitempty"`
	LinkSession          string                             `json:"link_session,omitempty"`
	TurnOrigins          map[string]conversationLinkOrigin  `json:"turn_origins,omitempty"`
	PendingMessages      []workspaceMessage                 `json:"pending_messages,omitempty"`
	Instance             *agentcontract.Instance            `json:"instance,omitempty"`
	WorkflowNotified     int                                `json:"workflow_notified,omitempty"`
	WorkflowNotice       *workboxNotice                     `json:"workflow_notice,omitempty"`
	DeletionPending      bool                               `json:"deletion_pending,omitempty"`
	CreationSpecHash     string                             `json:"creation_spec_hash,omitempty"`
	ConversationRevision int                                `json:"conversation_revision,omitempty"`
	TurnAttachments      map[string][]ComposerAttachment    `json:"turn_attachments,omitempty"`
	SubmittedAt          string                             `json:"submitted_at,omitempty"`
	CompletedAt          string                             `json:"completed_at,omitempty"`
	RunTime              *AgentRunTime                      `json:"run_time,omitempty"`
	TurnGenerations      map[string]int                     `json:"turn_generations,omitempty"`
	TurnHashes           map[string]string                  `json:"turn_hashes,omitempty"`
	WorkerPID            int                                `json:"worker_pid,omitempty"`
	LastWorkerPID        int                                `json:"last_worker_pid,omitempty"`
	Context              *AgentContext                      `json:"context,omitempty"`
	Compression          *ContextCompression                `json:"compression,omitempty"`
	TurnRequestBase      int                                `json:"turn_request_base,omitempty"`
	TurnTokenBase        int                                `json:"turn_token_base,omitempty"`
	WindowError          string                             `json:"window_error,omitempty"`
	OriginRequest        string                             `json:"origin_request,omitempty"`
	Requests             int                                `json:"requests"`
	AccountedTokens      int                                `json:"accounted_tokens"`
	ID                   string                             `json:"id"`
	Parent               string                             `json:"parent"`
	Depth                int                                `json:"depth"`
	Spec                 AgentSpec                          `json:"spec"`
	State                string                             `json:"state"`
	Created              string                             `json:"created"`
	Updated              string                             `json:"updated"`
	Result               string                             `json:"result,omitempty"`
	Error                string                             `json:"error,omitempty"`
	Failure              *AgentFailure                      `json:"failure,omitempty"`
	Acceptance           string                             `json:"acceptance"`
	Evidence             string                             `json:"evidence,omitempty"`
	Usage                []AgentUsage                       `json:"usage"`
	Turns                map[string]string                  `json:"turns"`
	Generation           int                                `json:"generation"`
	ToolTurns            int                                `json:"tool_turns"`
	Delivery             *AgentDelivery                     `json:"delivery,omitempty"`
	Reviews              []AgentReview                      `json:"reviews,omitempty"`
	History              []AgentOutcome                     `json:"history,omitempty"`
	HumanRequests        []HumanRequest                     `json:"human_requests,omitempty"`
}

type agentJob struct {
	greetingCancel       context.CancelFunc
	finishing            bool // Guarded by m.mu; no new package messages after the final boundary.
	conversationTurn     *AgentSpec
	conversationSettings *Settings // Immutable admitted request configuration; never persisted with credentials.
	plan                 *PlanState
	planGeneration       int
	archive              *SessionArchive // OS 主对话只在当前进程内保留。
	requestModel         string          // 实际请求型号，不随配置热更新提前变化。
	record               AgentRecord
	cancel               context.CancelFunc
	done                 chan struct{}
	shell                *ShellManager
	activity             *agentActivityCache
	receiptHistory       *workspaceHistory // Read-only offsets for this session; no executor or payload copy.
	historyView          *Workspace        // Uses the common paged history reader without a pump or runtime.
	started              sync.Map
	runStarted           atomic.Int64
	runCheckpointStart   int64
}

type AgentManager struct {
	updateFrozen         bool // guarded by mu; admission stops during signed-update handoff
	conversationProjects map[string]*Workspace
	linkContacts         func() (*AgentManager, error) // canonical contact metadata; never a shared execution context
	linkHome             *WorkspaceHost
	linkDeliveries       sync.Map
	linkRootService      atomic.Pointer[AgentManager]
	linkOperation        sync.Mutex        // primary mailbox calls and cancellation share one admission fence
	workflowRuns         sync.Map          // workflow directory -> owned runner cancellation
	workflowAdmissions   map[string]uint64 // actor stop generations, guarded by mu; allocated only by run/resume
	workflowStop         uint64            // service-wide stop generation, guarded by mu
	workboxHost          atomic.Pointer[AgentManager]
	workboxInitMu        sync.Mutex
	workboxService       bool
	packageService       bool
	packageProgram       func(context.Context, json.RawMessage) (json.RawMessage, error)
	packageWorkbox       func() (*AgentManager, error)
	workboxAgents        func() (*AgentManager, error)
	packageHost          atomic.Pointer[AgentManager]
	packageInitMu        sync.Mutex

	sessionDeleteMu    sync.Mutex
	taskProjection     *Workspace // Package task display only; never supplies prompts or memory.
	streamProjection   *Workspace // Conversation display only; owns no execution or shared context.
	workspace          *Workspace
	mu                 sync.Mutex
	config, dir, owner string
	jobs               map[string]*agentJob
	slots              chan struct{}
	ctx                context.Context
	cancel             context.CancelFunc
	wg                 sync.WaitGroup
	unlock             func()
	service            *SettingsService
	window             func(...string) error
	windowHide         func() error
	taskWindow         func(string, string) error
	taskWindowHide     func(string) error
	closeOnce          sync.Once
	attachmentUnlock   func()
}

func NewAgentManager(config, owner string, service *SettingsService) (*AgentManager, error) {
	if err := ValidatePrivateProfile(config); err != nil {
		return nil, err
	}
	return newAgentManager(config, owner, service, managerDirectory(config, owner, HostLegacy))
}

func newAgentManager(config, owner string, service *SettingsService, dir string) (*AgentManager, error) {
	if err := ValidatePrivateProfile(config); err != nil {
		return nil, err
	}
	if config == "" || !sessionIDPattern.MatchString(owner) {
		return nil, fmt.Errorf("invalid Matrix session")
	}
	attachmentUnlock, err := attachmentLease(config)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		attachmentUnlock()
		return nil, err
	}
	unlock, err := lockSession(filepath.Join(dir, "manager.lock"))
	if err != nil {
		attachmentUnlock()
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	m := &AgentManager{config: config, dir: dir, owner: owner, jobs: map[string]*agentJob{}, slots: make(chan struct{}, 4), ctx: ctx, cancel: cancel, unlock: unlock, attachmentUnlock: attachmentUnlock, service: service}
	records, err := sessionservice.LoadRecordDirectory(dir, sessionservice.MaxRecordBytes, func(name string) bool {
		return strings.HasSuffix(name, ".json") && sessionIDPattern.MatchString(strings.TrimSuffix(name, ".json"))
	}, func(name string, r AgentRecord) error {
		return validateAgentSessionRecord(strings.TrimSuffix(name, ".json"), r)
	})
	if err != nil {
		m.Close()
		return nil, err
	}
	parents := make(map[string]AgentRecord, len(records))
	for _, r := range records {
		parents[r.ID] = r
	}
	for _, r := range records {
		p, found := parents[r.Parent]
		if r.Depth == 1 && r.Parent != owner || r.Depth == 2 && (!found || p.Depth != 1) {
			m.Close()
			return nil, fmt.Errorf("saved agent parent tree is invalid; original records retained")
		}
	}
	// Validate the entire directory before interrupted-task recovery or Close
	// can checkpoint any waiting task. A damaged sibling must not alter peers.
	for _, r := range records {
		j := &agentJob{record: r, done: make(chan struct{})}
		if r.CompactionRun == "" {
			recoverRunTime(j, time.Now().UnixMilli())
		}
		if j.record.Turns == nil {
			j.record.Turns = map[string]string{}
		}
		close(j.done)
		m.jobs[r.ID] = j
		if _, err = m.recoverConversationCompaction(j); err != nil {
			m.Close()
			return nil, err
		}
		if activeAgent(j.record.State) && j.record.State != "waiting_user" {
			j.record.State = "interrupted"
			j.record.CompletedAt = time.Now().UTC().Format(time.RFC3339Nano)
			m.finishHumansLocked(j, "interrupted")
			j.record.Error = "Process ended before final receipt; inspect artifacts before explicitly sending another turn."
			if err = m.saveLocked(j); err != nil {
				m.Close()
				return nil, err
			}
		}
	}
	return m, nil
}

func activeAgent(state string) bool {
	return state == "queued" || state == "running" || state == "cancelling" || state == "waiting_user"
}
func (m *AgentManager) Close() {
	if m == nil {
		return
	}
	m.closeOnce.Do(func() {
		m.mu.Lock()
		m.cancel()
		m.mu.Unlock()
		m.workboxInitMu.Lock()
		service := m.workboxHost.Load()
		m.workboxInitMu.Unlock()
		if service != nil {
			service.Close()
		}
		m.packageInitMu.Lock()
		packageService := m.packageHost.Load()
		m.packageInitMu.Unlock()
		if packageService != nil {
			packageService.Close()
		}
		m.wg.Wait()
		m.mu.Lock()
		var shells []*ShellManager
		for _, j := range m.jobs {
			if j.shell != nil {
				shells = append(shells, j.shell)
			}
			if j.record.State == "waiting_user" {
				checkpointRunTime(j, time.Now().UnixMilli(), true)
				_ = m.saveLocked(j)
			}
		}
		m.mu.Unlock()
		for _, shell := range shells {
			shell.Close()
		}
		if m.unlock != nil {
			m.unlock()
			m.unlock = nil
		}
		if m.attachmentUnlock != nil {
			m.attachmentUnlock()
			m.attachmentUnlock = nil
		}
	})
}
func (m *AgentManager) saveLocked(j *agentJob) error {
	now := time.Now().UTC()
	terminal := !activeAgent(j.record.State)
	end := now
	if completed, err := time.Parse(time.RFC3339Nano, j.record.CompletedAt); terminal && err == nil {
		end = completed
	}
	checkpointRunTime(j, end.UnixMilli(), terminal)
	j.record.Updated = now.Format(time.RFC3339Nano)
	r := j.record
	if m.workspace != nil && m.workspace.Mode().unified() && r.Spec.WorkspaceRole != "" {
		// 调度父节点仍可追溯，但不能把主窗口聊天伪装成任务档案。
		r = AgentRecord{ID: r.ID, Parent: r.Parent, Depth: r.Depth, Spec: AgentSpec{WorkspaceRole: r.Spec.WorkspaceRole, ModelID: r.Spec.ModelID, Title: r.Spec.Title}, State: r.State, Created: r.Created, Updated: r.Updated, Generation: r.Generation, Usage: imageUsageRows(r.Usage)}
	}
	return sessionservice.WriteRecord(sessionservice.RecordFile{Directory: m.dir, Name: r.ID + ".json", MaxBytes: sessionservice.MaxRecordBytes}, r, func(r AgentRecord) error {
		return validateAgentSessionRecord(j.record.ID, r)
	})
}

func validateAgentSessionRecord(id string, r AgentRecord) error {
	if !sessionIDPattern.MatchString(id) || r.ID != id || r.Depth < 1 || r.Depth > 2 || !sessionIDPattern.MatchString(r.Parent) || r.Parent == r.ID {
		return fmt.Errorf("invalid saved agent record; original retained")
	}
	if e := r.RepairRun; e != nil && (r.Spec.WorkspaceRole != WorkspaceMatrix || e.Request == "" || len(e.Request) > 128 || e.RequestBase < 0 || e.RequestBase > r.Requests || e.TokenBase < 0 || e.TokenBase > r.AccountedTokens) {
		return fmt.Errorf("母体修理预算记录无效")
	}
	if e := r.MotherRepairNotice; e != nil && (!sessionIDPattern.MatchString(e.Scope) ||
		e.Generation < 1 || e.Generation > r.Generation || e.Attempt < 0 ||
		e.Generation == r.Generation && e.Attempt > r.ChatRetryAttempt ||
		r.Spec.Kind != "conversation") {
		return fmt.Errorf("母体修理待投递回执无效")
	}
	if err := validateConversationLinkRecord(r); err != nil {
		return err
	}
	if err := validateConversationCompactions(r); err != nil {
		return err
	}
	if h := r.MotherTakeover; h != nil && (h.RepairEvent == "" && (r.Link == nil || h.Scope != r.Link.Scope) || len(h.RepairEvent) > 128 || !sessionIDPattern.MatchString(h.Scope) || h.Generation != r.Generation || h.Handoff == "" || len(h.Handoff) > 96 || !sessionIDPattern.MatchString(h.Mother)) {
		return fmt.Errorf("母体接管与原成员代次不匹配")
	}
	return validatePackageInstance(r)
}

func copyRecord(r AgentRecord) AgentRecord {
	b, _ := json.Marshal(r)
	var result AgentRecord
	_ = json.Unmarshal(b, &result)
	return result
}

// Scheduling ancestry and explicit package supervision are separate authorities.
// A package install or its display name never creates either relationship.
func (m *AgentManager) ownsLocked(owner, id string) bool {
	seen := map[string]bool{}
	for id != "" && !seen[id] && len(seen) < 128 {
		seen[id] = true
		j := m.jobs[id]
		if j == nil {
			return false
		}
		if j.record.Parent == owner {
			return true
		}
		if i := j.record.Instance; i != nil && owner != m.owner {
			if i.Supervisor == owner {
				return true
			}
			id = i.Supervisor
		} else {
			id = j.record.Parent
		}
	}
	return false
}
func (m *AgentManager) List(owner string) []AgentRecord {
	var workflows []AgentRecord
	if m.primaryWorkflowActor(owner) {
		if service, err := m.ensureWorkboxHost(false); err == nil && service != nil {
			workflows = service.List(service.owner)
		}
		if service, err := m.ensurePackageAgentHost(false); err == nil && service != nil {
			actor := service.owner
			if owner != m.owner {
				actor = "primary"
			}
			workflows = append(workflows, service.List(actor)...)
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	r := append([]AgentRecord{}, workflows...)
	for id, j := range m.jobs {
		if m.ownsLocked(owner, id) {
			r = append(r, copyRecord(j.record))
		}
	}
	sort.Slice(r, func(i, j int) bool { return r[i].Created < r[j].Created })
	return r
}
func (m *AgentManager) Status(owner, id string) (AgentRecord, error) {
	if next, actor := m.taskManager(owner, id); next != m {
		return next.Status(actor, id)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.ownsLocked(owner, id) {
		return AgentRecord{}, fmt.Errorf("agent not owned by caller")
	}
	return copyRecord(m.jobs[id].record), nil
}

// 列表只交付调度摘要；任务提示、续轮和执行正文按需读取。
func agentSummary(r AgentRecord) map[string]any {
	return map[string]any{"id": r.ID, "parent": r.Parent, "depth": r.Depth, "title": r.Spec.Title,
		"kind": r.Spec.Kind, "generation": r.Generation, "revision": r.ConversationRevision,
		"model_id": r.Spec.ModelID, "state": r.State, "acceptance": r.Acceptance,
		"requests": r.Requests, "tool_turns": r.ToolTurns, "created": r.Created, "updated": r.Updated}
}
func knownAgentCapability(name string) bool {
	if isWorkspaceTool(name) {
		return true
	}
	switch name {
	case "toolbox", "community", "video_gen", "link", "server", "terminal", "exec_command", "write_stdin", "read_shell_output", "apply_patch", "exec", "wait", "update_plan", "view_image", "web_search", "settings", "compact", "browser", "computer", "agents", "core_link", "tool_factory", "human", "image_gen", "software_api", "cloud_report", "group":
		return true
	}
	return toolcontract.VersionedID(name)
}
func (m *AgentManager) settings(id string) (*Settings, error) { return m.settingsWith(id, nil) }

// The settings an agent actually runs with: its model, plus its own thinking choice.
func (m *AgentManager) specSettings(spec AgentSpec) (*Settings, error) {
	return m.settingsWith(spec.ModelID, spec.ModelParameters)
}

func (m *AgentManager) settingsWith(id string, patch json.RawMessage) (*Settings, error) {
	s, err := Load(m.config)
	if err != nil {
		return nil, err
	}
	if s.ModelPoolVersion != 1 {
		return nil, fmt.Errorf("a configured model pool is required")
	}
	s.ActiveProfile = id
	if len(patch) > 0 {
		for i := range s.APIProfiles {
			if s.APIProfiles[i].ID == id {
				if s.APIProfiles[i].Parameters, err = mergeModelParameters(s.APIProfiles[i].Parameters, patch); err != nil {
					return nil, err
				}
			}
		}
	}
	s.applyPoolProfile()
	if err = s.ValidatePoolRequest(); err != nil {
		return nil, err
	}
	if s.APIKey == "" {
		return nil, fmt.Errorf("selected model has no credential")
	}
	return s, nil
}
func (m *AgentManager) Create(ctx context.Context, owner string, spec AgentSpec) (AgentRecord, error) {
	instance, instanceErr := packageAgentCreation(ctx, spec)
	if instanceErr != nil {
		return AgentRecord{}, instanceErr
	}
	if spec.WorkflowID != "" || spec.WorkflowPackage != "" || spec.WorkflowRetention != "" {
		trusted, _ := ctx.Value(workflowAgentKey{}).(string)
		if trusted == "" || trusted != spec.WorkflowID || !validWorkflowID(spec.WorkflowID) || !toolcontract.ValidPackageID(spec.WorkflowPackage) || (spec.WorkflowRetention != "task" && spec.WorkflowRetention != "retained") {
			return AgentRecord{}, fmt.Errorf("workflow specialist requires trusted creation")
		}
	}

	if spec.ContextProvider != nil {
		if _, err := resolveContextProvider(*spec.ContextProvider, m.config); err != nil {
			return AgentRecord{}, err
		}
	}
	conversation := spec.Kind == "conversation"
	if spec.Kind != "" && !conversation {
		return AgentRecord{}, fmt.Errorf("unknown agent kind")
	}
	if conversation {
		_, invited := ctx.Value(conversationLinkCreateKey{}).(conversationLinkBinding)
		if (m.streamProjection == nil && !(invited && m.linkContacts != nil)) || owner != m.owner || spec.WorkspaceRole != "" || spec.Contract != nil || len(spec.Attachments) > 0 {
			return AgentRecord{}, fmt.Errorf("conversation creation requires the conversation host")
		}
		var tools []string
		var err error
		c, readErr := m.readContact(spec.ProfileID)
		if readErr == nil && c.Program != "" {
			trusted, _ := ctx.Value(programAgentCreateKey{}).(string)
			if trusted != c.Program || spec.GroupID != "" || invited || c.ID != programContactID(c.Program) {
				return AgentRecord{}, fmt.Errorf("程序智能体只接受所属程序的固定会话")
			}
			tools, err = programToolList(spec.Tools)
		} else {
			tools, err = conversationToolList(spec.Tools, spec.GroupID != "")
		}
		if err != nil {
			return AgentRecord{}, err
		}
		spec.Tools = tools
	}
	if spec.WorkspaceRole != "" {
		trusted, _ := ctx.Value(workspaceTrustedKey{}).(bool)
		if !trusted || m.workspace == nil || owner != m.owner || !validWorkspaceRole(spec.WorkspaceRole) {
			return AgentRecord{}, fmt.Errorf("workspace roles require trusted supervision")
		}
		if m.workspace.Mode() == HostOS && spec.WorkspaceRole == WorkspaceExecution && !CurrentReleaseStage().TeamCollaboration {
			return AgentRecord{}, fmt.Errorf("团队协同已关闭；请由 Eyra 直接执行")
		}
	}
	if err := ctx.Err(); err != nil {
		return AgentRecord{}, err
	}
	spec.Tools = append([]string(nil), spec.Tools...)
	contract, contractErr := agentcontract.CloneContract(spec.Contract)
	if contractErr != nil {
		return AgentRecord{}, contractErr
	}
	spec.Contract = contract
	if spec.RequestID == "" || len(spec.RequestID) > 128 || (!conversation && instance == nil && strings.TrimSpace(spec.Task) == "" && len(spec.Attachments) == 0) || len(spec.Task) > 64<<10 || len(spec.Prompt) > 32<<10 || len(spec.Title) > 256 {
		return AgentRecord{}, fmt.Errorf("invalid task, prompt or request_id")
	}
	if !conversation {
		spec.ModelParameters = nil
	} else if p, err := cleanModelParameters(spec.ModelParameters); err != nil {
		return AgentRecord{}, err
	} else {
		spec.ModelParameters = p
	}
	// An idle conversation may follow Eyra before a model is configured. The
	// actual turn resolves and validates that binding before any execution.
	if !conversation || spec.ModelID != "" {
		if _, err := m.specSettings(spec); err != nil {
			return AgentRecord{}, err
		}
	}
	spec.Attachments = append([]ComposerAttachment(nil), spec.Attachments...)
	if !filepath.IsAbs(spec.Workdir) {
		return AgentRecord{}, fmt.Errorf("workdir must be absolute")
	}
	info, err := os.Stat(storage.Relocate(m.config, spec.Workdir))
	if err != nil || !info.IsDir() {
		return AgentRecord{}, fmt.Errorf("workdir must be an existing directory")
	}
	// Old callers may still send max_requests. Ignore it, including on retries.
	spec.MaxRequests = 0
	if spec.TimeoutSeconds == 0 {
		spec.TimeoutSeconds = 600
	}
	if spec.MaxTokens == 0 && spec.WorkspaceRole == "" {
		spec.MaxTokens = 1000000
	}
	if spec.TimeoutSeconds < 10 || spec.TimeoutSeconds > 3600 || spec.MaxTokens < 0 || spec.MaxTokens == 0 && spec.WorkspaceRole == "" || spec.MaxTokens > 10000000 {
		return AgentRecord{}, fmt.Errorf("invalid time/token budget")
	}
	seen := map[string]bool{}
	for _, n := range spec.Tools {
		if !knownAgentCapability(n) || !toolAllowed(ctx, n) || seen[n] {
			return AgentRecord{}, fmt.Errorf("invalid or unassigned capability: %s", n)
		}
		seen[n] = true
	}
	for _, name := range spec.Tools {
		if toolcontract.VersionedID(name) {
			v, e := m.versionedTool(ctx, name)
			if e != nil {
				return AgentRecord{}, e
			}
			for _, cap := range v.Capabilities {
				if !seen[cap] {
					return AgentRecord{}, fmt.Errorf("custom tool requires assigned capability %s", cap)
				}
			}
		}
	}
	sort.Strings(spec.Tools)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.ctx.Err() != nil || m.updateFrozen {
		return AgentRecord{}, fmt.Errorf("manager closed")
	}
	depth := 1
	if owner != m.owner {
		p := m.jobs[owner]
		if p == nil || !activeAgent(p.record.State) {
			return AgentRecord{}, fmt.Errorf("parent is not active")
		}
		depth = p.record.Depth + 1
		for _, n := range spec.Tools {
			found := false
			for _, v := range p.record.Spec.Tools {
				found = found || n == v
			}
			// A trusted Workbox specialist may receive the exact package
			// version already granted through the supervising role's factory.
			if !found && spec.WorkflowID != "" && (toolcontract.ValidPackageID(n) || n == "wait") && p.record.Spec.WorkspaceRole == WorkspaceMatrix {
				for _, cap := range p.record.Spec.Tools {
					if cap == "tool_factory" && toolAllowed(ctx, n) {
						found = true
					}
				}
			}
			if !found {
				return AgentRecord{}, fmt.Errorf("child cannot expand parent capabilities")
			}
		}
	}
	for _, j := range m.jobs {
		if j.record.Parent == owner && j.record.Spec.RequestID == spec.RequestID {
			if instance != nil && instance.CreationRequestHash != "" && j.record.Instance != nil && j.record.Instance.CreationRequestHash != "" {
				if instance.Supervisor != "" && j.record.Instance.Supervisor != instance.Supervisor {
					return AgentRecord{}, fmt.Errorf("creation receipt no longer grants supervision")
				}
				if instance.CreationRequestHash != j.record.Instance.CreationRequestHash {
					return AgentRecord{}, fmt.Errorf("request_id conflict")
				}
				return copyRecord(j.record), nil
			}
			a, _ := json.Marshal(spec)
			if (conversation || instance != nil) && j.record.CreationSpecHash != "" {
				if taskMessageHash(string(a)) != j.record.CreationSpecHash {
					return AgentRecord{}, fmt.Errorf("request_id conflict")
				}
				return copyRecord(j.record), nil
			}
			saved := j.record.Spec
			saved.MaxRequests = 0
			b, _ := json.Marshal(saved)
			if string(a) != string(b) {
				return AgentRecord{}, fmt.Errorf("request_id conflict")
			}
			return copyRecord(j.record), nil
		}
	}
	if err := m.admitFixedRole(ctx, spec.WorkspaceRole); err != nil {
		return AgentRecord{}, err
	}
	if depth > 2 {
		return AgentRecord{}, fmt.Errorf("agent depth limit reached")
	}
	// An accepted request keeps its receipt even if a snapshot later disappears.
	// Validate assets only after checking the original request identity above.
	if len(spec.Attachments) > 0 {
		settings, e := m.settings(spec.ModelID)
		if e != nil {
			return AgentRecord{}, e
		}
		if _, e = prepareComposerAttachments(m.config, spec.Attachments, settings); e != nil {
			return AgentRecord{}, e
		}
	}
	active := 0
	for _, j := range m.jobs {
		if activeAgent(j.record.State) {
			active++
		}
	}
	activeLimit := 16
	if m.streamProjection != nil {
		activeLimit = 64
	}
	if active >= activeLimit {
		return AgentRecord{}, fmt.Errorf("at most %d active agents; wait or cancel existing work", activeLimit)
	}
	var id [16]byte
	if _, err = rand.Read(id[:]); err != nil {
		return AgentRecord{}, err
	}
	origin, _ := ctx.Value(agentRequestKey{}).(string)
	if parent := m.jobs[owner]; parent != nil {
		origin = parent.record.OriginRequest
	}
	r := AgentRecord{OriginRequest: origin, ID: hex.EncodeToString(id[:]), Parent: owner, Depth: depth, Spec: spec, State: "queued", Created: time.Now().UTC().Format(time.RFC3339Nano), Acceptance: "pending", Generation: 1, Turns: map[string]string{spec.RequestID: spec.Task}, TurnGenerations: map[string]int{spec.RequestID: 1}, Usage: []AgentUsage{}}
	if source, internal := conversationOrigin(ctx); internal && spec.WorkspaceRole == WorkspaceMatrix {
		rememberLinkOrigin(&r, spec.RequestID, source)
	}
	if binding, ok := ctx.Value(conversationLinkCreateKey{}).(conversationLinkBinding); ok && conversation {
		r.Link = &binding
	}
	if request := repairRunRequest(ctx); request != "" && spec.WorkspaceRole == WorkspaceMatrix {
		r.RepairRun = &motherRepairRun{Request: request}
	}
	r.SubmittedAt = r.Created
	if len(spec.Attachments) > 0 {
		r.TurnAttachments = map[string][]ComposerAttachment{spec.RequestID: spec.Attachments}
		r.TurnHashes = map[string]string{spec.RequestID: attachmentMessageHash(spec.Task, spec.Attachments)}
	}
	j := &agentJob{record: r, done: make(chan struct{})}
	j.record.Instance = instance
	if instance != nil && instance.Supervisor != "" {
		if err = m.packageManagementActorLocked(instance.Supervisor); err != nil {
			return AgentRecord{}, err
		}
		if err = m.validatePackageTeamIdentityLocked(r.ID, spec.AgentPackage, instance.Supervisor, instance.TeamRole); err != nil {
			return AgentRecord{}, err
		}
		if parent := m.jobs[instance.Supervisor]; parent != nil {
			for _, name := range spec.Tools {
				if !slices.Contains(parent.record.Spec.Tools, name) {
					return AgentRecord{}, fmt.Errorf("child cannot expand supervisor capabilities")
				}
			}
		}
	}
	if conversation || instance != nil {
		original, _ := json.Marshal(spec)
		j.record.CreationSpecHash = taskMessageHash(string(original))
		j.record.State = "idle"
		j.record.Generation = 0
		j.record.SubmittedAt = ""
		j.record.Turns = map[string]string{}
		j.record.TurnGenerations = map[string]int{}
		j.record.ConversationRevision = 1
		if conversation {
			if _, err = loadConversationPrompt(m.config, conversationPromptID(r), spec.Prompt); err != nil {
				return AgentRecord{}, err
			}
		}
	}
	if err = m.saveLocked(j); err != nil {
		return AgentRecord{}, err
	}
	m.jobs[r.ID] = j
	if conversation || instance != nil {
		close(j.done)
		return copyRecord(j.record), nil
	}
	m.launchLocked(j, spec.Task, false, spec.Attachments...)
	return copyRecord(j.record), nil
}
func (m *AgentManager) launchLocked(j *agentJob, message string, resume bool, attachments ...ComposerAttachment) {
	j.finishing = false
	attachments = append([]ComposerAttachment(nil), attachments...)
	ctx, cancel := context.WithTimeout(m.ctx, time.Duration(j.record.Spec.TimeoutSeconds)*time.Second)
	j.cancel = cancel
	done := j.done
	maintenanceOnly := j.record.CompactionRun != ""
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		defer cancel()
		doneClosed := false
		defer func() {
			// Capture the finished generation before closing admission's done
			// fence. A new turn must not replace the completion being reported.
			r, e := m.Status(m.owner, j.record.ID)
			if !doneClosed {
				close(done)
			}
			if e == nil {
				m.settleLink(r)
				if !maintenanceOnly {
					m.settleMotherRepair(r)
				}
			}
		}()
		if ctx.Err() != nil {
			m.finish(j, "cancelled", "", ctx.Err())
			return
		}
		m.mu.Lock()
		j.record.State = "running"
		err := m.saveLocked(j)
		m.mu.Unlock()
		if err != nil {
			m.finish(j, "failed", "", err)
			return
		}
		result, err := m.run(ctx, j, message, resume, attachments...)
		if err == errHumanWaiting && ctx.Err() == nil {
			m.mu.Lock()
			// Close the previous run's done channel under the same lock as the
			// durable pause, so a visible waiting request is safe to reply to.
			if ctx.Err() == nil {
				err = m.pauseHumanLocked(j)
				if err == nil {
					close(done)
					doneClosed = true
					m.mu.Unlock()
					return
				}
			}
			m.mu.Unlock()
		}
		state := "completed"
		if err != nil {
			state = "failed"
		}
		if errors.Is(err, errMotherRepairStopped) {
			state = "cancelled"
		}
		if ctx.Err() != nil {
			err = ctx.Err()
			state = "cancelled"
			if ctx.Err() == context.DeadlineExceeded {
				state = "timed_out"
			}
		}
		m.finish(j, state, result, err)
		if m.workspace != nil && j.record.Spec.WorkspaceRole != "" {
			text := result
			if err != nil {
				if record, e := m.Status(m.owner, j.record.ID); e == nil {
					text = m.workspace.failureReport(record)
				} else {
					text = m.redact(err.Error())
				}
			}
			m.workspace.recordOutput(j.record.Spec.WorkspaceRole, text, state)
		}
	}()
}
func (m *AgentManager) finish(j *agentJob, state, result string, err error) {
	if m.finishConversationMaintenance(j, err) {
		return
	}
	m.mu.Lock()
	j.finishing = true
	source := j.record
	spec, generation := source.Spec, source.Generation
	shell := j.shell
	m.mu.Unlock()
	if state != "completed" && shell != nil {
		shell.CancelAll()
	}
	var delivery *AgentDelivery
	baseURL := ""
	if settings, e := m.settings(spec.ModelID); e == nil {
		baseURL = settings.BaseURL
	}
	if state == "completed" {
		delivery = m.collectDelivery(spec, generation)
	}
	if spec.Kind == "conversation" && state == "completed" {
		if e := m.saveConversationResult(j.record.ID, generation, m.redact(result)); e != nil {
			state = "persistence_failed"
			err = fmt.Errorf("完整回复保存失败，原始会话档案保留: %w", e)
		}
	}
	source.State = state
	var repair *motherRepairNotice
	if m.linkHome != nil && spec.Kind == "conversation" && generation > 0 && m.independentRepairSource(source) {
		repair = m.linkHome.prepareMotherRepairNotice(source)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	j.record.State = state
	j.record.MotherRepairNotice = repair
	j.record.CompletedAt = time.Now().UTC().Format(time.RFC3339Nano)
	m.finishHumansLocked(j, state)
	j.record.Delivery = delivery
	if state != "completed" {
		m.cancelWorkflowRunsLocked(j.record.ID)
		for id, child := range m.jobs {
			if m.ownsLocked(j.record.ID, id) && activeAgent(child.record.State) {
				_ = m.cancelJobLocked(child)
			}
		}
	}
	j.record.Result = utf8Prefix(m.redact(result), 64<<10)
	j.record.Error = ""
	j.record.Failure = classifyAgentFailure(err, baseURL)
	if err != nil {
		j.record.Error = m.redact(err.Error())
	}
	if e := m.saveLocked(j); e != nil {
		j.record.State = "persistence_failed"
		j.record.Error = "Final state could not be saved; inspect the archive before resuming."
	}
}
func (m *AgentManager) redact(text string) string {
	keys, _ := m.redactionSecrets()
	return redactSecretEncodings(text, keys)
}

func (m *AgentManager) redactionSecrets() ([]string, error) {
	s, err := Load(m.config)
	if err != nil {
		return nil, err
	}
	var keys []string
	add := func(key string) {
		if key != "" {
			keys = append(keys, key)
		}
	}
	add(s.APIKey)
	for _, c := range s.ProviderConnections {
		add(c.APIKey)
		for _, key := range c.APIKeyHistory {
			add(key)
		}
	}
	return keys, nil
}

func (m *AgentManager) Redact(text string) string { return m.redact(text) }

type agentRequestKey struct{}

var errAgentFinishing = errors.New("agent is finishing; retry after wait")

func WithAgentRequest(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, agentRequestKey{}, id)
}

// 取消一次外部 Matrix 请求时，只取消该请求创建的任务。
func (m *AgentManager) CancelRequest(request string) {
	if request == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, j := range m.jobs {
		if j.record.OriginRequest == request && activeAgent(j.record.State) {
			_ = m.cancelJobLocked(j)
		}
	}
}
func (m *AgentManager) Send(owner, id, request, message string) (AgentRecord, error) {
	return m.SendGeneration(owner, id, request, message, 0)
}

// SendGeneration binds a continuation to the generation inspected by its caller.
// The old entry point remains available for existing local tools.
func (m *AgentManager) SendGeneration(owner, id, request, message string, generation int) (AgentRecord, error) {
	return m.sendGeneration(owner, id, request, message, taskMessageHash(message), generation)
}

func (m *AgentManager) sendGeneration(owner, id, request, message, messageHash string, generation int) (AgentRecord, error) {
	return m.sendGenerationAttachments(owner, id, request, message, messageHash, generation, nil)
}
func (m *AgentManager) sendGenerationAttachments(owner, id, request, message, messageHash string, generation int, attachments []ComposerAttachment) (AgentRecord, error) {
	return m.sendGenerationScoped(nil, owner, id, request, message, messageHash, generation, attachments)
}

// Model entrypoints retain their current tool grant through the final admission
// lock. Local user entrypoints already have the service owner's authority.
func (m *AgentManager) sendGenerationScoped(ctx context.Context, owner, id, request, message, messageHash string, generation int, attachments []ComposerAttachment) (AgentRecord, error) {
	if next, actor := m.taskManager(owner, id); next != m {
		return next.sendGenerationScoped(ctx, actor, id, request, message, messageHash, generation, attachments)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.ownsLocked(owner, id) {
		return AgentRecord{}, fmt.Errorf("agent not owned by caller")
	}
	j := m.jobs[id]
	if m.updateFrozen {
		return AgentRecord{}, fmt.Errorf("更新交接中，任务尚未接纳")
	}
	if request == "" || len(request) > 128 || (strings.TrimSpace(message) == "" && len(attachments) == 0) || len(message) > 64<<10 {
		return AgentRecord{}, fmt.Errorf("invalid message or request_id")
	}
	if j.record.DeletionPending {
		return AgentRecord{}, fmt.Errorf("这段会话正在删除，清理尚未完成；请重试删除")
	}
	if old, ok := j.record.Turns[request]; ok {
		hash := j.record.TurnHashes[request]
		if (hash != "" && hash != messageHash) || (hash == "" && attachmentMessageHash(old, j.record.TurnAttachments[request]) != attachmentMessageHash(message, attachments)) {
			return AgentRecord{}, fmt.Errorf("request_id conflict")
		}
		return copyRecord(j.record), nil
	}
	if ctx != nil {
		if repair, _ := ctx.Value(motherRepairTargetKey{}).(*motherRepairEvent); repair != nil && !repair.matchesSource(j.record) {
			return AgentRecord{}, fmt.Errorf("原任务已重试，请核对最新执行回执")
		}
	}
	if j.greetingCancel != nil {
		j.greetingCancel()
		j.greetingCancel = nil
	}
	if j.record.CompactionRun != "" {
		return AgentRecord{}, fmt.Errorf("会话正在整理上下文，请在整理完成后重试原请求编号")
	}
	if j.record.Link != nil {
		room, err := m.readGroup(linkLogID(j.record.Link.Scope))
		if err != nil {
			return AgentRecord{}, err
		}
		if _, released := room.LinkReleased[j.record.ID]; released {
			return AgentRecord{}, fmt.Errorf("协作成员已归档；请邀请新的实例")
		}
	}

	if ctx != nil && j.record.Instance != nil && owner != m.owner {
		if err := ctx.Err(); err != nil {
			return AgentRecord{}, err
		}
		for _, name := range j.record.Spec.Tools {
			if !toolAllowed(ctx, name) {
				return AgentRecord{}, fmt.Errorf("member capability exceeds the sender's current grant: %s", name)
			}
			if parent := m.jobs[owner]; parent != nil && !slices.Contains(parent.record.Spec.Tools, name) {
				return AgentRecord{}, fmt.Errorf("supervisor no longer has capability: %s", name)
			}
		}
		if b := j.record.Instance.Workflow; b != nil {
			store, e := m.workflowStore(b.Owner, b.ID)
			if e != nil {
				return AgentRecord{}, e
			}
			d, e := store.read()
			if e != nil {
				return AgentRecord{}, e
			}
			for _, name := range workflowCapabilities(b.Package, d.Instance.Tools) {
				if !toolAllowed(ctx, name) {
					return AgentRecord{}, fmt.Errorf("workflow capability exceeds the sender's current grant: %s", name)
				}
			}
		}
	}
	if j.record.Spec.WorkflowRetention == "task" {
		store, e := m.workflowStore(j.record.Parent, j.record.Spec.WorkflowID)
		if e != nil {
			return AgentRecord{}, e
		}
		d, e := store.read()
		if e != nil {
			return AgentRecord{}, e
		}
		if d.Instance.State == "completed" || d.Instance.State == "cancelled" {
			return AgentRecord{}, fmt.Errorf("task specialist has finished; existing receipts remain readable")
		}
	}
	if j.record.Instance != nil && j.record.Instance.Workflow != nil {
		if err := m.admitBoundWorkflowTurn(j.record); err != nil {
			return AgentRecord{}, err
		}
	}
	if j.record.Spec.AgentPackage != "" {
		if j.record.Instance == nil {
			return AgentRecord{}, fmt.Errorf("Agent package binding is missing; original record retained")
		}
		if !activeAgent(j.record.State) && j.record.Instance.Current.Definition.Runtime.Policy.Lifetime == "task" && j.record.Generation > 0 {
			return AgentRecord{}, fmt.Errorf("task Agent has already run; create another instance or inspect its receipts")
		}
		admit := m.admitPackageAgent
		if activeAgent(j.record.State) {
			admit = m.admitPackageSteering
		}
		if err := admit(context.Background(), j.record); err != nil {
			return AgentRecord{}, err
		}
	}
	if err := m.admitFixedRole(context.Background(), j.record.Spec.WorkspaceRole); err != nil {
		return AgentRecord{}, err
	}
	if generation < 0 || (generation > 0 && generation != j.record.Generation) || (m.packageService && generation != j.record.Generation) {
		return AgentRecord{}, fmt.Errorf("agent generation changed; inspect before continuing")
	}
	if m.workspace != nil && m.workspace.Mode() == HostOS && j.record.Spec.WorkspaceRole == WorkspaceExecution && !CurrentReleaseStage().TeamCollaboration {
		return AgentRecord{}, fmt.Errorf("团队协同已关闭；历史记录只读")
	}
	resolved := j.record.Spec
	var conversationSettings *Settings
	if resolved.Kind == "conversation" {
		var err error
		resolved, err = m.resolveConversationSpec(j.record)
		if err != nil {
			return AgentRecord{}, err
		}
		conversationSettings, err = m.specSettings(resolved)
		if err != nil {
			return AgentRecord{}, err
		}
	}
	if len(attachments) > 0 {
		settings, e := conversationSettings, error(nil)
		if settings == nil {
			settings, e = m.specSettings(resolved)
		}
		if e != nil {
			return AgentRecord{}, e
		}
		if j.record.Spec.Kind == "conversation" {
			settings = m.conversationImageSettings(settings)
		}
		if _, e = prepareComposerAttachments(m.config, attachments, settings); e != nil {
			return AgentRecord{}, &composerSendRejection{TaskID: id, RequestID: request, Cause: e}
		}
	}
	origin, internal := conversationOrigin(ctx)
	if internal && j.record.MotherTakeover != nil && j.record.MotherTakeover.Generation == j.record.Generation {
		return AgentRecord{}, fmt.Errorf("该失败代次已交接给母体，请回查交接结果")
	}
	if internal && (j.record.LinkCancelled || j.record.State == "cancelled" || j.record.State == "cancelling" || j.record.Generation != generation) {
		return AgentRecord{}, fmt.Errorf("协作目标已停止或代次已变化")
	}
	if (m.packageService || j.record.Spec.Kind == "conversation") && activeAgent(j.record.State) && m.ctx.Err() == nil {
		if j.finishing || j.record.State == "cancelling" {
			return AgentRecord{}, errAgentFinishing
		}
		return m.queueAgentMessageLocked(j, request, message, messageHash, attachments, origin, internal)
	}
	if activeAgent(j.record.State) || m.ctx.Err() != nil {
		return AgentRecord{}, fmt.Errorf("agent busy or manager closed")
	}
	select {
	case <-j.done:
	default:
		return AgentRecord{}, errAgentFinishing
	}
	active := 0
	for _, other := range m.jobs {
		if activeAgent(other.record.State) {
			active++
		}
	}
	activeLimit := 16
	if m.streamProjection != nil {
		activeLimit = 64
	}
	if active >= activeLimit {
		return AgentRecord{}, fmt.Errorf("at most %d active agents; wait or cancel existing work", activeLimit)
	}
	previous := copyRecord(j.record)
	if request := repairRunRequest(ctx); request != "" && j.record.Spec.WorkspaceRole == WorkspaceMatrix {
		j.record.RepairRun = &motherRepairRun{Request: request, RequestBase: j.record.Requests, TokenBase: j.record.AccountedTokens}
	} else if !internal {
		j.record.RepairRun = nil
	}
	if internal {
		rememberLinkOrigin(&j.record, request, origin)
	} else {
		j.record.LinkCancelled = false
		j.record.MotherTakeover = nil
	}
	if j.record.Instance != nil {
		j.record.TurnRequestBase = j.record.Requests
		j.record.TurnTokenBase = j.record.AccountedTokens
	}
	if j.record.Spec.Kind == "conversation" {
		j.conversationTurn = &resolved
		j.conversationSettings = conversationSettings
		// Durable selection records which role model this generation actually used.
		j.record.Spec.ModelID, j.record.Spec.ModelParameters = resolved.ModelID, resolved.ModelParameters
		j.record.Spec.Title, j.record.Spec.Tools = resolved.Title, resolved.Tools
		if codingRecord(j.record) {
			j.record.Spec.Workdir = resolved.Workdir
		}
	}
	if j.record.Spec.WorkspaceRole != "" || j.record.Spec.Kind == "conversation" {
		j.record.TurnRequestBase = j.record.Requests
		j.record.TurnTokenBase = j.record.AccountedTokens
		// Older desktop sessions imposed this hidden fixed cap on every turn.
		// Interactive turns retain deadlines; explicit child token budgets do not change.
		if j.record.Spec.MaxTokens == 1000000 {
			j.record.Spec.MaxTokens = 0
		}
	}
	j.record.History = append(j.record.History, AgentOutcome{Generation: previous.Generation, State: previous.State, Result: previous.Result, Error: previous.Error, Acceptance: previous.Acceptance, Evidence: previous.Evidence, Delivery: previous.Delivery, SubmittedAt: previous.SubmittedAt, CompletedAt: previous.CompletedAt, RunTime: previous.RunTime})
	j.record.Delivery = nil
	j.record.Generation++
	j.record.ChatRetryAttempt = 0
	j.record.SubmittedAt = time.Now().UTC().Format(time.RFC3339Nano)
	j.record.CompletedAt = ""
	j.record.RunTime = nil
	j.runStarted.Store(0)
	j.runCheckpointStart = 0
	j.record.State = "queued"
	j.record.Result = ""
	j.record.Error = ""
	j.record.Acceptance = "pending"
	j.record.Evidence = ""
	j.record.Turns[request] = message
	if len(attachments) > 0 {
		if j.record.TurnAttachments == nil {
			j.record.TurnAttachments = map[string][]ComposerAttachment{}
		}
		j.record.TurnAttachments[request] = append([]ComposerAttachment(nil), attachments...)
	}
	if j.record.TurnGenerations == nil {
		j.record.TurnGenerations = map[string]int{j.record.Spec.RequestID: 1}
	}
	j.record.TurnGenerations[request] = j.record.Generation
	if j.record.TurnHashes == nil {
		j.record.TurnHashes = map[string]string{}
	}
	j.record.TurnHashes[request] = messageHash
	if err := m.saveLocked(j); err != nil {
		j.record = previous
		return AgentRecord{}, err
	}
	j.done = make(chan struct{})
	m.launchLocked(j, message, true, attachments...)
	return copyRecord(j.record), nil
}
func (m *AgentManager) Cancel(owner, id string) error {
	return m.CancelGeneration(owner, id, 0)
}

func (m *AgentManager) CancelGeneration(owner, id string, generation int) error {
	if next, actor := m.taskManager(owner, id); next != m {
		return next.CancelGeneration(actor, id, generation)
	}
	if m.workspace != nil && m.workspace.coreLinkRegistered.Load() {
		m.linkOperation.Lock()
		defer m.linkOperation.Unlock()
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.ownsLocked(owner, id) {
		return fmt.Errorf("agent not owned by caller")
	}
	if generation < 0 || (generation > 0 && generation != m.jobs[id].record.Generation) || (m.packageService && generation != m.jobs[id].record.Generation) {
		return fmt.Errorf("agent generation changed; inspect before cancelling")
	}
	// Ownership and generation are verified before any side effect. Once stop
	// is authorized, a failed receipt must not leave the rest of its tree alive.
	var failures []error
	if m.primaryCoreLink(m.jobs[id].record) {
		if err := m.cancelWorkspaceLink(m.jobs[id].record); err != nil {
			failures = append(failures, fmt.Errorf("停止 Core Link 协作失败: %w", err))
		}
	}
	for key, j := range m.jobs {
		if key == id || m.ownsLocked(id, key) || m.linkDescendantLocked(id, key) {
			if j.greetingCancel != nil {
				j.greetingCancel()
				j.greetingCancel = nil
			}
			if m.coreLinkCapable(j.record) {
				j.record.LinkCancelled = true
				j.record.LinkStoppedThrough = j.record.Generation
				if err := m.saveLocked(j); err != nil {
					failures = append(failures, fmt.Errorf("任务 %s 的协作停止状态保存失败: %w", key, err))
				}
			}
			if activeAgent(j.record.State) {
				if e := m.cancelJobLocked(j); e != nil {
					failures = append(failures, fmt.Errorf("任务 %s 的停止状态保存失败: %w", key, e))
				}
			} else {
				m.cancelWorkflowRunsLocked(j.record.ID)
				if j.shell != nil {
					j.shell.CancelAll()
				}
			}
		}
	}
	return errors.Join(failures...)
}
func (m *AgentManager) Review(owner, id, verdict, evidence string) (AgentRecord, error) {
	return m.ReviewWithChecks(owner, id, AgentReview{Verdict: verdict, Evidence: evidence})
}
func (m *AgentManager) Wait(ctx context.Context, owner, id string, ms int) (AgentRecord, error) {
	if next, actor := m.taskManager(owner, id); next != m {
		return next.Wait(ctx, actor, id, ms)
	}
	m.mu.Lock()
	if !m.ownsLocked(owner, id) {
		m.mu.Unlock()
		return AgentRecord{}, fmt.Errorf("agent not owned by caller")
	}
	done := m.jobs[id].done
	m.mu.Unlock()
	if ms <= 0 {
		ms = 1000
	}
	timer := time.NewTimer(time.Duration(min(ms, 25000)) * time.Millisecond)
	defer timer.Stop()
	select {
	case <-done:
	case <-ctx.Done():
		return AgentRecord{}, ctx.Err()
	case <-timer.C:
	}
	return m.Status(owner, id)
}

type agentManagerKey struct{}
type agentManagerContext struct {
	manager *AgentManager
	owner   string
	shell   *ShellManager
}

func WithAgentManager(ctx context.Context, m *AgentManager, owner string, shell *ShellManager) context.Context {
	return context.WithValue(ctx, agentManagerKey{}, agentManagerContext{m, owner, shell})
}
func (m *AgentManager) Call(ctx context.Context, owner string, data json.RawMessage) (any, error) {
	var p struct {
		Action   string          `json:"action"`
		Command  json.RawMessage `json:"command"`
		Category string          `json:"category"`
		AgentSpec
		ID           string                `json:"id"`
		Message      string                `json:"message"`
		Verdict      string                `json:"verdict"`
		Evidence     string                `json:"evidence"`
		TimeoutMS    int                   `json:"timeout_ms"`
		Cursor       int64                 `json:"cursor"`
		Limit        int                   `json:"limit"`
		Since        int64                 `json:"since"`
		Before       int64                 `json:"before"`
		Generation   int                   `json:"generation"`
		Presentation string                `json:"presentation"`
		Checks       []AgentCriterionCheck `json:"checks"`
	}
	if json.Unmarshal(data, &p) != nil {
		return nil, fmt.Errorf("arguments must be an object")
	}
	identity, _ := ctx.Value(motherIdentityKey{}).(*motherIdentity)
	if strings.HasPrefix(p.Action, "identity_") || identity.active() && !strings.HasPrefix(p.Action, "link_") {
		return identity.call(ctx, owner, data)
	}
	if strings.HasPrefix(p.Action, "link_") {
		return m.coreLinkCall(ctx, owner, data)
	}
	m.mu.Lock()
	caller := m.jobs[owner]
	conversationCaller := caller != nil && caller.record.Spec.Kind == "conversation"
	m.mu.Unlock()
	if conversationCaller {
		if bound, ok := ctx.Value(programAgentContextKey{}).(programAgentContext); ok && bound.record.ID == owner {
			return bound.manage(ctx, data)
		}
		return nil, fmt.Errorf("会话实例只能通过核心 Link 操作当前协作范围")
	}
	if p.Action == "package" {
		return m.packageAgentTool(ctx, owner, p.Command)
	}
	if p.ID != "" {
		if next, actor := m.taskManager(owner, p.ID); next != m {
			return next.Call(ctx, actor, data)
		}
	}
	programAction := false
	switch p.Action {
	case "programs", "program", "program_open", "program_send", "program_result", "program_cancel":
		programAction = true
	}
	if (p.Kind == "conversation" || p.Action == "overview" || programAction) && m.streamProjection == nil {
		if m.workspace == nil || m.workspace.host == nil || m.workspace.isTerminal() {
			return nil, fmt.Errorf("conversation agents require the desktop host")
		}
		return m.workspace.motherConversationCall(ctx, owner, data)
	}
	switch p.Action {
	case "models":
		if p.Category != "" {
			return discoverModels(m.config, rawJSON(map[string]any{"action": "list", "category": p.Category}))
		}
		s, e := Load(m.config)
		if e != nil {
			return nil, e
		}
		r := []map[string]any{}
		for _, v := range s.APIProfiles {
			if v.Enabled == nil || *v.Enabled {
				r = append(r, map[string]any{"id": v.ID, "name": v.Name, "model": v.Model, "free": v.Free, "context_window": v.ContextWindow})
			}
		}
		return r, nil
	case "create":
		r, err := m.Create(ctx, owner, p.AgentSpec)
		if err == nil {
			m.mu.Lock()
			open := m.window
			taskOpen := m.taskWindow
			m.mu.Unlock()
			if taskOpen != nil {
				if e := taskOpen(r.ID, ""); e != nil {
					r.WindowError = e.Error()
				}
			} else if open != nil {
				if e := open(); e != nil {
					r.WindowError = e.Error()
				}
			}
		}
		return r, err
	case "list":
		rows := []map[string]any{}
		for _, record := range m.List(owner) {
			rows = append(rows, agentSummary(record))
		}
		return rows, nil
	case "events":
		if _, err := m.Status(owner, p.ID); err != nil {
			return nil, err
		}
		return m.events(filepath.Join(m.dir, "sessions", p.ID+".jsonl"), p.Cursor, p.Limit)
	case "activity":
		return m.Activity(owner, p.ID, p.Since, p.Before, p.Limit)
	case "status", "result":
		return m.Status(owner, p.ID)
	case "wait":
		return m.Wait(ctx, owner, p.ID, p.TimeoutMS)
	case "send":
		return m.sendGenerationScoped(ctx, owner, p.ID, p.RequestID, p.Message, taskMessageHash(p.Message), p.Generation, nil)
	case "cancel":
		return map[string]any{"id": p.ID, "requested": true}, m.CancelGeneration(owner, p.ID, p.Generation)
	case "review":
		return m.ReviewWithChecks(owner, p.ID, AgentReview{RequestID: p.RequestID, Generation: p.Generation, Verdict: p.Verdict, Evidence: p.Evidence, Checks: p.Checks})
	case "hide_window":
		if m.taskWindowHide != nil {
			if _, err := m.Status(owner, p.ID); err != nil {
				return nil, err
			}
			err := m.taskWindowHide(p.ID)
			return map[string]any{"hidden": err == nil}, err
		}
		m.mu.Lock()
		hide := m.windowHide
		m.mu.Unlock()
		if hide == nil {
			return nil, fmt.Errorf("task window unavailable")
		}
		err := hide()
		return map[string]any{"hidden": err == nil}, err
	case "open_window":
		if m.taskWindow != nil {
			if _, err := m.Status(owner, p.ID); err != nil {
				return nil, err
			}
			err := m.taskWindow(p.ID, p.Presentation)
			return map[string]any{"opened": err == nil}, err
		}
		m.mu.Lock()
		open := m.window
		m.mu.Unlock()
		if open == nil {
			return nil, fmt.Errorf("task window unavailable")
		}
		mode := p.Presentation
		if mode == "" {
			mode = "display"
		}
		err := open(mode)
		return map[string]any{"opened": err == nil, "presentation": mode}, err
	}
	return nil, fmt.Errorf("unknown agents action")
}
