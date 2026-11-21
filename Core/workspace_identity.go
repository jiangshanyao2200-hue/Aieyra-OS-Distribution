// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: motherIdentityState; motherIdentityKey; motherTakeover; motherIdentityRequestKey; motherIdentityRequest; motherIdentity; cloneMotherIdentity; identityOpen; snapshot; active; save; restoreMotherIdentity; finish; recover; target; allowed; identityShellBoundary; call; coreLinkScope; boundary; projection; identityHandoff; motherIdentityControlDefinition; takeoverBinding; takeover; checkTakeover; releaseTakeover
// Impact: python -B scripts/code-atlas.py show Core/workspace_identity.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

// The mother remains the same actor and generation. A mode revision changes
// only its prompt and tool grant, after a committed checkpoint. No contact
// runtime, contact history, model credential or second mother is created.
type motherIdentityState struct {
	ID               string   `json:"id"`
	Revision         int      `json:"revision"`
	Phase            string   `json:"phase"`
	Actor            string   `json:"actor"`
	Generation       int      `json:"generation"`
	Scope            string   `json:"scope"`
	Model            string   `json:"model"`
	Contact          string   `json:"contact_id"`
	Name             string   `json:"name"`
	Prompt           string   `json:"prompt"`
	PromptHash       string   `json:"prompt_hash"`
	Tools            []string `json:"tools"`
	Reason           string   `json:"reason"`
	Task             string   `json:"task"`
	Trigger          string   `json:"trigger"`
	UserReference    string   `json:"user_reference,omitempty"`
	FailedAgent      string   `json:"failed_agent,omitempty"`
	FailedGeneration int      `json:"failed_generation,omitempty"`
	FailedAttempt    int      `json:"failed_chat_retry_attempt,omitempty"`
	RepairEvent      string   `json:"repair_event,omitempty"`
	Success          string   `json:"success"`
	Exit             string   `json:"exit"`
	Plan             []string `json:"plan"`
	Unresolved       []string `json:"unresolved,omitempty"`
	SourceMessages   int      `json:"source_messages"`
	Checkpoint       int      `json:"checkpoint,omitempty"`
	Compaction       string   `json:"compaction"`
	Outcome          string   `json:"outcome,omitempty"`
	Updated          string   `json:"updated_at"`
}

type motherIdentityKey struct{}

type motherTakeover struct {
	Scope       string `json:"scope"`
	Handoff     string `json:"handoff"`
	Mother      string `json:"mother"`
	Generation  int    `json:"generation"`
	RepairEvent string `json:"repair_event,omitempty"`
}
type motherIdentityRequestKey struct{}
type motherIdentityRequest struct {
	settings *Settings
	history  []Message
	model    string
}

type motherIdentity struct {
	mu       sync.Mutex
	state    *motherIdentityState
	receipts map[string]*motherIdentityState
	archive  *SessionArchive
	w        *Workspace
	record   AgentRecord
	settings *Settings // live frozen connection; never serialized into the handoff
}

func cloneMotherIdentity(v *motherIdentityState) *motherIdentityState {
	if v == nil {
		return nil
	}
	c := *v
	c.Tools, c.Plan, c.Unresolved = slices.Clone(v.Tools), slices.Clone(v.Plan), slices.Clone(v.Unresolved)
	return &c
}

func identityOpen(v *motherIdentityState) bool {
	return v != nil && (v.Phase == "preparing" || v.Phase == "active" || v.Phase == "exiting")
}

func (c *motherIdentity) snapshot() *motherIdentityState {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return cloneMotherIdentity(c.state)
}

func (c *motherIdentity) active() bool {
	if c == nil {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.state != nil && c.state.Phase == "active"
}

// Called with c.mu, after all external checks. The archive is the authority;
// failed persistence cannot activate permissions or announce a completed exit.
func (c *motherIdentity) save(v *motherIdentityState) error {
	v.Revision++
	v.Updated = time.Now().UTC().Format(time.RFC3339Nano)
	if err := c.archive.Append("mother_identity", v); err != nil {
		return err
	}
	c.state = cloneMotherIdentity(v)
	c.receipts[v.ID] = cloneMotherIdentity(v)
	return nil
}

func restoreMotherIdentity(r *RestoredSession, v motherIdentityState) error {
	if v.ID == "" || len(v.ID) > 96 || v.Revision < 1 || v.Actor == "" || v.Scope == "" || v.Generation < 1 || v.Model == "" || v.Contact == "" || v.PromptHash != fmt.Sprintf("%x", sha256.Sum256([]byte(v.Prompt))) || v.Compaction == "" || v.SourceMessages < 0 || v.SourceMessages > len(r.Messages) {
		return fmt.Errorf("母体身份交接记录无效")
	}
	if _, err := time.Parse(time.RFC3339Nano, v.Updated); err != nil {
		return err
	}
	if r.MotherIdentities == nil {
		r.MotherIdentities = map[string]*motherIdentityState{}
	}
	prev := r.MotherIdentity
	if v.Phase == "preparing" {
		if identityOpen(prev) || r.MotherIdentities[v.ID] != nil || v.Revision != 1 {
			return fmt.Errorf("母体身份交接重复或重叠")
		}
	} else {
		if !identityOpen(prev) || prev.ID != v.ID || prev.Revision+1 != v.Revision {
			return fmt.Errorf("母体身份交接修订不连续")
		}
		expected := cloneMotherIdentity(prev)
		expected.Revision, expected.Phase, expected.Updated, expected.Checkpoint, expected.Outcome = v.Revision, v.Phase, v.Updated, v.Checkpoint, v.Outcome
		if string(rawJSON(expected)) != string(rawJSON(v)) {
			return fmt.Errorf("母体交接期间不能改写身份快照")
		}
		switch v.Phase {
		case "active":
			cp := r.Checkpoint
			if prev.Phase != "preparing" || cp == nil || cp.Compaction == nil || cp.Compaction.RequestID != v.Compaction || cp.Compaction.Purpose != "identity_enter" || cp.Covered != v.Checkpoint || cp.Covered <= v.SourceMessages {
				return fmt.Errorf("专业身份缺少已提交的交接压缩")
			}
		case "exiting":
			if prev.Phase != "active" {
				return fmt.Errorf("当前专业身份不可退出")
			}
		case "exited", "aborted":
		default:
			return fmt.Errorf("母体身份状态无效")
		}
	}
	r.MotherIdentity = cloneMotherIdentity(&v)
	r.MotherIdentities[v.ID] = cloneMotherIdentity(&v)
	return nil
}

func (c *motherIdentity) finish(outcome string) error {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if !identityOpen(c.state) {
		return c.releaseTakeover(c.state)
	}
	v := cloneMotherIdentity(c.state)
	v.Phase, v.Outcome = "exited", utf8Prefix(outcome, 4000)
	if c.state.Phase == "preparing" {
		v.Phase = "aborted"
	}
	if err := c.save(v); err != nil {
		return err
	}
	return c.releaseTakeover(v)
}

// No automatic replay after a process loss. The next explicit mother run
// retains the original handoff/receipts and first returns to mother identity.
func (c *motherIdentity) recover() error {
	outcome := "PREVIOUS_RUN_INTERRUPTED: inspect committed receipts before a new handoff"
	if v := c.snapshot(); v != nil && v.Outcome != "" {
		outcome += "\n" + v.Outcome
	}
	return c.finish(outcome)
}

func (c *motherIdentity) target(id string) (conversationContact, string, string, []string, error) {
	cm, err := c.w.host.conversationManager()
	if err != nil {
		return conversationContact{}, "", "", nil, err
	}
	contact, sessions, err := cm.liveContact(id)
	if err != nil {
		return contact, "", "", nil, err
	}
	if contact.Builtin == "eyra" {
		return contact, "", "", nil, fmt.Errorf("母体无需切换成 Eyra 分身")
	}
	// 第109轮（Q8）：Cota 与 Vaya 在 Coding 程序里工作，母体不再切换成他们的身份。
	if contact.Builtin == "cota" || contact.Builtin == "vaya" {
		return contact, "", "", nil, fmt.Errorf("Cota 与 Vaya 在 Coding 程序里工作，母体不再切换成他们的身份；编程任务请用 agents(action=\"program_send\", program=\"coding\") 委派给 Coding")
	}
	s, err := Load(c.w.config)
	if err != nil {
		return contact, "", "", nil, err
	}
	if role := builtinConversationRole(contact.Builtin); role != "" && !s.TeamRoleOn(role) {
		return contact, "", "", nil, fmt.Errorf("目标主体已停用")
	}
	r := AgentRecord{ID: id, Spec: AgentSpec{ProfileID: id}}
	name, tools := contact.Name, []string{}
	if contact.Builtin != "" {
		name, tools = cm.builtinProfile(contact).Name, cm.builtinTools(contact)
	} else {
		if len(sessions) == 0 {
			return contact, "", "", nil, fmt.Errorf("目标联系人缺少有效定义")
		}
		r = sessions[len(sessions)-1]
		name, tools = r.Spec.Title, slices.Clone(r.Spec.Tools)
	}
	prompt, err := cm.conversationPrompt(r)
	// The always-available agents entry is exit/status only in professional mode.
	if !slices.Contains(tools, "agents") {
		tools = append(tools, "agents")
	}
	return contact, name, prompt, tools, err
}

func (c *motherIdentity) allowed(name string) bool {
	v := c.snapshot()
	if v == nil || v.Phase != "active" {
		return true
	}
	if name == "agents" {
		return true
	}
	if c.checkTakeover(v) != nil {
		return false
	}
	settings, err := Load(c.w.config)
	if err != nil || settings.rolePoolProfile(v.Model) == nil {
		return false
	}
	_, _, _, current, err := c.target(v.Contact)
	if err != nil {
		return false
	}
	if name == "core_link" {
		return true
	}
	return slices.Contains(v.Tools, name) && slices.Contains(current, name)
}

func identityShellBoundary(shell *ShellManager) error {
	for _, r := range shell.Snapshots() {
		if r.Pending() || r.State == "interrupted_unknown" {
			return fmt.Errorf("身份交接前必须结清在途或未知的终端结果")
		}
	}
	for _, r := range shell.ExecutionSnapshots() {
		if r.State == "running" || r.State == "interrupted_unknown" {
			return fmt.Errorf("身份交接前必须结清在途或未知的编排结果")
		}
	}
	return nil
}

func (c *motherIdentity) call(ctx context.Context, owner string, raw json.RawMessage) (any, error) {
	bound, ok := ctx.Value(conversationLinkCallerKey{}).(conversationLinkCaller)
	if !ok || bound.ID != owner || c == nil || c.record.ID != owner || c.record.Generation != bound.Generation {
		return nil, fmt.Errorf("身份交接仅允许真实运行中的母体")
	}
	if _, _, err := c.w.coreLinkActor(owner, bound.Generation); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	var p struct {
		Action                string `json:"action"`
		RequestID             string `json:"request_id"`
		Contact               string `json:"contact_id"`
		Reason, Task, Message string
		Command               struct {
			Trigger          string `json:"trigger"`
			UserReference    string `json:"user_reference"`
			FailedAgent      string `json:"failed_agent"`
			FailedGeneration int    `json:"failed_generation"`
			Success, Exit    string
			Plan, Unresolved []string
		} `json:"command"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if p.Action == "identity_status" {
		return identityHandoff(c.snapshot()), nil
	}
	if exclusive, _ := ctx.Value(compactBoundaryKey{}).(bool); !exclusive {
		return nil, fmt.Errorf("身份交接必须单独一次 agents 调用，不能与其他工具并行")
	}
	if p.RequestID == "" || len(p.RequestID) > 96 {
		return nil, fmt.Errorf("身份交接需要稳定 request_id，最多96字节")
	}
	if p.Action == "identity_exit" {
		if strings.TrimSpace(p.Message) == "" || len(p.Message) > 4000 {
			return nil, fmt.Errorf("退出需要 message 保存结果及未完成事项，最多4000字节")
		}
		am, _ := ctx.Value(agentManagerKey{}).(agentManagerContext)
		if am.shell == nil {
			return nil, fmt.Errorf("缺少执行结果边界")
		}
		if err := identityShellBoundary(am.shell); err != nil {
			return nil, err
		}
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.state == nil || c.state.ID != p.RequestID {
			return nil, fmt.Errorf("退出请求不属于当前身份交接")
		}
		if c.state.Phase != "active" {
			return identityHandoff(c.state), nil
		}
		v := cloneMotherIdentity(c.state)
		v.Phase, v.Outcome = "exiting", p.Message
		if err := c.save(v); err != nil {
			return nil, err
		}
		return identityHandoff(c.state), nil
	}
	if p.Action != "identity_enter" {
		return nil, fmt.Errorf("专业身份只保留 identity_status 与 identity_exit；返回母体后再管理其他会话")
	}
	if strings.TrimSpace(p.Contact) == "" {
		return nil, fmt.Errorf("identity_enter 需要顶层 contact_id：先调用 agents(action=\"contacts\")，选择目标联系人返回的 id，再作为 contact_id 提交；本次尚未创建交接或安排压缩")
	}
	c.mu.Lock()
	prior := cloneMotherIdentity(c.receipts[p.RequestID])
	current := cloneMotherIdentity(c.state)
	c.mu.Unlock()
	if prior != nil {
		if prior.Contact != p.Contact || prior.Task != p.Task || prior.Reason != p.Reason || prior.Trigger != p.Command.Trigger || prior.UserReference != p.Command.UserReference || prior.FailedAgent != p.Command.FailedAgent || prior.FailedGeneration != p.Command.FailedGeneration || prior.Success != p.Command.Success || prior.Exit != p.Command.Exit || !slices.Equal(prior.Plan, p.Command.Plan) || !slices.Equal(prior.Unresolved, p.Command.Unresolved) {
			return nil, fmt.Errorf("同一身份交接编号不能改变内容")
		}
		return identityHandoff(prior), nil
	}
	if identityOpen(current) {
		return nil, fmt.Errorf("不可叠加专业身份，请先退出")
	}
	for _, text := range []string{p.Reason, p.Task, p.Command.Success, p.Command.Exit} {
		if strings.TrimSpace(text) == "" || len(text) > 4000 {
			return nil, fmt.Errorf("交接需明确原因、任务、成功条件和退出条件，每项最多4000字节")
		}
	}
	if len(p.Command.Plan) == 0 || len(p.Command.Plan) > 20 || len(p.Command.Unresolved) > 20 {
		return nil, fmt.Errorf("交接需要有界计划及未决事项")
	}
	for _, text := range append(slices.Clone(p.Command.Plan), p.Command.Unresolved...) {
		if strings.TrimSpace(text) == "" || len(text) > 2000 {
			return nil, fmt.Errorf("交接步骤或未决事项无效")
		}
	}
	request, ok := ctx.Value(motherIdentityRequestKey{}).(motherIdentityRequest)
	if !ok || request.settings == nil {
		return nil, fmt.Errorf("缺少母体请求和历史边界")
	}
	repairEvent, failedAttempt := "", 0
	switch p.Command.Trigger {
	case "user_request", "task_complexity":
		if p.Command.FailedAgent != "" || p.Command.FailedGeneration != 0 {
			return nil, fmt.Errorf("任务身份切换不接管其他实例；失败接管使用 delegation_failed")
		}
		found := false
		for _, m := range request.history {
			if m.Role == RoleUser && m.Name == "" && strings.TrimSpace(p.Command.UserReference) != "" && strings.Contains(m.Content, p.Command.UserReference) {
				found = true
			}
		}
		if !found {
			return nil, fmt.Errorf("command.user_reference 需逐字引用实际用户消息中的连续原文片段，不能改写或拼接；内部协作消息不能授权身份切换")
		}
	case "delegation_failed":
		cm, err := c.w.host.conversationManager()
		if err != nil {
			return nil, err
		}
		r, err := cm.Status(cm.owner, p.Command.FailedAgent)
		if err != nil || r.Generation != p.Command.FailedGeneration || !repairFailure(r) || r.LinkCancelled || r.DeletionPending {
			return nil, fmt.Errorf("接管需引用明确失败且未被用户停止的实例及代次")
		}
		failedAttempt = r.ChatRetryAttempt
		if r.Link == nil || r.Link.Scope != c.w.coreLinkScope() {
			// Global repair is authorized by a typed event actually delivered to
			// this running mother, never by a model-supplied cross-session ID.
			c.w.mu.Lock()
			for _, msg := range c.w.state.Messages {
				if e := msg.Repair; e != nil && e.Service == "conversation" && e.matchesSource(r) && msg.Generation == bound.Generation && msg.AgentID == owner && msg.State == "delivered" {
					repairEvent = msg.ID
					break
				}
			}
			c.w.mu.Unlock()
			if repairEvent == "" {
				return nil, fmt.Errorf("跨会话接管需要本轮母体已收到的原代次修理事件")
			}
		}
	default:
		return nil, fmt.Errorf("身份切换 trigger 应为 user_request、task_complexity 或 delegation_failed")
	}
	am, _ := ctx.Value(agentManagerKey{}).(agentManagerContext)
	if am.shell == nil {
		return nil, fmt.Errorf("缺少执行结果边界")
	}
	if err := identityShellBoundary(am.shell); err != nil {
		return nil, err
	}
	_, name, prompt, tools, err := c.target(p.Contact)
	if err != nil {
		return nil, err
	}
	_, scope, err := c.w.coreLinkActor(owner, bound.Generation)
	if err != nil {
		return nil, err
	}
	maintenance, _ := ctx.Value(contextCompactionKey{}).(*contextCompaction)
	if maintenance == nil {
		return nil, fmt.Errorf("身份交接需要共同压缩服务")
	}
	maintenance.mu.Lock()
	defer maintenance.mu.Unlock()
	if compactionPending(maintenance.last) {
		return nil, fmt.Errorf("已有上下文整理等待完成")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	v := &motherIdentityState{ID: p.RequestID, Phase: "preparing", Actor: owner, Generation: bound.Generation, Scope: scope, Model: request.model, Contact: p.Contact, Name: name, Prompt: prompt, PromptHash: fmt.Sprintf("%x", sha256.Sum256([]byte(prompt))), Tools: tools, Reason: p.Reason, Task: p.Task, Trigger: p.Command.Trigger, UserReference: p.Command.UserReference, FailedAgent: p.Command.FailedAgent, FailedGeneration: p.Command.FailedGeneration, Success: p.Command.Success, Exit: p.Command.Exit, Plan: p.Command.Plan, Unresolved: p.Command.Unresolved, SourceMessages: len(request.history), Compaction: "identity-" + workflowHash(scope+":"+p.RequestID)}
	v.RepairEvent, v.FailedAttempt = repairEvent, failedAttempt
	if err := c.save(v); err != nil {
		return nil, err
	}
	if err := c.takeover(v); err != nil {
		v.Phase, v.Outcome = "aborted", "SOURCE_UNAVAILABLE: "+err.Error()
		if e := c.save(v); e != nil {
			return nil, e
		}
		return nil, err
	}
	c.settings = request.settings.Clone()
	maintenance.last = &CompactionState{RequestID: v.Compaction, Trigger: "manual", State: "scheduled", Purpose: "identity_enter", Updated: time.Now().UTC().Format(time.RFC3339Nano)}
	return map[string]any{"identity": identityHandoff(c.state), "compaction": cloneCompaction(maintenance.last)}, nil
}

func (w *Workspace) coreLinkScope() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.coreLinkScopeLocked()
}

// Called only between complete tool turns, before binding the next request.
func (c *motherIdentity) boundary(cp *Checkpoint, maintenance *contextCompaction) error {
	v := c.snapshot()
	if !identityOpen(v) {
		return nil
	}
	if v.Phase == "exiting" {
		return c.finish(v.Outcome)
	}
	if err := c.checkTakeover(v); err != nil {
		return c.finish("SOURCE_CHANGED: " + err.Error())
	}
	if _, _, _, _, err := c.target(v.Contact); err != nil {
		return c.finish("TARGET_UNAVAILABLE: " + err.Error())
	}
	if v.Phase != "preparing" {
		return nil
	}
	state := maintenance.snapshot()
	if state == nil || state.RequestID != v.Compaction || compactionPending(state) {
		return nil
	}
	if state.State != "completed" || cp == nil || cp.Compaction == nil || cp.Compaction.RequestID != v.Compaction || cp.Covered <= v.SourceMessages {
		return c.finish("COMPACTION_NOT_COMMITTED: " + state.State)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	v.Phase, v.Checkpoint = "active", cp.Covered
	return c.save(v)
}

func (c *motherIdentity) projection() map[string]any {
	v := c.snapshot()
	if v == nil {
		return nil
	}
	name := v.Name
	if v.Phase == "active" {
		// Display only needs current naming, not another copy of every contact
		// session and prompt on each frame.
		if cm, err := c.w.host.conversationManager(); err == nil {
			if contact, err := cm.readContact(v.Contact); err == nil && !contact.Deleted {
				if contact.Builtin != "" {
					name = cm.builtinProfile(contact).Name
				} else if contact.Name != "" {
					name = contact.Name
				}
			}
		}
	}
	return map[string]any{"id": v.ID, "phase": v.Phase, "revision": v.Revision, "contact_id": v.Contact, "name": name, "outcome": c.w.manager.redact(v.Outcome)}
}

func identityHandoff(v *motherIdentityState) map[string]any {
	if v == nil {
		return nil
	}
	return map[string]any{"id": v.ID, "phase": v.Phase, "revision": v.Revision, "mother": v.Actor, "generation": v.Generation, "scope": v.Scope, "model": v.Model, "contact_id": v.Contact, "name": v.Name, "prompt_hash": v.PromptHash, "tools": v.Tools, "reason": v.Reason, "task": v.Task, "trigger": v.Trigger, "user_reference": v.UserReference, "failed_agent": v.FailedAgent, "failed_generation": v.FailedGeneration, "success": v.Success, "exit": v.Exit, "plan": v.Plan, "unresolved": v.Unresolved, "checkpoint": v.Checkpoint, "outcome": v.Outcome}
}

func motherIdentityControlDefinition() ToolDefinition {
	return ToolDefinition{Type: "function", Name: "agents", Description: runtimePrompt("Matrix/辅助指令/母体专业身份.txt"), Parameters: schemaObject(map[string]any{"action": schemaEnum("identity_status", "identity_exit"), "request_id": schemaString(), "message": schemaString()}, "action")}
}

func takeoverBinding(v *motherIdentityState) motherTakeover {
	return motherTakeover{Scope: v.Scope, Handoff: v.ID, Mother: v.Actor, Generation: v.FailedGeneration, RepairEvent: v.RepairEvent}
}

// The source archive is already closed. Persist the generation fence before
// compression; both the intent and this fence are recoverable if the process
// exits between the two writes. User input may supersede it, internal retries
// cannot restart the transferred work. No failed tool is replayed here.
func (c *motherIdentity) takeover(v *motherIdentityState) error {
	if v.FailedAgent == "" {
		return nil
	}
	cm, err := c.w.host.conversationManager()
	if err != nil {
		return err
	}
	cm.mu.Lock()
	defer cm.mu.Unlock()
	j := cm.jobs[v.FailedAgent]
	if j == nil || j.record.Generation != v.FailedGeneration || j.record.ChatRetryAttempt != v.FailedAttempt || !repairFailure(j.record) || j.record.LinkCancelled || j.record.DeletionPending || v.RepairEvent == "" && (j.record.Link == nil || j.record.Link.Scope != v.Scope) || len(j.record.PendingMessages) > 0 {
		return fmt.Errorf("失败成员已变化或仍有待处理输入")
	}
	if j.record.MotherTakeover != nil {
		return fmt.Errorf("该失败代次已有母体交接")
	}
	if j.done != nil {
		select {
		case <-j.done:
		default:
			return fmt.Errorf("原执行者尚未结清")
		}
	}
	for id, other := range cm.jobs {
		if cm.linkDescendantLocked(v.FailedAgent, id) && activeAgent(other.record.State) {
			return fmt.Errorf("原执行者仍有活跃下属")
		}
	}
	if j.shell != nil {
		if err := identityShellBoundary(j.shell); err != nil {
			return err
		}
	}
	path, err := SessionPath(filepath.Join(cm.dir, "config.json"), v.FailedAgent)
	if err != nil {
		return err
	}
	restored, err := (&SessionArchive{Path: path}).read()
	if err != nil {
		return err
	}
	if restored.RecoveredTool != nil {
		return fmt.Errorf("原执行者有尚未结算的工具事务")
	}
	for _, r := range restored.Plan.Receipts {
		if strings.Contains(r.Output, `"interrupted_unknown"`) {
			return fmt.Errorf("原执行者有未知副作用，须先核对原回执")
		}
	}
	binding := takeoverBinding(v)
	j.record.MotherTakeover = &binding
	if err = cm.saveLocked(j); err != nil {
		j.record.MotherTakeover = nil
	}
	return err
}

func (c *motherIdentity) checkTakeover(v *motherIdentityState) error {
	if v == nil || v.FailedAgent == "" {
		return nil
	}
	cm, err := c.w.host.conversationManager()
	if err != nil {
		return err
	}
	cm.mu.Lock()
	defer cm.mu.Unlock()
	j := cm.jobs[v.FailedAgent]
	if j == nil || j.record.Generation != v.FailedGeneration || j.record.ChatRetryAttempt != v.FailedAttempt || !repairFailure(j.record) || j.record.LinkCancelled || j.record.DeletionPending || j.record.MotherTakeover == nil || *j.record.MotherTakeover != takeoverBinding(v) {
		return fmt.Errorf("原任务已取消、恢复或改变交接")
	}
	return nil
}

func (c *motherIdentity) releaseTakeover(v *motherIdentityState) error {
	// Once execution has transferred, old internal messages must never reopen
	// that failed generation, even after mother completion or process loss.
	// A new explicit user turn is admitted separately and clears the fence.
	if v == nil || v.FailedAgent == "" || v.Checkpoint > 0 {
		return nil
	}
	// Primary workspaces stop before the shared conversation manager closes.
	// Use the already bound service even after new host admissions are closed.
	cm := c.w.manager.linkRootService.Load()
	if cm == nil {
		return fmt.Errorf("交接恢复缺少原共同会话服务")
	}
	cm.mu.Lock()
	defer cm.mu.Unlock()
	j := cm.jobs[v.FailedAgent]
	if j == nil || j.record.MotherTakeover == nil || *j.record.MotherTakeover != takeoverBinding(v) {
		return nil
	}
	previous := j.record.MotherTakeover
	j.record.MotherTakeover = nil
	if err := cm.saveLocked(j); err != nil {
		j.record.MotherTakeover = previous
		return err
	}
	return nil
}
