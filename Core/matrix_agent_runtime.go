// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: run; publishTaskPlan; agentRequest; agentRequestClock; mark; snapshot; reset; appendUsageLedger; appendBackgroundUsage; usageHost; agentUsage; estimateUsage; completeAgent; completeAgentObserved
// Impact: python -B scripts/code-atlas.py show Core/matrix_agent_runtime.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	contextprovider "github.com/aieyra/aieyra-os/agent/context/contract"
	contextport "github.com/aieyra/aieyra-os/contracts/context"
	"net/http/httptrace"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

// Workers use the interactive Matrix archive and tool transactions. Recovery
// settles unknown receipts without replaying external side effects.
func (m *AgentManager) run(ctx context.Context, job *agentJob, message string, resume bool, attachments ...ComposerAttachment) (_ string, runErr error) {
	m.mu.Lock()
	record := copyRecord(job.record)
	if job.conversationTurn != nil {
		record.Spec = *job.conversationTurn
	}
	frozenSettings := job.conversationSettings
	m.mu.Unlock()
	spec, id := record.Spec, record.ID
	maintenanceOnly := record.CompactionRun != ""
	var identity *motherIdentity
	packageRuntime := m.packageService && record.Instance != nil
	requestSettings := func() (*Settings, error) {
		if identity.active() {
			current, err := Load(m.config)
			if err != nil {
				return nil, err
			}
			if current.rolePoolProfile(identity.snapshot().Model) == nil {
				return nil, fmt.Errorf("专业身份使用的母体模型已撤销")
			}
			return identity.settings.Clone(), nil
		}
		if frozenSettings != nil {
			if err := m.checkConversationAuthority(record); err != nil {
				return nil, err
			}
			return frozenSettings.Clone(), nil
		}
		return m.specSettings(spec)
	}
	if err := m.admitFixedRole(ctx, spec.WorkspaceRole); err != nil {
		return "", err
	}
	privateMemory := packageRuntime || spec.Kind == "conversation"
	memoryWorkspace := m.workspace
	if privateMemory {
		memoryWorkspace = m.instanceMemoryWorkspace(record)
		if err := os.MkdirAll(memoryWorkspace.dir, 0700); err != nil {
			return "", err
		}
		defer memoryWorkspace.service.Close()
	}
	if spec.ContextProvider != nil {
		if _, e := resolveContextProvider(*spec.ContextProvider, m.config); e != nil {
			return "", e
		}
	}
	if m.workspace != nil && m.workspace.Mode() == HostOS && spec.WorkspaceRole == WorkspaceExecution && !CurrentReleaseStage().TeamCollaboration {
		return "", fmt.Errorf("团队协同已关闭；请由 Eyra 直接执行")
	}
	var inputImages []ImageAttachment
	if len(attachments) > 0 {
		settings, e := requestSettings()
		if e != nil {
			return "", e
		}
		attachmentSettings := m.conversationImageSettings(settings)
		inputImages, e = prepareComposerAttachments(m.config, attachments, attachmentSettings)
		if e != nil {
			return "", e
		}
		message = attachmentContent(message, attachments)
		if !SupportsToolImages(settings) {
			inputImages = nil
		}
	}
	if m.workspace != nil && m.workspace.split != nil {
		if err := m.workspace.splitStationRun(ctx, true); err != nil {
			return "", err
		}
		defer func() { _ = m.workspace.splitStationRun(context.Background(), false) }()
	}
	// Archived specifications must not restore retired permissions: every fixed role
	// takes its current tool list at each run, including restored vision sessions.
	if m.workspace != nil && (spec.WorkspaceRole == WorkspaceMatrix || m.workspace.teamHost() && validWorkspaceRole(spec.WorkspaceRole)) {
		spec.Tools = m.workspace.permissions(spec.WorkspaceRole)
	}
	archiveConfig := filepath.Join(m.dir, "config.json")
	path, err := SessionPath(archiveConfig, id)
	if err != nil {
		return "", err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return "", err
	}
	var archive *SessionArchive
	var history []Message
	var originalInputRecorded bool
	var retryReplyOnly bool
	var checkpoint *Checkpoint
	var providerState *contextport.State
	var strategy contextprovider.Provider
	var restoredCompaction *CompactionState
	var restoredGeneration int
	var identityRestored *RestoredSession
	plan := &PlanEngine{Receipts: map[string]ToolReceipt{}}
	if m.workspace != nil && m.workspace.Mode().unified() && spec.WorkspaceRole != "" {
		transcriptKey := ""
		if spec.WorkspaceRole == WorkspaceMatrix && m.workspace.service != nil && m.workspace.split == nil {
			transcriptKey = m.workspace.transcriptKey(id)
		}
		m.mu.Lock()
		archive = job.archive
		m.mu.Unlock()
		managed := false
		if spec.WorkspaceRole == WorkspaceMatrix {
			m.workspace.mu.Lock()
			if s := m.workspace.contextSessionLocked(); s != nil {
				managed = true
				if archive == nil || archive.Path != m.workspace.contextArchivePath(s.Archive) {
					archive = &SessionArchive{Path: m.workspace.contextArchivePath(s.Archive), attachmentConfig: m.config}
				}
			}
			m.workspace.mu.Unlock()
		}
		m.mu.Lock()
		if archive == nil {
			archive = &SessionArchive{Path: path, ephemeral: true}
		}
		job.archive = archive
		m.mu.Unlock()
		if managed {
			if err = archive.Lock(); err != nil {
				return "", err
			}
			defer archive.Close()
		}
		// 记忆系统 M-A：主对话进入模型历史的每条消息都写进深层记忆（本机 SQLite），按位置去重。
		if transcriptKey != "" {
			m.workspace.transcribe(nil)
			observer := m.workspace.transcriptObserver(transcriptKey, m.redact)
			archive.mu.Lock()
			if archive.observe == nil {
				archive.observe = observer
			}
			archive.mu.Unlock()
		}
		if resume || managed {
			restored, e := archive.read()
			if e != nil {
				return "", e
			}
			if managed {
				m.workspace.mu.Lock()
				session := m.workspace.contextSessionLocked().ID
				m.workspace.mu.Unlock()
				if e = validateSessionContextProvider(session, restored, m.config); e != nil {
					return "", e
				}
			}
			history, checkpoint, plan = restored.Messages, restored.Checkpoint, &restored.Plan
			originalInputRecorded = restored.WorkspaceGeneration == record.Generation && restored.GenerationInput
			retryReplyOnly = record.ChatRetryAttempt > 0 && restored.WorkspaceGeneration == record.Generation && restored.GenerationMutation
			archive.mu.Lock()
			archive.observed = len(history)
			archive.mu.Unlock()
			restoredGeneration = restored.WorkspaceGeneration
			restoredCompaction = restored.Compaction
			identityRestored = restored
			providerState = restored.ContextProvider
			if restored.RecoveredTool != nil {
				if e = archive.Append("tool_turn", *restored.RecoveredTool); e != nil {
					return "", e
				}
			}
		} else if err = archive.Start(spec.ModelID); err != nil {
			return "", err
		}
	} else if _, statErr := os.Stat(path); resume && statErr == nil {
		var restored *RestoredSession
		archive, restored, err = RestoreSession(archiveConfig, id)
		if err != nil {
			return "", err
		}
		history, checkpoint = restored.Messages, restored.Checkpoint
		originalInputRecorded = restored.WorkspaceGeneration == record.Generation && restored.GenerationInput
		retryReplyOnly = record.ChatRetryAttempt > 0 && restored.WorkspaceGeneration == record.Generation && restored.GenerationMutation
		plan = &restored.Plan
		restoredGeneration = restored.WorkspaceGeneration
		restoredCompaction = restored.Compaction
		providerState = restored.ContextProvider
		identityRestored = restored
	} else {
		if statErr != nil && !os.IsNotExist(statErr) {
			return "", statErr
		}
		archive = &SessionArchive{Path: path}
		if err = archive.Start(spec.ModelID); err != nil {
			archive.Close()
			return "", err
		}
	}
	defer archive.Close()
	if privateMemory {
		key := memoryWorkspace.transcriptKey(id)
		// Backfill pre-upgrade archives through the same idempotent outbox.
		memoryWorkspace.transcribe(transcriptRows(key, 0, history, m.redact))
		archive.observe = memoryWorkspace.transcriptObserver(key, m.redact)
		archive.observed = len(history)
		defer memoryWorkspace.flushTranscript(3 * time.Second)
	}
	maintenance := &contextCompaction{last: cloneCompaction(restoredCompaction)}
	defer func() {
		if err := m.settleConversationCompaction(job, maintenance, runErr, true); err != nil && runErr == nil {
			runErr = err
		}
	}()
	ctx = context.WithValue(ctx, contextCompactionKey{}, maintenance)
	if m.workspace != nil && spec.WorkspaceRole == WorkspaceMatrix {
		m.workspace.mu.Lock()
		m.workspace.compaction = maintenance
		m.workspace.mu.Unlock()
	}
	defer func() {
		if compactionPending(maintenance.snapshot()) {
			state := "interrupted"
			if ctx.Err() != nil {
				state = "cancelled"
			}
			if e := maintenance.record(archive, state, "RUN_ENDED_BEFORE_COMMIT"); e != nil && runErr == nil {
				runErr = e
			}
		}
	}()
	ctx = context.WithValue(ctx, archiveMemoryKey{}, archive.Path)
	if archive.ephemeral {
		ctx = context.WithValue(ctx, ephemeralArchiveKey{}, archive)
	}
	ctx = context.WithValue(ctx, workflowContextKey{}, workflowContext{plan, id, record.Generation})
	if spec.WorkspaceRole == "" {
		if plan.State != nil && restoredGeneration > 0 && restoredGeneration < record.Generation {
			plan.PriorTaskID = plan.State.ID
		}
		m.publishTaskPlan(job, record.Generation, plan.State)
	}
	if m.workspace != nil && spec.WorkspaceRole == WorkspaceMatrix {
		// Bind against the persisted prior generation before receipt recovery can
		// refresh the workflow projection to this generation.
		m.workspace.bindPlanTaskBoundary(plan, id, record.Generation)
		if err = m.workspace.syncWorkflow(plan, id, record.Generation); err != nil {
			return "", err
		}
	}
	shell, err := m.shellForRun(job, record)
	if err != nil {
		return "", err
	}
	defer func() {
		// Explicit background sessions belong to this agent's lifetime. A failed
		// or cancelled turn still cancels its entire runtime; a normal pause or
		// reply does not silently kill a deliberately retained terminal.
		if ctx.Err() != nil || runErr != nil && runErr != errHumanWaiting {
			shell.CancelAll()
		}
	}()
	toolbox := RestoreToolbox(history)
	ctx = WithProviderSession(ctx, id)
	ctx = WithToolPermissions(ctx, spec.Tools)
	if spec.Kind == "conversation" {
		ctx = context.WithValue(ctx, liveToolPermissionKey{}, func(name string) bool {
			return m.currentConversationToolAllowed(record, name)
		})
	}
	ctx = WithToolbox(ctx, toolbox, m.config)
	ctx = WithSettingsService(ctx, m.service, id)
	ctx = m.withProgramAgent(ctx, record)
	ctx = WithAgentManager(ctx, m, id, shell)
	ctx = context.WithValue(ctx, conversationLinkCallerKey{}, conversationLinkCaller{ID: id, Generation: record.Generation})
	if m.primaryCoreLink(record) {
		if err := m.workspace.resumeCoreLink(record); err != nil {
			return "", err
		}
		identity = &motherIdentity{w: m.workspace, record: record, archive: archive, receipts: map[string]*motherIdentityState{}}
		if identityRestored != nil {
			identity.state = cloneMotherIdentity(identityRestored.MotherIdentity)
			for key, value := range identityRestored.MotherIdentities {
				identity.receipts[key] = cloneMotherIdentity(value)
			}
		}
		if err := identity.recover(); err != nil {
			return "", err
		}
		m.workspace.mu.Lock()
		m.workspace.identity = identity
		m.workspace.mu.Unlock()
		ctx = context.WithValue(ctx, motherIdentityKey{}, identity)
		ctx = context.WithValue(ctx, liveToolPermissionKey{}, identity.allowed)
		defer func() {
			outcome := "RUN_ENDED"
			if runErr != nil {
				outcome = "RUN_INTERRUPTED: " + m.redact(runErr.Error())
				shell.CancelAll()
			}
			if err := identity.finish(outcome); err != nil {
				runErr = fmt.Errorf("身份退出记录未提交，原交接保留：%w", err)
			}
		}()
	}
	// resumeCoreLink has now bound the actual runtime to its persistent scope.
	// Keep that scope across normal reopen instead of repartitioning the cache
	// by a newly allocated executor ID. Do not change tool caller identity.
	m.mu.Lock()
	providerSession := providerSessionIdentity(job.record)
	m.mu.Unlock()
	ctx = WithProviderSession(ctx, providerSession)
	linkCatalog := m.linkCatalog(record)
	toolRole := spec.WorkspaceRole
	if spec.Kind == "conversation" {
		if c, e := m.contactOf(record); e == nil {
			toolRole = c.Builtin
		}
	}
	ctx = context.WithValue(ctx, toolDefinitionRoleKey{}, toolRole)
	if m.workspace != nil {
		ctx = context.WithValue(ctx, workspaceContextKey{}, workspaceContext{m.workspace, spec.WorkspaceRole})
	}
	if privateMemory {
		// Matrix here is the role within this independent memory workspace; the
		// Agent still has only its explicit package capabilities, no primary host.
		// Memory/PAC use this private workspace; general host tools retain the
		// shared SettingsService above, including the live embedded browser.
		ctx = context.WithValue(ctx, workspaceContextKey{}, workspaceContext{memoryWorkspace, WorkspaceMatrix})
	}
	if packageRuntime {
		ctx = context.WithValue(ctx, packageRuntimeKey{}, packageRuntimeContext{manager: m, record: record})
	}
	if m.workspace.isTerminal() {
		for name := range toolbox.Open {
			if !toolAllowed(ctx, name) {
				delete(toolbox.Open, name)
				delete(toolbox.Manuals, name)
			}
		}
	}
	if err = archive.Append("meta", map[string]any{"workspace_generation": record.Generation, "workspace_agent": id}); err != nil {
		return "", err
	}
	if !maintenanceOnly && (packageRuntime || spec.Kind == "conversation") {
		m.resumeLinkInbox(record)
		added, e := m.drainPackageMessagesBefore(id, archive, history, record.Generation)
		if e != nil {
			return "", e
		}
		history = append(history, added...)
	}
	input := Message{Role: RoleUser, Content: message, Images: inputImages}
	for key := range record.TurnOrigins {
		if record.TurnGenerations[key] == record.Generation && record.Turns[key] == message {
			input.Name = "core-link-" + workflowHash(key)
			break
		}
	}
	if !maintenanceOnly && (record.ChatRetryAttempt == 0 || !originalInputRecorded) {
		if err = archive.Append("message", input); err != nil {
			return "", err
		}
		history = append(history, input)
	}
	turnReceiptStart := len(history)
	observedProgramWaits := map[programResultTarget]bool{}
	var sealedReceiptCheckpoint *Checkpoint
	var sealedReceipts Message
	m.mu.Lock()
	if checkpoint != nil {
		job.record.Compression = checkpoint.Compression
	}
	m.advanceHumanLocked(job, "decision_recorded", "delivered_to_agent")
	err = m.saveLocked(job)
	m.mu.Unlock()
	if err != nil {
		return "", err
	}
	conv := history
	if checkpoint != nil {
		conv = history[min(checkpoint.Covered, len(history)):]
	}
	var meter TokenMeter
	meterProvider := ""
	continuityEpoch := int64(-1)
	if m.workspace != nil && m.workspace.Mode().unified() && spec.WorkspaceRole == WorkspaceMatrix {
		if snapshot, e := m.workspace.readContinuity(ctx); e == nil {
			continuityEpoch = snapshot.Epoch
		}
	}
	surface := ""
	forum := ""
	if m.workspace != nil && spec.WorkspaceRole == WorkspaceMatrix {
		if !m.workspace.Mode().unified() {
			surface = m.workspace.memorySurface(ctx, message)
		}
		forum = m.workspace.forumSurface(ctx)
	}
	notice := ""
	workingFloor := 0
	deliveryRetries := 0
	pendingDeliveryRetries := 0
	pendingNoticeActive := false
	var outputRecovery outputContinuation
	// 本轮里 Eyra 最后说过的一段话（带工具调用的回复里的正文）。模型常常在过程中已经把结果说完，最后只结束、不再写字；
	// 这时用这段话作为本轮的回复，而不是把一轮正常结束的工作报成“任务中断，原因待核实”（用户 2026-10-13）。
	lastSaid, emptyNudged := "", false
	// 用户盯着实时显示。连续几轮只调工具不说话，界面就像卡住了，提醒一次。
	silentRounds := 0
	compactRetryAfter := 0
	var fastSnap pacSnapshot
	fastLoaded := false
	pacRecovered := false
	for {
		if err = ctx.Err(); err != nil {
			return "", err
		}
		if err = m.settleConversationCompaction(job, maintenance, nil, false); err != nil {
			return "", err
		}
		if maintenanceOnly && m.conversationMaintenanceDone(job) {
			return "", nil
		}
		if identity != nil {
			if err = identity.boundary(checkpoint, maintenance); err != nil {
				return "", err
			}
			tools := m.workspace.permissions(spec.WorkspaceRole)
			if identity.active() {
				tools = identity.snapshot().Tools
			}
			ctx = WithToolPermissions(ctx, tools)
			for name := range toolbox.Open {
				if !toolAllowed(ctx, name) {
					delete(toolbox.Open, name)
					delete(toolbox.Manuals, name)
				}
			}
		}
		if m.workspace != nil {
			if err = m.workspace.splitStationBoundary(ctx, "working"); err != nil {
				return "", err
			}
		}
		if m.workspace != nil && spec.WorkspaceRole != "" {
			added, e := m.workspace.drain(spec.WorkspaceRole, archive, history)
			if e != nil {
				return "", e
			}
			if len(added) > 0 {
				// A new inbox message can change the outcome after the model last spoke.
				lastSaid = ""
			}
			if silentRounds >= silentRoundsLimit {
				silentRounds = 0
				hint := Message{Role: RoleUser, Name: "narration_" + workspaceID()[:12], Content: runtimePrompt("Matrix/辅助指令/继续说明进展.txt")}
				if e := archive.Append("message", hint); e != nil {
					return "", e
				}
				added = append(added, hint)
			}
			history = append(history, added...)
			conv = append(conv, added...)
			if len(added) > 0 {
				outputRecovery.partialText = ""
			}
		}
		if !maintenanceOnly && (packageRuntime || spec.Kind == "conversation") {
			added, e := m.drainPackageMessages(id, archive, history)
			if e != nil {
				return "", e
			}
			history = append(history, added...)
			conv = append(conv, added...)
		}
		if m.workspace != nil && spec.WorkspaceRole != "" && !identity.active() {
			m.workspace.mu.Lock()
			selected, selectErr := m.workspace.modelLocked(spec.WorkspaceRole)
			m.workspace.mu.Unlock()
			if selectErr != nil {
				return "", selectErr
			}
			if selected != "" && selected != spec.ModelID {
				meter = TokenMeter{}
				workingFloor = 0
				compactRetryAfter = 0
				// A thinking choice belongs to the model it was made for.
				spec.ModelID, spec.ModelParameters = selected, nil
				m.mu.Lock()
				job.record.Spec.ModelID, job.record.Spec.ModelParameters = selected, nil
				e := m.saveLocked(job)
				m.mu.Unlock()
				if e != nil {
					return "", e
				}
			}
		}
		settings, e := requestSettings()
		if e != nil {
			return "", e
		}
		startupPending := false
		requestCheckpoint := checkpoint
		if m.workspace != nil && spec.WorkspaceRole == WorkspaceMatrix {
			next, _, pending := m.workspace.startupBoundary(id, history, checkpoint)
			if pending && EstimateMessages(history) >= settings.ContextBudget().InputLimit()-2048 {
				m.workspace.mu.Lock()
				done := m.workspace.startupDone
				m.workspace.mu.Unlock()
				if done != nil {
					select {
					case <-done:
					case <-ctx.Done():
						return "", ctx.Err()
					}
				}
				next, _, pending = m.workspace.startupBoundary(id, history, checkpoint)
			}
			startupPending = pending
			if next != checkpoint {
				next.Plan = ClonePlan(plan.State)
				if err = archive.Append("checkpoint", next); err != nil {
					return "", err
				}
				checkpoint = next
				m.mu.Lock()
				job.record.Compression = checkpoint.Compression
				err = m.saveLocked(job)
				m.mu.Unlock()
				if err != nil {
					return "", err
				}
				meter = TokenMeter{}
			}
			requestCheckpoint = checkpoint
			floor := 0
			if checkpoint != nil {
				floor = min(checkpoint.Covered, len(history))
			}
			conv = history[floor:]
		}
		outputRecovery.apply(settings, spec.ModelParameters)
		memoryAvailable := spec.WorkflowID == "" && memoryWorkspace != nil && (privateMemory && settings.MemoryEnabled || !privateMemory && memoryWorkspace.fastMemoryOn(settings, spec.WorkspaceRole))
		if strategy == nil {
			ref := legacyContextProvider(memoryAvailable)
			if spec.ContextProvider != nil {
				ref = *spec.ContextProvider
			}
			if providerState != nil {
				if spec.ContextProvider != nil && *spec.ContextProvider != providerState.Provider {
					return "", fmt.Errorf("上下文提供者已锁定，请先迁移会话")
				}
				ref = providerState.Provider
			}
			strategy, e = resolveContextProvider(ref, m.config)
			if e != nil {
				return "", e
			}
		}
		if strategy.Describe().Storage == "memory" && !memoryAvailable {
			return "", fmt.Errorf("已锁定的上下文提供者需要记忆服务；原档案已保留")
		}
		fastOn := memoryAvailable && strategy.Describe().Storage == "memory"
		// 同一永久记忆目录，旧团队只读权限仍由阶段开关控制。
		fastShared := spec.WorkflowID == "" && !fastOn && (memoryAvailable || memoryWorkspace != nil && memoryWorkspace.fastMemoryShared(settings, spec.WorkspaceRole))
		if (fastOn || fastShared) && !fastLoaded {
			fastSnap, err = memoryWorkspace.readPAC(ctx)
			if err != nil {
				return "", fmt.Errorf("PAC加载失败，原上下文保留: %w", err)
			}
			fastLoaded = true
		} else if fastOn || fastShared {
			if e := memoryWorkspace.refreshPACProfile(ctx, &fastSnap); e != nil {
				return "", fmt.Errorf("当前偏好读取失败，原上下文保留: %w", e)
			}
		}
		if fastOn && !pacRecovered {
			cp, e := memoryWorkspace.recoverPAC(ctx, id, history, checkpoint, plan.State)
			if e != nil {
				return "", e
			}
			if cp != nil {
				if err = m.commitContextCheckpoint(ctx, job, archive, cp, maintenance, "recovery"); err != nil {
					return "", err
				}
				checkpoint, requestCheckpoint, conv = cp, cp, history[cp.Covered:]
			}
			pacRecovered = true
		}
		if restoredCompaction != nil {
			if compactionPending(maintenance.snapshot()) {
				if err = maintenance.record(archive, "interrupted", "PREVIOUS_RUN_INTERRUPTED"); err != nil {
					return "", err
				}
			}
			restoredCompaction = nil
		}
		if err = m.adoptConversationCompaction(job, archive, maintenance); err != nil {
			return "", err
		}
		// 同一配置ID可重新接入不同通道；旧usage与压缩预算不能跨通道沿用。
		if provider := settings.ProviderIdentity(); provider != meterProvider {
			meter = TokenMeter{}
			workingFloor = 0
			compactRetryAfter = 0
			meterProvider = provider
		}
		if !packageRuntime && spec.AgentPackage == "" && spec.WorkspaceRole == "" && spec.Kind != "conversation" {
			spec.Prompt, e = loadChildPrompt(m.config, id, spec.Prompt)
			if e != nil {
				return "", e
			}
		} else if m.workspace != nil && m.workspace.teamHost() && spec.WorkspaceRole != "" && spec.WorkspaceRole != WorkspaceMatrix {
			spec.Prompt = teamRolePrompt(spec.WorkspaceRole)
		} else if identity.active() {
			spec.Prompt = identity.snapshot().Prompt
		} else if m.workspace != nil && spec.WorkspaceRole != "" {
			spec.Prompt, e = m.workspace.requestPrompt(settings)
			if e != nil {
				return "", e
			}
		}
		// One immutable package snapshot describes this request's tools and
		// discovery text. Never attach it to the execution context: every actual
		// invocation and the next request must still observe revocation.
		definitionCtx := withOfficialToolAdmission(ctx)
		var definitions []ToolDefinition
		if spec.Kind != "conversation" {
			definitions = filterSubconsciousTools(FilterToolDefinitions(definitionCtx, CodingToolDefinitions(settings)), false, false)
		}
		request := []Message{{Role: RoleSystem, Name: "matrix_assignment", Content: spec.Prompt}}
		observations := []Message{{Role: RoleSystem, Name: "aieyra_shell_runtime", Content: shell.Environment()}}
		if !SupportsToolImages(settings) {
			for _, attachment := range attachments {
				if attachment.Kind == "image" {
					observations = append(observations, Message{Role: RoleSystem, Name: "attachment_observation", Content: runtimePrompt("子代/模板/附件未观察.txt")})
					break
				}
			}
		}
		if identity.active() {
			v := identity.snapshot()
			for i, d := range definitions {
				if d.Name == "agents" {
					definitions[i] = motherIdentityControlDefinition()
				}
			}
			observations = append(observations, Message{Role: RoleSystem, Name: "mother_identity_handoff", Content: runtimePrompt("Matrix/辅助指令/母体专业身份.txt") + "\n" + string(rawJSON(identityHandoff(v)))})
		}
		if spec.Kind == "conversation" {
			// Chat contacts keep search, vision and intrinsic collaboration;
			// working contacts add only their assigned tools.
			definitions = conversationToolDefinitions(definitionCtx, settings, spec.Tools)
			request = []Message{{Role: RoleSystem, Name: "conversation_identity", Content: spec.Prompt}}
			observations = nil
			if _, program := ctx.Value(programAgentContextKey{}).(programAgentContext); program || conversationWorks(spec.Tools) {
				observations = append(observations, Message{Role: RoleSystem, Name: "aieyra_shell_runtime", Content: shell.Environment()})
				request = append(request, Message{Role: RoleSystem, Name: "conversation_work", Content: runtimePrompt("子代/模板/工作.txt")})
			}
			// Old archives may still call agents link_*. Keep that dispatcher
			// alias, but expose only core_link so the schema is not sent twice.
			if linkCatalog != "" {
				observations = append(observations, Message{Role: RoleSystem, Name: "core_link_catalog", Content: linkCatalog})
			}
			if slices.Contains(spec.Tools, "group") {
				definitions = append(definitions, GroupToolDefinition())
			}
		}
		if m.coreLinkCapable(record) {
			definitions = append(definitions, CoreCollaborationToolDefinition(m.primaryCoreLink(record)))
			if spec.Kind != "conversation" && linkCatalog != "" {
				observations = append(observations, Message{Role: RoleSystem, Name: "core_link_catalog", Content: linkCatalog})
			}
		}
		if toolboxAvailable(definitionCtx) {
			observations = append(observations, Message{Role: RoleSystem, Name: "aieyra_toolbox_catalogue", Content: workspaceToolboxCatalog(definitionCtx)})
		}
		if m.workspace != nil && spec.WorkspaceRole == "" && spec.WorkflowID == "" {
			base, e := m.workspace.requestPrompt(settings)
			if e != nil {
				return "", e
			}
			request = append([]Message{{Role: RoleSystem, Name: "shared_baseline", Content: base}}, request...)
			request = append(request, Message{Role: RoleSystem, Name: "matrix_child_contract", Content: runtimePrompt("Matrix/辅助指令/子代执行.txt")})
		}
		if spec.WorkspaceRole != "" && !identity.active() {
			contract := workspaceRoleContract(spec.WorkspaceRole)
			if m.workspace != nil {
				contract = m.workspace.roleContract(spec.WorkspaceRole)
			}
			request = append(request, Message{Role: RoleSystem, Name: "workspace_role_contract", Content: contract})
			if spec.WorkspaceRole == WorkspaceMatrix && m.workspace != nil {
				if data := m.workspace.splitStationData(); data != "" {
					observations = append(observations, Message{Role: RoleUser, Name: "station_reference", Content: runtimePrompt("Matrix/辅助指令/工位参考.txt") + data})
				}
			}
			if spec.WorkspaceRole == WorkspaceMatrix && m.workspace != nil {
				if reference := m.workspace.capabilityReference(); reference != "" {
					observations = append(observations, Message{Role: RoleUser, Name: "capability_reference", Content: reference})
				}
			}
			if contract := companionContract(m.workspace.teamHost()); contract != "" && !m.workspace.isTerminal() && (spec.WorkspaceRole == WorkspaceMatrix || !m.workspace.teamHost()) {
				request = append(request, Message{Role: RoleSystem, Name: "canvas_communication", Content: contract})
			}
			if m.workspace != nil {
				if spec.WorkspaceRole == WorkspaceMatrix {
					if forum != "" {
						observations = append(observations, Message{Role: RoleUser, Name: "matrix_home_navigation", Content: runtimePrompt("Matrix/辅助指令/社区导航.txt") + forum})
					}
				}
				if profile := m.workspace.profileContext(); profile != "" && (spec.WorkspaceRole == WorkspaceMatrix || !m.workspace.teamHost()) {
					observations = append(observations, Message{Role: RoleSystem, Name: "user_display_profile", Content: profile})
				}
			}
		}
		if spec.Contract != nil {
			contract, _ := json.Marshal(spec.Contract)
			request = append(request, Message{Role: RoleSystem, Name: "matrix_contract", Content: runtimePrompt("Matrix/运行协定/任务验收.txt") + string(contract)})
		}
		// PAC目录在阶段边界之间保持稳定；厂商缓存是否命中仍取决于其TTL和调度。
		if fastOn || fastShared {
			if block := renderPAC(fastSnap, 10000); block != "" {
				observations = append(observations, Message{Role: RoleUser, Name: "pac_memory", Content: block})
			}
		}
		if settings.MemoryEnabled && spec.WorkspaceRole == WorkspaceMatrix {
			// 记忆合同要求调用 memory 工具；基础工具模式里没有这个工具，只留检索出的表层记忆作数据，不给矛盾的指令。
			if toolAllowed(ctx, "memory") {
				contract := memoryContract()
				if !m.workspace.isTerminal() {
					contract += memorySettingsContract()
				}
				request = append(request, Message{Role: RoleSystem, Name: "memory_runtime_contract", Content: contract})
			}
			if surface != "" && !memoryAvailable {
				observations = append(observations, Message{Role: RoleUser, Name: "memory_surface", Content: runtimePrompt("Matrix/记忆/检索结果前缀.txt") + surface})
			}
		}
		request, definitions = modelRuntimePrefix(settings, request, definitions)
		// A seal replaces the covered conversation. Keep the fixed model/tool
		// instructions ahead of it, including text-only transport capabilities.
		if requestCheckpoint != nil {
			request = append(request, requestCheckpoint.Message())
		}
		if retryReplyOnly {
			definitions = nil
		}
		textOnly := requestProfile(settings, false).TextOnly
		convStart := len(request)
		request = strategy.Assemble(request, conv)
		// Reopening changes the prior generation, not the saved conversation.
		// Keep its runtime explanation after history for the same reason as the
		// current workflow revision below.
		if spec.WorkspaceRole != "" && !identity.active() && m.workspace != nil && m.workspace.priorGeneration > 0 {
			observations = append(observations, Message{Role: RoleSystem, Name: "startup_history_boundary", Content: formatPromptText(runtimePrompt("Matrix/辅助指令/重启后的历史.txt"), m.workspace.priorGeneration)})
		}
		// Current task revisions belong after conversation history so changing
		// one workflow record preserves the stable model/tool/history prefix.
		if spec.WorkspaceRole == WorkspaceMatrix && !identity.active() && m.workspace != nil {
			if task := m.workspace.workflowNotice(); task != "" && workflowAvailable(ctx) {
				observations = append(observations, Message{Role: RoleUser, Name: "persistent_task_state", Content: runtimePrompt("Matrix/辅助指令/宿主持久记录.txt") + task})
			}
		}
		if identity != nil && !identity.active() && identity.snapshot() != nil {
			observations = append(observations, Message{Role: RoleSystem, Name: "mother_identity_result", Content: string(rawJSON(identityHandoff(identity.snapshot())))})
		}
		if !SupportsToolImages(settings) {
			request = conversationTextProjection(request)
		}
		// 任务边界只在"新一轮、旧计划还在"时出现。放在对话之后，不打断前面固定提示词与历史的缓存前缀（AIDEBUG 实测放在前面时跨轮缓存掉一半）。
		if plan.PriorTaskID != "" {
			observations = append(observations, Message{Role: RoleSystem, Name: "plan_task_boundary", Content: runtimePrompt("Matrix/辅助指令/旧计划边界.txt")})
		}
		// Unified memory uses the current canonical projection below. A separate
		// cached surface could reintroduce preferences corrected during this run.
		if details := toolbox.Details(); details != "" && !textOnly {
			observations = append(observations, Message{Role: RoleSystem, Name: "aieyra_toolbox_open", Content: details})
		}
		if notice != "" {
			observations = append(observations, Message{Role: RoleSystem, Name: "aieyra_runtime_result", Content: notice})
		}
		if outputRecovery.notice != "" {
			observations = append(observations, Message{Role: RoleSystem, Name: "output_continuation", Content: outputRecovery.notice})
		}
		if fastOn || fastShared {
			if profile := renderPACProfile(fastSnap); profile != "" {
				observations = append(observations, Message{Role: RoleUser, Name: "current_memory_profile", Content: profile})
			}
			if fastSnap.MergeRecommended && fastOn && !textOnly {
				observations = append(observations, Message{Role: RoleSystem, Name: "pac_merge_boundary", Content: runtimePrompt("Matrix/记忆/PAC合并.txt")})
			}
		}
		if fastOn {
			observations = append(observations, Message{Role: RoleSystem, Name: "aieyra_clock", Content: fastClock(time.Now())})
		}
		if retained := shell.BackgroundNotice(); retained != "" && !textOnly {
			observations = append(observations, Message{Role: RoleSystem, Name: "aieyra_background_sessions", Content: retained})
		}
		m.mu.Lock()
		remaining := job.record.Spec.MaxTokens - (job.record.AccountedTokens - job.record.TurnTokenBase)
		limited := job.record.Spec.MaxTokens > 0 && remaining < job.record.Spec.MaxTokens/5
		m.mu.Unlock()
		if limited {
			observations = append(observations, Message{Role: RoleSystem, Name: "task_budget_notice", Content: formatPromptText(runtimePrompt("Matrix/辅助指令/累计任务预算.txt"), max(0, remaining))})
		}
		if spec.WorkspaceRole == WorkspaceMatrix && !identity.active() && m.workspace != nil {
			if state := m.workspace.situation(ctx, id); state != "" {
				observations = append(observations, Message{Role: RoleUser, Name: "aieyra_situation", Content: state})
			}
		}
		dynamicStart := len(request)
		contextUpdate := runtimeContextDelta(conv, observations)
		request = append(request, contextUpdate.Messages...)
		definitionJSON, _ := json.Marshal(definitions)
		budget := settings.ContextBudget()
		estimate := strategy.Evaluate(budget, append([]Message{{Role: RoleSystem, Content: string(definitionJSON)}}, request...), &meter).Tokens
		if fastOn {
			budget = pacContextBudget(settings)
		}
		if workingFloor > budget.WorkingLimit() {
			budget.Working = min(workingFloor, budget.InputLimit())
		}
		// A tiny completed exchange costs more to summarize than to retain.
		// Give fixed instructions and the next tool round room before compacting.
		keepTurns := settings.CompactKeepTurns
		if fastOn {
			keepTurns = fastKeepTurns
		}
		cut := strategy.Cut(conv, keepTurns, estimate >= budget.InputLimit()-2048, RecallPrefix())
		compactSource := compactSourceTokens(checkpoint, conv[:cut])
		canCompact := !startupPending && cut > 0 && budget.CompactionReady(compactSource, compactRequiredTokens(checkpoint, conv[:cut], plan.State), compactRetryAfter, estimate)
		// Editing changes the cached memory prefix. Explicit preparation tries
		// the latest complete tool boundary even below the automatic threshold.
		if pending := maintenance.snapshot(); compactionPending(pending) && (pending.Purpose == "memory_edit" || pending.Purpose == "identity_enter" || pending.Purpose == "mother_maintenance") {
			cut = strategy.Cut(conv, keepTurns, true, RecallPrefix())
			if pending.Purpose == "identity_enter" {
				cut = len(conv)
			}
			compactSource = compactSourceTokens(checkpoint, conv[:cut])
			canCompact = !startupPending && cut > 0
		}
		if !canCompact {
			budget = budget.AccommodateRequiredInput(estimate)
			workingFloor = budget.WorkingLimit()
		}
		m.mu.Lock()
		capacitySource := "configuration"
		if p := settings.activePoolProfile(); p != nil {
			capacitySource = p.ContextWindowSource
		}
		providerRef := strategy.Describe().Reference
		job.record.Context = &AgentContext{Provider: &providerRef, Tokens: estimate, Window: budget.WorkingLimit(), ModelWindow: budget.Window, Target: settings.ContextBudget().Working, Threshold: budget.Threshold(), InputLimit: budget.InputLimit(), CapacitySource: capacitySource}
		m.mu.Unlock()
		if compactionPending(maintenance.snapshot()) || budget.Percent > 0 && estimate >= budget.Threshold() {
			if canCompact {
				if err = maintenance.begin(archive, len(history)-len(conv), len(history)-len(conv)+cut); err != nil {
					return "", err
				}
			}
			{
				if canCompact && fastOn {
					// 保留主请求的公共前缀，追加封存指令；不承诺厂商缓存始终命中。
					floor := len(history) - len(conv)
					segmentText := ""
					var segment string
					candidate, compactErr := strategy.Compact(ctx, contextprovider.Input{Prefix: request[:convStart+cut], Instruction: fastCompactInstruction()}, func(c context.Context, req []Message) (Message, string, error) {
						answer, _, e := m.agentRequest(c, job, fastCompactSettings(settings), req, definitions, "compact")
						return answer, answer.FinishReason, e
					})
					segmentText = candidate.PacketText
					notSmaller := compactErr == nil && pacCheckpoint(checkpoint, history, floor, floor+cut, strings.Repeat("p", 80), segmentText, plan.State).Compression.AfterTokens >= compactSource
					if notSmaller {
						compactErr = fmt.Errorf("PAC摘要未缩短上下文，保留原文并延后重试")
					}
					if compactErr == nil {
						compactErr = ctx.Err()
					}
					if compactErr == nil {
						segment, compactErr = memoryWorkspace.sealPAC(ctx, id, history, floor, floor+cut, "工作上下文检查点", segmentText, "工作进度 决策 文件 未完成事项")
					}
					if compactErr != nil {
						if compactionMustStop(ctx, compactErr, estimate, budget.InputLimit()) {
							state := "failed"
							if ctx.Err() != nil {
								state = "cancelled"
							}
							if err = maintenance.record(archive, state, "SUMMARY_FAILED"); err != nil {
								return "", err
							}
							return "", compactErr
						}
						state, code := "deferred", "SUMMARY_UNAVAILABLE"
						if notSmaller {
							state, code = "skipped", "NOT_SMALLER"
						}
						if err = maintenance.record(archive, state, code); err != nil {
							return "", err
						}
						compactRetryAfter = budget.CompactionRetryAfter(compactSource)
						notice = runtimePrompt("Matrix/辅助指令/记忆压缩暂不可用.txt")
						if err = archive.Append("compaction_deferred", map[string]any{"generation": record.Generation, "error": m.redact(compactErr.Error()), "tokens": estimate}); err != nil {
							return "", err
						}
					} else {
						cp := pacCheckpoint(checkpoint, history, floor, floor+cut, segment, segmentText, plan.State)
						after := cp.Compression.AfterTokens
						cp.Compression.BeforeTokens = compactSource
						if err = m.commitContextCheckpoint(ctx, job, archive, cp, maintenance, "seal"); err != nil {
							return "", err
						}
						maintenance.allowMemoryEdit()
						if snap, e := memoryWorkspace.readPAC(ctx); e == nil {
							fastSnap = snap
						} else {
							return "", e
						}
						checkpoint, conv = cp, conv[cut:]
						compactRetryAfter = budget.CompactionRetryAfter(after)
						meter.Prefix, meter.PromptTokens = nil, 0
						notice = "较早的完整对话已保存为PAC，可按ID取回原文；最近原文和未完成计划保留。"
						continue
					}
				} else if canCompact {
					snapshot := compactionSettings(settings)
					summarize := func(c context.Context, req []Message) (Message, string, error) {
						if EstimateMessages(req) > snapshot.ContextBudget().InputLimit() {
							return Message{}, "", fmt.Errorf("compaction input exceeds model window; archive retained")
						}
						answer, _, e := m.agentRequest(c, job, snapshot, req, nil, "compact")
						return answer, answer.FinishReason, e
					}
					var cp *Checkpoint
					var compactErr error
					cp, compactErr = compactWithProvider(ctx, strategy, checkpoint, conv[:cut], summarize)
					if compactErr != nil {
						if compactionMustStop(ctx, compactErr, estimate, budget.InputLimit()) {
							state := "failed"
							if ctx.Err() != nil {
								state = "cancelled"
							}
							if err = maintenance.record(archive, state, "SUMMARY_FAILED"); err != nil {
								return "", err
							}
							return "", compactErr
						}
						if err = maintenance.record(archive, "deferred", "SUMMARY_UNAVAILABLE"); err != nil {
							return "", err
						}
						// Compression is maintenance. A failed summary never discards
						// exact context or prevents work that still fits the input limit.
						compactRetryAfter = budget.CompactionRetryAfter(compactSource)
						notice = runtimePrompt("Matrix/辅助指令/上下文摘要暂不可用.txt")
						if err = archive.Append("compaction_deferred", map[string]any{"generation": record.Generation, "error": m.redact(compactErr.Error()), "tokens": estimate}); err != nil {
							return "", err
						}
					} else {
						cp.Plan = ClonePlan(plan.State)
						before := compactSource
						after := EstimateMessages([]Message{cp.Message()})
						if after >= before {
							// A valid but larger summary is not a task failure. Retain exact
							// context and defer another attempt until meaningful growth.
							compactRetryAfter = budget.CompactionRetryAfter(before)
							budget = budget.AccommodateRequiredInput(estimate)
							workingFloor = budget.WorkingLimit()
							notice = runtimePrompt("Matrix/辅助指令/摘要未减少上下文.txt")
							if err = maintenance.record(archive, "skipped", "NOT_SMALLER"); err != nil {
								return "", err
							}
						} else {
							cp.Compression = &ContextCompression{BeforeTokens: before, AfterTokens: after}
							if err = m.commitContextCheckpoint(ctx, job, archive, cp, maintenance, "seal"); err != nil {
								return "", err
							}
							maintenance.allowMemoryEdit()
							checkpoint, conv = cp, conv[cut:]
							// Do not immediately summarize the checkpoint just produced.
							// Wait for meaningful new history even if fixed input stays large.
							compactRetryAfter = budget.CompactionRetryAfter(after)
							meter.Prefix, meter.PromptTokens = nil, 0
							if settings.MemoryEnabled && m.workspace != nil && spec.WorkspaceRole == WorkspaceMatrix && !m.workspace.Mode().unified() {
								m.workspace.rememberEpisode(ctx, fmt.Sprintf("checkpoint:%s:%d", id, cp.Covered), "任务检查点", string(rawJSON(cp.Summary)))
							}
							notice = "Context checkpoint committed; original archive retained."
							continue
						}
					}
				}
				if !canCompact {
					if compactionPending(maintenance.snapshot()) {
						if err = maintenance.record(archive, "skipped", "NO_ELIGIBLE_HISTORY"); err != nil {
							return "", err
						}
					}
					notice = "No useful completed history eligible for compaction; original user input retained."
				}
			}
		}
		if outcome := maintenance.snapshot(); outcome != nil {
			observations = append(observations, compactionOutcomeMessage(outcome))
		}
		if err = m.settleConversationCompaction(job, maintenance, nil, false); err != nil {
			return "", err
		}
		if maintenanceOnly && m.conversationMaintenanceDone(job) {
			return "", nil
		}
		contextUpdate = runtimeContextDelta(conv, observations)
		request = append(request[:dynamicStart], contextUpdate.Messages...)
		definitionMessage := Message{Role: RoleSystem, Content: string(definitionJSON)}
		estimate = meter.Estimate(append([]Message{definitionMessage}, request...))
		if requestCheckpoint == sealedReceiptCheckpoint && sealedReceipts.Content != "" {
			withReceipts := append(request, sealedReceipts)
			if withEstimate := meter.Estimate(append([]Message{definitionMessage}, withReceipts...)); withEstimate <= budget.InputLimit() {
				request, estimate = withReceipts, withEstimate
			}
		}
		m.mu.Lock()
		job.record.Context.Tokens = estimate
		m.mu.Unlock()
		if estimate > budget.InputLimit() {
			return "", fmt.Errorf("context budget exhausted; hand off a smaller task or explicitly continue after inspection")
		}
		if err = ctx.Err(); err != nil {
			return "", err
		}
		if len(contextUpdate.Messages) > 0 {
			if err = contextUpdate.validate(); err != nil {
				return "", err
			}
			// Commit exactly the observations about to be sent, at a complete tool
			// boundary. Recovery reuses them; later polls never replace this prefix.
			if err = archive.Append("runtime_context", contextUpdate); err != nil {
				return "", err
			}
			history = append(history, contextUpdate.Messages...)
			conv = append(conv, contextUpdate.Messages...)
		}
		answer, usage, requestErr := m.agentRequest(ctx, job, settings, request, definitions, "model")
		if requestErr != nil {
			if answer.Content != "" || answer.ReasoningContent != "" || len(answer.ToolCalls)+len(answer.IncompleteTools) > 0 || answer.ResponseID != "" {
				// Deliberately not a message/tool_turn: recovery must never execute
				// tool calls from a response rejected by an explicit budget.
				if e := archive.Append("unexecuted_response", map[string]any{"generation": record.Generation, "error": m.redact(requestErr.Error()), "finish_reason": answer.FinishReason, "message": answer}); e != nil {
					return answer.Content, fmt.Errorf("%v; response archive failed: %w", requestErr, e)
				}
			}
			var output *OutputLimitError
			if errors.As(requestErr, &output) && ctx.Err() == nil && outputRecovery.next(settings, spec.ModelParameters, answer, estimate) {
				if strings.TrimSpace(answer.Content) != "" {
					partial := Message{Role: RoleAssistant, Content: answer.Content, Provider: answer.Provider}
					if e := archive.Append("message", partial); e != nil {
						return answer.Content, e
					}
					history, conv = append(history, partial), append(conv, partial)
					if m.workspace != nil && spec.WorkspaceRole != "" {
						m.workspace.recordOutput(spec.WorkspaceRole, partial.Content, "commentary")
					}
				}
				if e := archive.Append("output_continuation", map[string]any{"generation": record.Generation, "attempt": outputRecovery.attempts, "previous_limit": settings.MaxTokens, "next_limit": outputRecovery.limit, "incomplete_tools": len(answer.IncompleteTools)}); e != nil {
					return answer.Content, e
				}
				continue
			}
			return outputRecovery.completedText(answer.Content), requestErr
		}
		outputRecovery.notice = ""
		if retryReplyOnly && len(answer.ToolCalls) != 0 {
			return "", fmt.Errorf("重试已保留原工具回执，无法再次执行工具")
		}
		if usage != nil {
			meter.ObserveRequest(append([]Message{{Role: RoleSystem, Content: string(definitionJSON)}}, request...), usage.PromptTokens)
		}
		if pendingNoticeActive {
			// The next request reobserves the process; do not leave stale "still
			// running" instructions after a successful wait/input tool result.
			notice, pendingNoticeActive = "", false
		}
		if len(answer.ToolCalls) == 0 {
			if (packageRuntime || spec.Kind == "conversation") && m.hasPackageMessages(id) {
				if err := archive.Append("message", answer); err != nil {
					return "", err
				}
				history = append(history, answer)
				conv = append(conv, answer)
				continue
			}
			boundary := goalCompletionBoundary(plan)
			pendingNotice, pendingErr := pendingDeliveryBoundary(ctx, shell)
			if pendingErr != nil {
				if pendingNotice == "" || pendingDeliveryRetries >= 2 {
					return "", pendingErr
				}
				pendingDeliveryRetries++
				boundary = pendingNotice
			}
			if m.workspace != nil && spec.WorkspaceRole == WorkspaceMatrix {
				workflow, e := m.workspace.workflowBoundary(ctx, id, record.Generation)
				if e != nil {
					return "", e
				}
				if boundary == "" {
					boundary = workflow
				}
				if boundary == "" && !retryReplyOnly {
					boundary, e = m.workspace.awaitProgramDelivery(ctx, history[min(turnReceiptStart, len(history)):], observedProgramWaits)
					if e != nil {
						return "", e
					}
				}
			}
			if boundary != "" {
				// A streamed reply remains real output even when delivery needs
				// more evidence. Keep it in both display and model history before
				// the next request replaces the live body; it is not a completion.
				if strings.TrimSpace(answer.Content) != "" {
					if err = archive.Append("message", answer); err != nil {
						return "", err
					}
					history = append(history, answer)
					conv = append(conv, answer)
					if m.workspace != nil && spec.WorkspaceRole != "" {
						m.workspace.recordOutput(spec.WorkspaceRole, answer.Content, "commentary")
					}
				}
				if pendingErr != nil {
					if err = archive.Append("delivery_deferred", map[string]any{"generation": record.Generation, "attempt": pendingDeliveryRetries, "reason": pendingErr.Error()}); err != nil {
						return "", err
					}
				} else {
					deliveryRetries++
					if deliveryRetries > 2 {
						return "", fmt.Errorf("交付未通过任务验收或工作记录核实；原任务和证据已保存")
					}
				}
				notice = boundary
				pendingNoticeActive = pendingErr != nil
				continue
			}
			if m.workspace != nil && spec.WorkspaceRole != "" {
				if boundary := m.workspace.finishBoundary(spec.WorkspaceRole); boundary != "" {
					notice = boundary
					continue
				}
			}
			if strings.TrimSpace(answer.Content) == "" {
				if lastSaid != "" {
					answer.Content = lastSaid
				} else if !emptyNudged {
					// 一个字也没留下：提醒一次，让她用一两句话告诉用户结果。
					emptyNudged = true
					notice = runtimePrompt("Matrix/辅助指令/空回复补充.txt")
					continue
				} else {
					return "", errEmptyFinal
				}
			}
			if (packageRuntime || spec.Kind == "conversation") && !m.sealPackageTurn(id) {
				if err = archive.Append("message", answer); err != nil {
					return "", err
				}
				history = append(history, answer)
				conv = append(conv, answer)
				continue
			}
			if err = archive.Append("message", answer); err != nil {
				return "", err
			}
			finalText := outputRecovery.completedText(answer.Content)
			if settings.MemoryEnabled && m.workspace != nil && spec.WorkspaceRole == WorkspaceMatrix {
				if memoryAvailable {
					// Provider selection changes checkpoint strategy, not memory scheduling.
					// Unified memory never adds an idle continuity-model request.
				} else if m.workspace.Mode().unified() {
					m.rememberOSContinuity(ctx, job, settings, continuityEpoch, fmt.Sprintf("final:%s:%d", id, record.Generation), message, finalText)
				} else {
					m.workspace.rememberEpisode(ctx, fmt.Sprintf("final:%s:%d", id, record.Generation), "会话进展", "用户请求摘录：\n"+utf8Prefix(message, 1200)+"\n助手结果摘录（未经独立验证）：\n"+utf8Prefix(finalText, 2300))
				}
			}
			if identity.active() {
				if err = identityShellBoundary(shell); err != nil {
					return "", err
				}
				if err = identity.finish("COMPLETED: " + finalText); err != nil {
					return "", err
				}
				history = append(history, answer)
				conv = append(conv, answer)
				continue
			}
			return finalText, nil
		}
		outputRecovery.partialText = ""
		invocation := answer.ResponseID
		if strings.TrimSpace(answer.Content) != "" {
			silentRounds = 0
			lastSaid = answer.Content
			if m.workspace != nil && spec.WorkspaceRole != "" {
				m.workspace.recordOutput(spec.WorkspaceRole, answer.Content, "commentary")
			}
		} else {
			silentRounds++
		}
		if invocation == "" {
			return "", fmt.Errorf("validated response is missing its identity")
		}
		plan.RequestSnapshot, plan.SnapshotBound = ClonePlan(plan.State), true
		ctxWithImageUsage := context.WithValue(ctx, imageUsageWriterKey{}, func(u AgentUsage) error { return m.recordImageUsage(job, record.Generation, u) })
		ctxWithImageUsage = context.WithValue(ctxWithImageUsage, imageUsageOwnerKey{}, "agent:"+record.ID)
		ctxWithImageUsage = context.WithValue(ctxWithImageUsage, imageUsageRecoveryKey{}, m.recoverImageUsage)
		toolCtx := WithWebSearch(m.imageTools(ctxWithImageUsage, job, settings), settings)
		if spec.Kind == "conversation" {
			toolCtx = m.conversationTools(toolCtx, job, settings)
		}
		toolCtx = context.WithValue(toolCtx, compactBoundaryKey{}, len(answer.ToolCalls) == 1 && (answer.ToolCalls[0].Function.Name == "memory" || answer.ToolCalls[0].Function.Name == "toolbox" || answer.ToolCalls[0].Function.Name == "agents"))
		toolCtx = context.WithValue(toolCtx, motherIdentityRequestKey{}, motherIdentityRequest{settings: settings, history: history, model: spec.ModelID})
		toolCtx = context.WithValue(toolCtx, humanBoundaryKey{}, len(answer.ToolCalls) == 1 && answer.ToolCalls[0].Function.Name == "toolbox")
		toolCtx = context.WithValue(toolCtx, memoryEditHistoryKey{}, history)
		toolCtx = WithToolStartedObserver(toolCtx, job.toolStartObserver(invocation, answer.ToolCalls))
		toolCtx = context.WithValue(toolCtx, nestedExecutionObserverKey{}, job.startExecution)
		toolCtx = WithShellOutputBudget(toolCtx, min(ShellDefaultTokens, max(256, (budget.WorkingLimit()-estimate-1024)/max(1, len(answer.ToolCalls)))))
		if m.workspace != nil {
			if err = m.workspace.splitStationBoundary(toolCtx, "working"); err != nil {
				return "", err
			}
		}
		var pacTurn *pacBoundary
		if fastOn {
			covered := 0
			if checkpoint != nil {
				covered = checkpoint.Covered
			}
			pacTurn = &pacBoundary{workspace: memoryWorkspace, agent: id, history: history, covered: covered, plan: plan.State, previous: checkpoint, exclusive: len(answer.ToolCalls) == 1 && answer.ToolCalls[0].Function.Name == "memory"}
			toolCtx = context.WithValue(toolCtx, pacBoundaryKey{}, pacTurn)
		}
		turn, executeErr := ExecuteToolTurn(toolCtx, plan, shell, answer, invocation, archive.Append)
		if executeErr != nil {
			return "", executeErr
		}
		history = append(history, turn.Messages...)
		conv = append(conv, turn.Messages...)
		if lastSaid != "" && spec.WorkspaceRole == WorkspaceMatrix {
			for _, call := range answer.ToolCalls {
				if programDelegationAction("core_link", activityText(programResultArguments(call), "action")) {
					// Text accompanying a program call predates its durable receipt.
					lastSaid = ""
					break
				}
			}
		}
		if maintenance.takeMemoryChange() {
			if pacTurn != nil {
				pacTurn.refresh = true
			}
			meter = TokenMeter{}
		}
		if pacTurn != nil && pacTurn.refresh {
			snap, loadErr := memoryWorkspace.readPAC(ctx)
			if loadErr != nil {
				return "", loadErr
			}
			if cp := pacTurn.checkpoint; cp != nil {
				if err = m.commitContextCheckpoint(ctx, job, archive, cp, maintenance, "seal"); err != nil {
					return "", err
				}
				checkpoint, conv = cp, history[cp.Covered:]
				// These receipts already belong to the archive. Send their bounded
				// projection only with this checkpoint in this execution, without
				// adding another copy to the dialogue or the PAC.
				sealedReceiptCheckpoint = cp
				sealedReceipts = pacSealReceiptObservation(cp, history[max(turnReceiptStart, cp.First):cp.Covered], m.redact)
			}
			fastSnap = snap
			meter = TokenMeter{}
		}

		if spec.WorkspaceRole == "" {
			m.publishTaskPlan(job, record.Generation, plan.State)
		}
		if m.workspace != nil && spec.WorkspaceRole == WorkspaceMatrix {
			if err = m.workspace.syncWorkflow(plan, id, record.Generation); err != nil {
				return "", err
			}
			for _, call := range answer.ToolCalls {
				if call.Function.Name == "memory" {
					if !memoryAvailable {
						surface = m.workspace.memorySurface(ctx, message)
					}
					break
				}
			}
		}
		if m.workspace != nil && m.workspace.teamHost() && spec.WorkspaceRole == WorkspaceMatrix {
			for _, receipt := range turn.Receipts {
				if receipt.Patch != nil {
					if e := m.workspace.noteChanges(receipt.Key, *receipt.Patch); e != nil {
						return "", e
					}
				}
			}
		}
		m.mu.Lock()
		job.record.ToolTurns++
		err = m.saveLocked(job)
		m.mu.Unlock()
		if err != nil {
			return "", err
		}
		if m.hasPreparedHuman(job) {
			return "", errHumanWaiting
		}
	}
}

// Publish only the durable child plan and keep the primary workflow independent.
func (m *AgentManager) publishTaskPlan(job *agentJob, generation int, plan *PlanState) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if job.record.Generation == generation && job.record.Spec.WorkspaceRole == "" {
		job.plan, job.planGeneration = ClonePlan(plan), generation
	}
}

func (m *AgentManager) agentRequest(ctx context.Context, job *agentJob, settings *Settings, messages []Message, definitions []ToolDefinition, kind string) (Message, *Usage, error) {
	queuedAt := time.Now()
	// Network slots are released before running tools: a waiting parent cannot
	// exhaust all slots needed by its descendants.
	select {
	case m.slots <- struct{}{}:
		defer func() { <-m.slots }()
	case <-ctx.Done():
		return Message{}, nil, ctx.Err()
	}
	acquiredAt := time.Now()
	m.mu.Lock()
	admitted := copyRecord(job.record)
	if job.conversationTurn != nil {
		admitted.Spec = *job.conversationTurn
	}
	m.mu.Unlock()
	if err := m.admitMotherRepairRequest(admitted); err != nil {
		return Message{}, nil, err
	}
	if admitted.Spec.Kind == "conversation" {
		if err := m.checkConversationAuthority(admitted); err != nil {
			return Message{}, nil, err
		}
	}
	if m.workspace != nil {
		if err := m.workspace.splitStationBoundary(ctx, "working"); err != nil {
			return Message{}, nil, err
		}
	}
	m.mu.Lock()
	if budgetErr := job.record.requestBudgetError(); budgetErr != nil {
		m.mu.Unlock()
		return Message{}, nil, budgetErr
	}
	job.record.Requests++
	job.requestModel = settings.Model
	m.advanceHumanLocked(job, "delivered_to_agent", "resuming")
	number := job.record.Requests
	err := m.saveLocked(job)
	m.mu.Unlock()
	if err != nil {
		return Message{}, nil, err
	}
	started := time.Now()
	timing := &agentRequestClock{started: started, value: AgentRequestTiming{QueueMS: acquiredAt.Sub(queuedAt).Milliseconds(), PrepareMS: started.Sub(acquiredAt).Milliseconds()}}
	ctx = httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{GotConn: func(httptrace.GotConnInfo) { timing.mark("connection") }, GotFirstResponseByte: func() { timing.mark("first_byte") }})
	attemptAccounted := false
	ctx = withResponseRetryCallbacks(ctx, func(info RetryInfo) error {
		m.mu.Lock()
		defer m.mu.Unlock()
		if attemptAccounted {
			return nil
		}
		u := agentUsage(number, kind+":retry:"+info.Category, time.Since(started), info.Usage)
		u.Timing, u.Model, u.Host = timing.snapshot(), settings.Model, usageHost(settings.BaseURL)
		if info.Usage != nil {
			u.Input, u.Output = info.Usage.PromptTokens, info.Usage.CompletionTokens
			job.record.AccountedTokens += u.Input + u.Output
		} else {
			b, _ := json.Marshal(definitions)
			// 断流用量未知，按实际收到的字节保守计费，不能靠重试绕过任务预算。
			u.Estimated = true
			u.Input, u.Output = EstimateMessages(messages)+len(b)/3+1, info.OutputBytes
			job.record.AccountedTokens += u.Input + u.Output
		}
		job.record.Usage = append(job.record.Usage, u)
		m.appendUsageLedger(job, u)
		attemptAccounted = true
		if err := m.saveLocked(job); err != nil {
			return err
		}
		return nil
	}, func(RetryInfo) error {
		if m.workspace != nil {
			if err := m.workspace.splitStationBoundary(ctx, "working"); err != nil {
				return err
			}
		}
		m.mu.Lock()
		defer m.mu.Unlock()
		if err := ctx.Err(); err != nil {
			return err
		}
		if budgetErr := job.record.requestBudgetError(); budgetErr != nil {
			return budgetErr
		}
		job.record.Requests++
		number = job.record.Requests
		if err := m.saveLocked(job); err != nil {
			return err
		}
		attemptAccounted = false
		started = time.Now()
		timing.reset(started)
		return nil
	})
	if kind == "continuity" {
		ctx = withoutRequestRetry(ctx)
	}
	view := job.record.Spec.WorkspaceRole
	generation := job.record.Generation
	if view == "" {
		view = job.record.ID
	}
	projection := m.workspace
	if projection == nil {
		projection = m.streamProjection
	}
	if projection == nil {
		projection = m.taskProjection
	}
	if projection != nil {
		if kind == "model" {
			projection.taskRequestStart(view, generation, settings.ShowReasoning, job.record.ID)
		} else if kind == "compact" {
			projection.compactionStart(view)
		}
	}
	observe := func(event Event) {
		timing.mark("first_event")
		if event.Kind == EventReasoning && event.Text != "" {
			timing.mark("reasoning")
		}
		if event.Kind == EventDelta && event.Text != "" {
			timing.mark("text")
		}
		if kind == "model" && projection != nil {
			projection.taskStream(view, generation, event, job.record.ID)
		}
	}
	var answer Message
	var usage *Usage
	var requestErr error
	if m.workspace != nil && m.workspace.Mode().unified() && job.record.Spec.WorkspaceRole == "" {
		answer, usage, requestErr = completeAgentProcess(ctx, settings, messages, definitions, observe, func(pid int) error {
			m.mu.Lock()
			defer m.mu.Unlock()
			job.record.WorkerPID = pid
			if pid != 0 {
				job.record.LastWorkerPID = pid
			}
			return m.saveLocked(job)
		})
	} else {
		answer, usage, requestErr = completeAgentObserved(ctx, New(settings), settings, messages, definitions, observe)
	}
	// Cancellation and a broken worker/stream can return without a final event.
	// Close the live span at the actual request boundary for every task, including
	// split tasks that never pass through the primary role's recordOutput.
	if requestErr != nil && kind == "model" && projection != nil {
		projection.taskStream(view, generation, Event{Kind: EventError}, job.record.ID)
	}
	m.mu.Lock()
	if !attemptAccounted {
		u := agentUsage(number, kind, time.Since(started), usage)
		u.Timing = timing.snapshot()
		u.Model, u.OutputLimit, u.FinishReason, u.Host = settings.Model, settings.MaxTokens, answer.FinishReason, usageHost(settings.BaseURL)
		if usage != nil {
			u.Input, u.Output = usage.PromptTokens, usage.CompletionTokens
			job.record.AccountedTokens += u.Input + u.Output
		} else {
			b, _ := json.Marshal(definitions)
			u.Estimated = true
			u.Input, u.Output = EstimateMessages(messages)+len(b)/3+1, EstimateMessages([]Message{answer})
			job.record.AccountedTokens += u.Input + u.Output
		}
		job.record.Usage = append(job.record.Usage, u)
		m.appendUsageLedger(job, u)
		attemptAccounted = true
	}
	err = m.saveLocked(job)
	if err == nil {
		err = job.record.repairBudgetError(true)
	}
	if err == nil && job.record.tokenBudgetReached(true) {
		err = fmt.Errorf("agent cumulative token budget exhausted (%d/%d); last response usage recorded and response retained", job.record.AccountedTokens-job.record.TurnTokenBase, job.record.Spec.MaxTokens)
	}
	m.mu.Unlock()
	if err != nil {
		return answer, usage, err
	}
	return answer, usage, requestErr
}

// Transport callbacks may run concurrently. Missing milestones stay absent;
// a worker process without HTTP trace must not appear to have zero latency.
type agentRequestClock struct {
	mu      sync.Mutex
	started time.Time
	value   AgentRequestTiming
}

func (c *agentRequestClock) mark(phase string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	var slot **int64
	switch phase {
	case "connection":
		slot = &c.value.ConnectionMS
	case "first_byte":
		slot = &c.value.FirstByteMS
	case "first_event":
		slot = &c.value.FirstEventMS
	case "reasoning":
		slot = &c.value.ReasoningMS
	case "text":
		slot = &c.value.TextMS
	default:
		return
	}
	if *slot == nil {
		elapsed := time.Since(c.started).Milliseconds()
		*slot = &elapsed
	}
}
func (c *agentRequestClock) snapshot() *AgentRequestTiming {
	c.mu.Lock()
	defer c.mu.Unlock()
	v := c.value
	return &v
}
func (c *agentRequestClock) reset(at time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.started = at
	c.value = AgentRequestTiming{}
}

// 本地请求记录：每次请求完成追加一行到会话目录 usage.jsonl，只有用量与线路主机，不含 Key、地址路径与正文。
// 设置 · 请求记录和右上角统计读取它；超过 8MB 时转存为 usage.old.jsonl。
func (m *AgentManager) appendUsageLedger(job *agentJob, u AgentUsage) {
	if m.dir == "" || job == nil {
		return
	}
	scope, role := m.owner, job.record.Spec.WorkspaceRole
	if job.record.Spec.Kind == "conversation" {
		scope = conversationUsageScope(job.record)
		role = job.record.Spec.Title
		if c, e := m.readContact(conversationPromptID(job.record)); e == nil && c.Builtin != "" {
			role = builtinConversationRole(c.Builtin)
		}
	} else if job.record.Spec.WorkspaceRole == WorkspaceMatrix && job.record.LinkSession != "" {
		// resumeCoreLink binds the live job before its first model request.
		// Read that fixed identity without reversing the workspace/manager locks.
		scope = job.record.LinkSession
	}
	row := map[string]any{"session": scope, "task": job.record.ID, "parent": job.record.Parent, "role": role, "usage": u}
	b, err := json.Marshal(row)
	if err != nil {
		return
	}
	p := filepath.Join(m.dir, "usage.jsonl")
	if st, err := os.Stat(p); err == nil && st.Size() > 8<<20 {
		_ = os.Rename(p, filepath.Join(m.dir, "usage.old.jsonl"))
	}
	f, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	_, _ = f.Write(append(b, '\n'))
	_ = f.Close()
}

// 不属于某个任务的后台请求（启动问候、压缩、整理）同样记账，否则 OS 的总量和命中率都少算。
func (m *AgentManager) appendBackgroundUsage(scope, role string, settings *Settings, u AgentUsage) AgentUsage {
	if settings != nil {
		u.Model, u.Host = settings.Model, usageHost(settings.BaseURL)
	}
	if m.dir == "" {
		return u
	}
	row := map[string]any{"session": scope, "task": "", "parent": "", "role": role, "usage": u}
	b, err := json.Marshal(row)
	if err != nil {
		return u
	}
	f, err := os.OpenFile(filepath.Join(m.dir, "usage.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return u
	}
	_, _ = f.Write(append(b, '\n'))
	_ = f.Close()
	return u
}

// usageHost 只留主机名：请求记录区分官网网关与自定义供应商，不保存路径、查询或凭据。
func usageHost(base string) string {
	u, err := url.Parse(strings.TrimSpace(base))
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Hostname())
}

func agentUsage(request int, kind string, duration time.Duration, usage *Usage) AgentUsage {
	u := AgentUsage{Request: request, Kind: kind, At: time.Now().UTC().Format(time.RFC3339), DurationMS: duration.Milliseconds(), Reported: usage != nil}
	if usage == nil {
		return u
	}
	u.Input, u.Output = usage.PromptTokens, usage.CompletionTokens
	if usage.CompletionTokensDetails != nil {
		value := usage.CompletionTokensDetails.ReasoningTokens
		u.Reasoning = &value
	}
	if value, known := usage.CachedTokens(); known {
		u.Cached = &value
	}
	return u
}

func estimateUsage(u AgentUsage, input []Message, output Message) AgentUsage {
	if !u.Reported {
		u.Estimated = true
		u.Input = EstimateMessages(input)
		u.Output = EstimateMessages([]Message{output})
	}
	return u
}

func completeAgent(ctx context.Context, client *Client, settings *Settings, messages []Message, tools []ToolDefinition) (Message, *Usage, error) {
	return completeAgentObserved(ctx, client, settings, messages, tools, nil)
}

func completeAgentObserved(ctx context.Context, client *Client, settings *Settings, messages []Message, tools []ToolDefinition, observe func(Event)) (Message, *Usage, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var events <-chan Event
	switch settings.Protocol() {
	case ProtocolResponses:
		events = client.StreamResponses(ctx, settings, messages, tools)
	case ProtocolMessages, ProtocolGoogle:
		events = client.StreamNative(ctx, settings, messages, tools)
	default:
		events = client.StreamChatTools(ctx, settings, messages, tools)
	}
	var answer Message
	var usage *Usage
	ready, done := false, false
stream:
	for {
		var event Event
		select {
		case <-ctx.Done():
			// Join the request's callbacks before its owner writes final accounting.
			// Cancellation discards late content but must not race a durable attempt.
			for late := range events {
				switch late.Kind {
				case EventRetry:
					usage = nil
				case EventUsage:
					if late.Usage != nil {
						value := *late.Usage
						usage = &value
					}
				}
			}
			return Message{}, usage, ctx.Err()
		case next, ok := <-events:
			if !ok {
				break stream
			}
			event = next
		}
		if observe != nil {
			observe(event)
		}
		switch event.Kind {
		case EventRetry:
			answer, usage, ready, done = Message{}, nil, false, false
		case EventResponse:
			if event.Message != nil {
				answer = *event.Message
				ready = true
			}
		case EventUsage:
			if event.Usage != nil {
				value := *event.Usage
				usage = &value
			}
		case EventFinish:
			answer.FinishReason = event.Finish
		case EventDone:
			done = true
		case EventError:
			if event.Err != nil {
				return Message{FinishReason: answer.FinishReason}, usage, event.Err
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return Message{}, usage, err
	}
	if !ready || !done {
		return Message{}, usage, fmt.Errorf("model stream ended without a validated complete response; no tools executed")
	}
	answer.Provider = settings.ProviderIdentity()
	if answer.FinishReason == "length" {
		return answer, usage, &OutputLimitError{Limit: settings.MaxTokens, ReasoningOnly: strings.TrimSpace(answer.Content) == "" && len(answer.IncompleteTools) == 0, Tools: len(answer.IncompleteTools)}
	}
	if answer.FinishReason == "content_filter" {
		return answer, usage, &APIError{Code: "content_filter", Message: "model response stopped before completion: content_filter"}
	}
	return answer, usage, nil
}
