// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workspaceLinkMailbox; workspaceLinkCallerKey; errCoreLinkStopped; checkCoreLinkMessageLocked; coreLinkScopeLocked; explicitMotherTurnLocked; primaryCoreLink; coreLinkActor; coreLinkActorLocked; routeCoreLink; workspaceLinkRecord; bindWorkspaceLink; workspaceLinkProjection; resumeCoreLink; scheduleWorkspaceLink; deliverWorkspaceLink; enqueueCoreLink; workspaceLinkOriginStopped; rememberCoreLinkLocked; settleWorkspaceLink; cancelWorkspaceLink
// Impact: python -B scripts/code-atlas.py show Core/workspace_core_link.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/aieyra/aieyra-os/internal-link"
)

// A mailbox belongs to a persistent user conversation. It is not an Agent
// instance: only the real Workspace can execute its queued messages.
type workspaceLinkMailbox = internallink.Mailbox
type workspaceLinkCallerKey struct{}

var errCoreLinkStopped = errors.New("原协作任务已停止，消息仅供回查")

// The inbox can outlive a direct runtime cancellation or a process restart.
// Recheck the persistent mailbox fence at consumption, not only at enqueue.
func (w *Workspace) checkCoreLinkMessageLocked(msg workspaceMessage) error {
	service := w.manager.linkRootService.Load()
	if service == nil || msg.CoreLink == nil || msg.CoreLink.Scope != w.coreLinkScopeLocked() {
		return fmt.Errorf("协作消息不属于当前母体会话")
	}
	conversationGroupsMu.Lock()
	g, err := service.readGroup(linkLogID(msg.CoreLink.Scope))
	conversationGroupsMu.Unlock()
	if err != nil {
		return err
	}
	if g.WorkspaceLink == nil || workspaceLinkOriginStopped(g.WorkspaceLink, *msg.CoreLink) {
		return errCoreLinkStopped
	}
	return nil
}

func (w *Workspace) coreLinkScopeLocked() string {
	if s := w.contextSessionLocked(); s != nil {
		return s.ID
	}
	return w.state.ID
}

func (w *Workspace) explicitMotherTurnLocked(id string, generation int) bool {
	for _, message := range w.state.Messages {
		if workspaceChatInput(message) && message.State == "delivered" && message.Generation == generation && message.AgentID == id {
			return true
		}
	}
	return false
}

func (m *AgentManager) primaryCoreLink(r AgentRecord) bool {
	return m.workspace != nil && m.workspace.host != nil && m.workspace.coreLinkRegistered.Load() && m.workspace.Mode() == HostOS && m.workspace.split == nil && r.Spec.WorkspaceRole == WorkspaceMatrix
}

func (w *Workspace) coreLinkActor(id string, generation int) (AgentRecord, string, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.coreLinkActorLocked(id, generation)
}

func (w *Workspace) coreLinkActorLocked(id string, generation int) (AgentRecord, string, error) {
	if w.closed || w.updateFrozen || w.state.Roles[WorkspaceMatrix] != id {
		return AgentRecord{}, "", fmt.Errorf("母体协作会话已切换或暂停")
	}
	r, err := w.manager.Status(w.manager.owner, id)
	if err != nil {
		return r, "", err
	}
	if !w.manager.primaryCoreLink(r) || r.Generation != generation || !activeAgent(r.State) || r.State == "cancelling" {
		return r, "", fmt.Errorf("母体协作运行已结束")
	}
	return r, w.coreLinkScopeLocked(), nil
}

func (w *Workspace) routeCoreLink(ctx context.Context, caller string, raw json.RawMessage) (any, error) {
	m, err := w.host.conversationManager()
	if err != nil {
		return nil, err
	}
	w.manager.linkRootService.Store(m)
	return m.coreLinkCall(context.WithValue(ctx, workspaceLinkCallerKey{}, w), caller, raw)
}

func workspaceLinkRecord(g *conversationGroup) AgentRecord {
	b := g.WorkspaceLink
	state := b.State
	if state == "" {
		state = "idle"
	}
	return AgentRecord{ID: g.Host.Session, Generation: b.Generation, State: state, LinkStoppedThrough: b.StoppedThrough, LinkCancelled: b.Generation <= b.StoppedThrough,
		Spec: AgentSpec{Kind: "workspace_link", Title: b.Name, Workdir: b.Workdir}}
}

// Called with the common log lock after verifying the real running actor.
func (m *AgentManager) bindWorkspaceLink(real AgentRecord, scope string) (AgentRecord, *conversationGroup, error) {
	id := linkLogID(scope)
	g, err := m.readGroup(id)
	if err != nil {
		if _, e := os.Stat(filepath.Join(m.groupDir(), id+".json")); !os.IsNotExist(e) {
			return AgentRecord{}, nil, err
		}
		g = &conversationGroup{ID: id, Name: "Core Link", LinkScope: scope, Host: groupMember{Contact: groupHost, Session: scope}, Chains: map[string]int{}, WorkspaceLink: &workspaceLinkMailbox{}}
	}
	if g.LinkScope != scope || g.WorkspaceLink == nil {
		return AgentRecord{}, nil, fmt.Errorf("协作邮箱身份不匹配")
	}
	b := g.WorkspaceLink
	if b.Actor != real.ID || b.ActorGeneration != real.Generation {
		b.Actor, b.ActorGeneration = real.ID, real.Generation
		b.Generation++
		b.Workdir, b.Name, b.State = real.Spec.Workdir, "Eyra", real.State
		if err = m.writeGroup(g); err != nil {
			return AgentRecord{}, nil, err
		}
	}
	if b.Generation <= b.StoppedThrough {
		return AgentRecord{}, nil, fmt.Errorf("母体协作代次已停止")
	}
	return workspaceLinkProjection(g, real), g, nil
}

func workspaceLinkProjection(g *conversationGroup, real AgentRecord) AgentRecord {
	r := workspaceLinkRecord(g)
	r.State = real.State
	r.Result, r.Error = real.Result, real.Error
	r.TurnOrigins = real.TurnOrigins
	r.TurnGenerations = map[string]int{}
	for request, generation := range real.TurnGenerations {
		if generation == real.Generation {
			r.TurnGenerations[request] = r.Generation
		}
	}
	return r
}

func (w *Workspace) resumeCoreLink(record AgentRecord) error {
	if !w.manager.primaryCoreLink(record) {
		return nil
	}
	m, err := w.host.conversationManager()
	if err != nil {
		return err
	}
	w.manager.linkRootService.Store(m)
	w.mu.Lock()
	defer w.mu.Unlock()
	w.manager.linkOperation.Lock()
	defer w.manager.linkOperation.Unlock()
	real, scope, err := w.coreLinkActorLocked(record.ID, record.Generation)
	if err != nil {
		return err
	}
	// Record the logical scope on the actual runtime only for cancellation.
	w.manager.mu.Lock()
	if job := w.manager.jobs[record.ID]; job != nil && job.record.Generation == record.Generation {
		job.record.LinkSession = scope
		err = w.manager.saveLocked(job)
	}
	w.manager.mu.Unlock()
	if err != nil {
		return err
	}
	conversationGroupsMu.Lock()
	_, g, err := m.bindWorkspaceLink(real, scope)
	conversationGroupsMu.Unlock()
	if err == nil {
		// Reopening only restored the durable inbox. An explicit turn may now
		// consume interrupted internal messages, without replaying member tasks.
		changed := false
		for i := range w.state.Messages {
			msg := &w.state.Messages[i]
			// Repairs recover at the explicit user's drain boundary, where
			// the archive can distinguish a queued notice from an old input.
			if msg.Repair == nil && msg.CoreLink != nil && msg.CoreLink.Scope == scope && msg.State == "interrupted" {
				if workspaceLinkOriginStopped(g.WorkspaceLink, *msg.CoreLink) {
					msg.State = "cancelled"
				} else {
					msg.State = "queued"
				}
				changed = true
			}
		}
		if changed {
			err = w.saveLocked()
		}
	}
	if err == nil {
		if w.explicitMotherTurnLocked(record.ID, record.Generation) {
			w.recoverMotherRepairNoticesLocked(m, scope)
		}
		m.scheduleWorkspaceLink(g.ID)
	}
	return err
}

// No mailbox/log lock is held while calling Workspace enqueue. Shutdown and
// user cancellation can therefore drain the real execution queues normally.
func (m *AgentManager) scheduleWorkspaceLink(group string) {
	if m.linkHome == nil {
		return
	}
	m.mu.Lock()
	if m.ctx.Err() != nil {
		m.mu.Unlock()
		return
	}
	if existing, busy := m.linkDeliveries.Load(group); busy {
		select {
		case existing.(chan struct{}) <- struct{}{}:
		default:
		}
		m.mu.Unlock()
		return
	}
	wake := make(chan struct{}, 1)
	m.linkDeliveries.Store(group, wake)
	m.wg.Add(1)
	m.mu.Unlock()
	go func() {
		defer m.wg.Done()
		for {
			m.deliverWorkspaceLink(group)
			m.mu.Lock()
			select {
			case <-wake:
				m.mu.Unlock()
			default:
				m.linkDeliveries.Delete(group)
				m.mu.Unlock()
				return
			}
		}
	}()
}

func (m *AgentManager) deliverWorkspaceLink(group string) {
	for m.ctx.Err() == nil {
		conversationGroupsMu.Lock()
		g, err := m.readGroup(group)
		if err != nil || g.WorkspaceLink == nil {
			conversationGroupsMu.Unlock()
			return
		}
		_, err = m.groupIndex(g)
		var messages []groupMessage
		if err == nil {
			messages, err = m.groupRange(g, g.WorkspaceLink.Cursor, g.WorkspaceLink.Cursor+100)
		}
		conversationGroupsMu.Unlock()
		if err != nil || len(messages) == 0 {
			return
		}
		cursor := g.WorkspaceLink.Cursor
		for _, msg := range messages {
			if msg.To == g.Host.Session {
				if err = m.linkHome.enqueueCoreLink(g, msg); err != nil {
					return
				}
			}
			cursor = msg.Seq
		}
		conversationGroupsMu.Lock()
		current, e := m.readGroup(group)
		if e == nil && current.WorkspaceLink != nil {
			current.WorkspaceLink.Cursor = max(current.WorkspaceLink.Cursor, cursor)
			e = m.writeGroup(current)
		}
		conversationGroupsMu.Unlock()
		if e != nil {
			return
		}
	}
}

func (h *WorkspaceHost) enqueueCoreLink(g *conversationGroup, msg groupMessage) error {
	h.mu.Lock()
	if h.closed || h.updateFrozen {
		h.mu.Unlock()
		return fmt.Errorf("母体已关闭或正在更新")
	}
	workspaces := make([]*Workspace, 0, len(h.workspaces))
	for _, w := range h.workspaces {
		workspaces = append(workspaces, w)
	}
	h.mu.Unlock()
	for _, w := range workspaces {
		w.mu.Lock()
		if w.closed || w.split != nil || w.coreLinkScopeLocked() != g.LinkScope {
			w.mu.Unlock()
			continue
		}
		// Recheck the durable fence after acquiring the real endpoint lock.
		// Cancellation may have committed after the scheduler read its batch.
		w.manager.linkOperation.Lock()
		defer w.manager.linkOperation.Unlock()
		conversationGroupsMu.Lock()
		service := w.manager.linkRootService.Load()
		if service == nil {
			conversationGroupsMu.Unlock()
			w.mu.Unlock()
			return fmt.Errorf("母体尚未显式恢复协作")
		}
		current, err := service.readGroup(g.ID)
		conversationGroupsMu.Unlock()
		if err != nil || current.WorkspaceLink == nil {
			w.mu.Unlock()
			return fmt.Errorf("协作邮箱读取失败")
		}
		origin := conversationLinkOrigin{Scope: g.LinkScope, From: msg.From, Generation: msg.SenderGeneration, Kind: msg.Kind, Hops: msg.Hops, TargetGeneration: msg.TargetGeneration, ReplyGeneration: msg.ReplyGeneration}
		if workspaceLinkOriginStopped(current.WorkspaceLink, origin) {
			w.mu.Unlock()
			return nil // Keep original log, retire delivery; stopping never resumes work.
		}
		if id := w.state.Roles[WorkspaceMatrix]; id != "" {
			r, err := w.manager.Status(w.manager.owner, id)
			if err != nil || r.LinkCancelled || r.State == "cancelled" || r.State == "cancelling" {
				w.mu.Unlock()
				return fmt.Errorf("原母体任务已停止，回执保留")
			}
		}
		text := "[Core Link " + msg.Kind + " from instance " + msg.From + "]\n" + msg.Text
		if source, e := service.Status(service.owner, msg.From); e == nil && msg.Kind == "result" && source.Generation == msg.SenderGeneration && repairFailure(source) {
			cause := "failure"
			if source.Failure != nil {
				cause = source.Failure.Code
			}
			_, err = w.enqueueRepairLocked(service, source, cause, source.Error, msg.Request, text, &origin)
			w.mu.Unlock()
			return err
		}
		_, err = w.enqueueMessageLocked(msg.From, WorkspaceMatrix, msg.Request, text, "queued", taskMessageHash(text), nil, &origin, "", "core_link")
		w.mu.Unlock()
		return err
	}
	return fmt.Errorf("原母体会话当前未打开，回执保留")
}

func workspaceLinkOriginStopped(b *workspaceLinkMailbox, o conversationLinkOrigin) bool {
	return b.Stopped(o)
}

// Persist sender attribution before the archive append. The workspace inbox
// and deterministic message name reconcile retries at the normal drain boundary.
func (w *Workspace) rememberCoreLinkLocked(msg workspaceMessage, generation int) error {
	m := w.manager
	m.mu.Lock()
	defer m.mu.Unlock()
	job := m.jobs[w.state.Roles[WorkspaceMatrix]]
	if job == nil || job.record.Generation != generation {
		return fmt.Errorf("母体运行已变化")
	}
	job.record.TurnGenerations[msg.ID] = generation
	rememberLinkOrigin(&job.record, msg.ID, *msg.CoreLink)
	return m.saveLocked(job)
}

func (m *AgentManager) settleWorkspaceLink(r AgentRecord) {
	service := m.linkRootService.Load()
	if service == nil || r.LinkSession == "" || m.ctx.Err() != nil {
		return
	}
	m.linkOperation.Lock()
	defer m.linkOperation.Unlock()
	conversationGroupsMu.Lock()
	g, err := service.readGroup(linkLogID(r.LinkSession))
	if err != nil || g.WorkspaceLink == nil || g.WorkspaceLink.Actor != r.ID || g.WorkspaceLink.ActorGeneration != r.Generation {
		conversationGroupsMu.Unlock()
		return
	}
	g.WorkspaceLink.State = r.State
	err = service.writeGroup(g)
	projection := workspaceLinkProjection(g, r)
	conversationGroupsMu.Unlock()
	if err == nil {
		service.settleLinkWithDelivery(projection, true)
	}
}

func (m *AgentManager) cancelWorkspaceLink(r AgentRecord) error {
	service := m.linkRootService.Load()
	if service == nil || r.LinkSession == "" {
		return nil
	}
	conversationGroupsMu.Lock()
	defer conversationGroupsMu.Unlock()
	g, err := service.readGroup(linkLogID(r.LinkSession))
	if err != nil {
		return err
	}
	if g.WorkspaceLink == nil || g.WorkspaceLink.Actor != r.ID || g.WorkspaceLink.ActorGeneration != r.Generation {
		return nil
	}
	g.WorkspaceLink.StoppedThrough = max(g.WorkspaceLink.StoppedThrough, g.WorkspaceLink.Generation)
	var failures []error
	if err = service.writeGroup(g); err != nil {
		failures = append(failures, fmt.Errorf("协作邮箱停止状态保存失败: %w", err))
	}
	for _, member := range service.linkMembers(g) {
		if member.Link != nil {
			if err = service.CancelGeneration(service.owner, member.ID, member.Generation); err != nil {
				failures = append(failures, fmt.Errorf("停止协作成员 %s 失败: %w", member.ID, err))
			}
		}
	}
	return errors.Join(failures...)
}
