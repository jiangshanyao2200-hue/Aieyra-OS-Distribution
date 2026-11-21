// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: motherRepairEvent; motherRepairRun; motherRepairNotice; matches; motherRepairRunKey; motherRepairTargetKey; errMotherRepairStopped; repairRunRequest; repairEpisode; repairFailure; matchesSource; undeliveredInterruptedRepair; repairBlockedCode; motherRepairHome; repairServiceLocked; independentRepairSource; settleMotherRepair; motherRepairWorkspace; prepareMotherRepairNotice; deliverMotherRepairNoticeLocked; recoverMotherRepairNoticesLocked; enqueueMotherRepair; enqueueRepairLocked; enqueueRepairWithStateLocked; repairReadyLocked; admitMotherRepairRequest; requestMotherHelp
// Impact: python -B scripts/code-atlas.py show Core/workspace_repairs.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

// A repair is a typed message in the existing mother's inbox, not another
// executor. The source archive owns the complete failure/request and effects.
type motherRepairEvent struct {
	Source     string            `json:"source"`
	Service    string            `json:"service"`
	Generation int               `json:"generation"`
	Attempt    int               `json:"chat_retry_attempt,omitempty"`
	Cause      string            `json:"cause"`
	Episode    string            `json:"episode"`
	Automatic  bool              `json:"automatic"`
	NotBefore  string            `json:"not_before,omitempty"`
	Blocked    string            `json:"blocked,omitempty"`
	Requests   map[string]string `json:"requests,omitempty"`
}

type motherRepairRun struct {
	Request     string `json:"request"`
	RequestBase int    `json:"request_base"`
	TokenBase   int    `json:"token_base"`
}

// Stored in the same record as the source's terminal state.
type motherRepairNotice struct {
	Scope       string `json:"scope"`
	Generation  int    `json:"generation"`
	Attempt     int    `json:"attempt"`
	RepairEpoch uint64 `json:"repair_epoch,omitempty"`
}

func (n *motherRepairNotice) matches(r AgentRecord) bool {
	return n != nil && n.Generation == r.Generation && n.Attempt == r.ChatRetryAttempt
}

type motherRepairRunKey struct{}
type motherRepairTargetKey struct{}

var errMotherRepairStopped = fmt.Errorf("原修理事件已停止或失效，未发出模型请求: %w", context.Canceled)

func repairRunRequest(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	request, _ := ctx.Value(motherRepairRunKey{}).(string)
	return request
}

func repairEpisode(r AgentRecord) string {
	request, generation := r.Spec.RequestID, 0
	for id, g := range r.TurnGenerations {
		if _, internal := r.TurnOrigins[id]; !internal && g <= r.Generation && (g > generation || g == generation && id < request) {
			request, generation = id, g
		}
	}
	return workflowHash(r.ID + "\x00" + request)
}

func repairFailure(r AgentRecord) bool {
	return r.State == "failed" || r.State == "timed_out" || r.State == "persistence_failed"
}

func (e *motherRepairEvent) matchesSource(r AgentRecord) bool {
	return e.Source == r.ID && e.Generation == r.Generation && e.Attempt == r.ChatRetryAttempt
}

func (m workspaceMessage) undeliveredInterruptedRepair() bool {
	return m.State == "interrupted" && m.Repair != nil && m.Repair.Automatic &&
		m.Generation == 0 && m.AgentID == ""
}

func repairBlockedCode(code string) bool {
	switch code {
	case "task_token_limit", "task_request_limit", "mother_repair_limit", "access_denied", "quota", "account_cooling", "provider_blocked", "model_not_activated", "model_region", "provider_client_restriction":
		return true
	}
	return false
}

func (m *AgentManager) motherRepairHome() (*WorkspaceHost, *AgentManager) {
	if m.linkHome != nil {
		return m.linkHome, m
	}
	if m.linkContacts != nil {
		if root, err := m.linkContacts(); err == nil && root != nil {
			return root.linkHome, root
		}
	}
	if m.workspace != nil && m.workspace.host != nil {
		if root, err := m.workspace.host.conversationManager(); err == nil {
			return m.workspace.host, root
		}
	}
	return nil, nil
}

func (w *Workspace) repairServiceLocked(kind string) *AgentManager {
	switch kind {
	case "conversation":
		return w.manager.linkRootService.Load()
	case "native":
		return w.manager
	case "package":
		return w.manager.packageHost.Load()
	case "workflow":
		return w.manager.workboxHost.Load()
	}
	return nil
}

func (m *AgentManager) independentRepairSource(r AgentRecord) bool {
	if !repairFailure(r) || r.Spec.WorkspaceRole != "" || r.Link != nil || r.Instance != nil ||
		r.Spec.WorkflowID != "" || r.LinkCancelled || r.DeletionPending || m.ctx.Err() != nil {
		return false // Supervised members already report through their own outbox.
	}
	if r.Spec.GroupID != "" {
		conversationGroupsMu.Lock()
		g, err := m.readGroup(r.Spec.GroupID)
		coordinator := err == nil && !g.Deleted && g.member(g.coordinatorKey()) != nil && g.member(g.coordinatorKey()).Session == r.ID
		conversationGroupsMu.Unlock()
		if !coordinator {
			return false // Ordinary group members retain their own coordinator.
		}
	}
	return true
}

func (m *AgentManager) settleMotherRepair(r AgentRecord) {
	if !m.independentRepairSource(r) {
		return
	}
	h, root := m.motherRepairHome()
	if h == nil || root == nil {
		return
	}
	if r.MotherRepairNotice != nil {
		if home := h.motherRepairWorkspace(); home != nil {
			home.mu.Lock()
			home.manager.linkRootService.Store(root)
			home.deliverMotherRepairNoticeLocked(m, r, "queued")
			home.mu.Unlock()
		}
		return
	}
	cause := "failure"
	if r.Failure != nil {
		cause = r.Failure.Code
	}
	_, _ = h.enqueueMotherRepair(m, root, r, cause, m.redact(r.Error), "failure")
}

func (h *WorkspaceHost) motherRepairWorkspace() *Workspace {
	h.mu.Lock()
	defer h.mu.Unlock()
	var home *Workspace
	if !h.closed && !h.updateFrozen && h.mode == HostOS {
		for _, w := range h.workspaces {
			if w.split == nil && w.coreLinkRegistered.Load() {
				if home != nil {
					return nil
				}
				home = w
			}
		}
	}
	return home
}

func (h *WorkspaceHost) prepareMotherRepairNotice(r AgentRecord) *motherRepairNotice {
	home := h.motherRepairWorkspace()
	if home == nil {
		return nil
	}
	home.mu.Lock()
	defer home.mu.Unlock()
	if home.closed || home.updateFrozen || home.beginContextBookLocked() != nil {
		return nil
	}
	session := home.contextSessionLocked()
	return &motherRepairNotice{Scope: session.ID, Generation: r.Generation, Attempt: r.ChatRetryAttempt, RepairEpoch: session.RepairEpoch}
}

func (w *Workspace) deliverMotherRepairNoticeLocked(m *AgentManager, r AgentRecord, state string) {
	notice := r.MotherRepairNotice
	if !notice.matches(r) || notice.Scope != w.coreLinkScopeLocked() || w.closed || w.updateFrozen {
		return
	}
	current, err := m.Status(m.owner, r.ID)
	if err != nil || !notice.matches(current) || current.MotherRepairNotice == nil || *current.MotherRepairNotice != *notice ||
		!m.independentRepairSource(current) {
		return
	}
	cause := "failure"
	if current.Failure != nil {
		cause = current.Failure.Code
	}
	if session := w.contextSessionLocked(); session != nil && notice.RepairEpoch != session.RepairEpoch {
		state = "cancelled"
	}
	if _, err = w.enqueueRepairWithStateLocked(m, current, cause, m.redact(current.Error), "failure", "", nil, state); err != nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if j := m.jobs[r.ID]; j != nil && j.record.MotherRepairNotice != nil && *j.record.MotherRepairNotice == *notice {
		prior := j.record.MotherRepairNotice
		j.record.MotherRepairNotice = nil
		if err = m.saveLocked(j); err != nil {
			j.record.MotherRepairNotice = prior
		}
	}
}

func (w *Workspace) recoverMotherRepairNoticesLocked(m *AgentManager, scope string) {
	m.mu.Lock()
	var pending []AgentRecord
	for _, j := range m.jobs {
		r := j.record
		if n := r.MotherRepairNotice; n.matches(r) && n.Scope == scope && repairFailure(r) {
			pending = append(pending, copyRecord(r))
		}
	}
	m.mu.Unlock()
	sort.Slice(pending, func(i, j int) bool {
		if pending[i].CompletedAt == pending[j].CompletedAt {
			return pending[i].ID < pending[j].ID
		}
		return pending[i].CompletedAt < pending[j].CompletedAt
	})
	for _, r := range pending {
		w.deliverMotherRepairNoticeLocked(m, r, "interrupted")
	}
}

func (h *WorkspaceHost) enqueueMotherRepair(source, root *AgentManager, r AgentRecord, cause, detail, request string) (workspaceMessage, error) {
	home := h.motherRepairWorkspace()
	if home == nil {
		return workspaceMessage{}, fmt.Errorf("母体当前不可用，求助原文已保留")
	}
	home.mu.Lock()
	defer home.mu.Unlock()
	home.manager.linkRootService.Store(root)
	return home.enqueueRepairLocked(source, r, cause, detail, request, "", nil)
}

func (w *Workspace) enqueueRepairLocked(source *AgentManager, r AgentRecord, cause, detail, request, text string, origin *conversationLinkOrigin) (workspaceMessage, error) {
	return w.enqueueRepairWithStateLocked(source, r, cause, detail, request, text, origin, "queued")
}

func (w *Workspace) enqueueRepairWithStateLocked(source *AgentManager, r AgentRecord, cause, detail, request, text string, origin *conversationLinkOrigin, state string) (workspaceMessage, error) {
	if !sessionIDPattern.MatchString(r.ID) || r.Generation < 1 || cause == "" || len(cause) > 80 {
		return workspaceMessage{}, fmt.Errorf("修理事件来源无效")
	}
	kind := ""
	for _, candidate := range []string{"conversation", "native", "package", "workflow"} {
		if w.repairServiceLocked(candidate) == source {
			kind = candidate
			break
		}
	}
	if kind == "" || r.Spec.WorkspaceRole == WorkspaceMatrix {
		return workspaceMessage{}, fmt.Errorf("修理事件不属于这个母体")
	}
	// Same source attempt and cause is one case. Every original report is
	// still in the source's tool archive or Link log, available for inspection.
	requestHash := workflowHash(cause + "\x00" + detail)
	for _, msg := range w.state.Messages {
		if e := msg.Repair; e != nil && e.matchesSource(r) {
			if hash, exists := e.Requests[request]; exists {
				if hash != requestHash {
					return workspaceMessage{}, fmt.Errorf("修理请求编号冲突")
				}
				return msg, nil
			}
		}
	}
	for i, msg := range w.state.Messages {
		if e := msg.Repair; e != nil && e.matchesSource(r) && e.Cause == cause {
			if len(e.Requests) >= 32 {
				return workspaceMessage{}, fmt.Errorf("同一修理事件求助次数已达上限，请回查原收据")
			}
			next := *e
			next.Requests = map[string]string{}
			for id, hash := range e.Requests {
				next.Requests[id] = hash
			}
			next.Requests[request] = requestHash
			w.state.Messages[i].Repair = &next
			if err := w.saveLocked(); err != nil {
				w.state.Messages[i].Repair = e
				return workspaceMessage{}, err
			}
			return w.state.Messages[i], nil
		}
	}
	now := time.Now().UTC()
	event := &motherRepairEvent{Source: r.ID, Service: kind, Generation: r.Generation, Attempt: r.ChatRetryAttempt, Cause: cause, Episode: repairEpisode(r), Automatic: true, Requests: map[string]string{request: requestHash}}
	count, recent := 0, 0
	var last time.Time
	for _, msg := range w.state.Messages {
		old := msg.Repair
		if old == nil || !old.Automatic {
			continue
		}
		at, _ := time.Parse(time.RFC3339Nano, msg.At)
		if now.Sub(at) < 10*time.Minute {
			recent++
		}
		if old.Source == r.ID && old.Episode == event.Episode {
			count++
			if old.Cause == cause && at.After(last) {
				last = at
			}
		}
	}
	if state == "cancelled" {
		event.Automatic = false
	} else if count >= 3 || recent >= 12 {
		event.Blocked = "主动修理次数已达上限，原文和执行结果保留，等待用户继续"
	} else if repairBlockedCode(cause) {
		event.Blocked = "预算、账号或权限需要处理，未自动重试目标任务"
	} else if until := last.Add(30 * time.Second); until.After(now) {
		event.NotBefore = until.Format(time.RFC3339Nano)
	}
	if origin == nil {
		key := fmt.Sprintf("%s/%d/%s", r.ID, r.Generation, cause)
		if event.Attempt > 0 {
			key += fmt.Sprintf("/retry:%d", event.Attempt)
		}
		request = "mother-repair-" + workflowHash(key)
	}
	if text == "" {
		text = formatPromptText(runtimePrompt("Matrix/辅助指令/母体修理.txt"), r.ID, r.Generation, cause, utf8Prefix(source.redact(detail), 8000))
	}
	if event.Blocked != "" {
		state, event.Automatic = "blocked", false
		text += "\n" + event.Blocked
	}
	return w.enqueueMessageWithRepairLocked(r.ID, WorkspaceMatrix, request, text, state, taskMessageHash(text), nil, origin, event, "", "mother_repair")
}

// Check at both idle dispatch and the current actor's safe tool boundary. A
// stopped/superseded source never restarts just because its old notice arrived.
func (w *Workspace) repairReadyLocked(msg workspaceMessage) (bool, string) {
	e := msg.Repair
	if e == nil {
		return true, ""
	}
	source := w.repairServiceLocked(e.Service)
	if source == nil {
		return false, "interrupted"
	}
	r, err := source.Status(source.owner, e.Source)
	if err != nil || !e.matchesSource(r) || r.LinkCancelled || r.DeletionPending || r.State == "cancelled" || r.State == "cancelling" || r.State == "interrupted" {
		return false, "cancelled"
	}
	if until, err := time.Parse(time.RFC3339Nano, e.NotBefore); err == nil && time.Now().Before(until) {
		return false, ""
	}
	if r.Spec.Kind == "conversation" && source.checkConversationAuthority(r) != nil || r.Instance != nil && (r.Instance.Disabled || source.admitPackageSteering(context.Background(), r) != nil) {
		return false, "blocked"
	}
	if r.Spec.WorkspaceRole != "" && source.admitFixedRole(context.Background(), r.Spec.WorkspaceRole) != nil {
		return false, "blocked"
	}
	if id := w.state.Roles[WorkspaceMatrix]; id != "" {
		mother, err := w.manager.Status(w.state.ID, id)
		if err != nil || mother.LinkCancelled || mother.State == "cancelled" || mother.State == "cancelling" {
			return false, "cancelled"
		}
		if mother.State == "waiting_user" {
			return false, ""
		}
		if !activeAgent(mother.State) && mother.Failure != nil {
			if code := mother.Failure.Code; code != "mother_repair_limit" && repairBlockedCode(code) {
				return false, "blocked"
			}
			// An unsuccessful repair must not turn the whole inbox off. Use
			// the failed run's durable request to fence only its original task.
			if run := mother.RepairRun; run != nil && repairFailure(mother) {
				for _, previous := range w.state.Messages {
					if previous.ID == run.Request && previous.Repair != nil && previous.Repair.Source == e.Source && previous.Repair.Episode == e.Episode {
						return false, "blocked"
					}
				}
			}
		}
	}
	return true, ""
}

// Dispatch is asynchronous and can wait for a network slot. Recheck the
// source after acquiring that slot, before spending the first automatic call.
// Later source generations may be the result of this mother's own repair;
// their mutation APIs retain the ordinary generation/cancellation fences.
func (m *AgentManager) admitMotherRepairRequest(r AgentRecord) error {
	b := r.RepairRun
	if b == nil || r.Requests != b.RequestBase || m.workspace == nil {
		return nil
	}
	w := m.workspace
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, msg := range w.state.Messages {
		if msg.ID == b.Request && msg.Repair != nil {
			if ready, _ := w.repairReadyLocked(msg); ready {
				return nil
			}
			break
		}
	}
	return errMotherRepairStopped
}

func (m *AgentManager) requestMotherHelp(ctx context.Context, r AgentRecord, request, cause, detail string) (any, error) {
	if request == "" || len(request) > 96 || strings.TrimSpace(detail) == "" || len(detail) > 8000 {
		return nil, fmt.Errorf("求助需要稳定request_id及有界message")
	}
	if cause != "help" && cause != "no_progress" && cause != "responsibility_conflict" {
		return nil, fmt.Errorf("求助原因必须是help/no_progress/responsibility_conflict")
	}
	if ctx.Err() != nil || r.Spec.WorkspaceRole == WorkspaceMatrix {
		return nil, fmt.Errorf("母体不能向自身重复派发修理")
	}
	if r.Spec.Kind == "conversation" {
		if err := m.checkConversationAuthority(r); err != nil {
			return nil, err
		}
	} else if err := m.admitPackageSteering(ctx, r); err != nil {
		return nil, err
	}
	h, root := m.motherRepairHome()
	if h == nil || root == nil {
		return nil, fmt.Errorf("当前宿主没有全局母体，求助原文已保留")
	}
	msg, err := h.enqueueMotherRepair(m, root, r, cause, detail, request)
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "request_id": request, "event_id": msg.ID, "state": msg.State, "not_before": msg.Repair.NotBefore, "reason": msg.Repair.Blocked}, nil
}
