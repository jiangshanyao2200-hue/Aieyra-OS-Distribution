// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: conversationCompaction; cloneConversationCompaction; conversationCompactionPending; validateConversationCompactions; conversationCompactionStatus; requestConversationCompaction; adoptConversationCompaction; settleConversationCompaction; conversationMaintenanceDone; finishConversationMaintenance; recoverConversationCompaction
// Impact: python -B scripts/code-atlas.py show Core/conversation_compaction.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

// One request belongs to the target's own archive and generation. A busy turn
// consumes it only between committed tool groups. An idle maintenance run uses
// the same runtime, but adds no input, tools or user-visible answer.
type conversationCompaction struct {
	ID         string           `json:"id"`
	Operator   string           `json:"operator"`
	Reason     string           `json:"reason"`
	Generation int              `json:"generation"`
	State      string           `json:"state"`
	PriorState string           `json:"prior_state,omitempty"`
	Outcome    *CompactionState `json:"outcome,omitempty"`
	Error      string           `json:"error,omitempty"`
}

func cloneConversationCompaction(v *conversationCompaction) *conversationCompaction {
	if v == nil {
		return nil
	}
	c := *v
	c.Outcome = cloneCompaction(v.Outcome)
	return &c
}

func conversationCompactionPending(v *conversationCompaction) bool {
	return v != nil && (v.State == "scheduled" || v.State == "running")
}

func validateConversationCompactions(r AgentRecord) error {
	if (len(r.Compactions) > 0 || r.CompactionRun != "") && r.Spec.Kind != "conversation" {
		return fmt.Errorf("上下文整理只属于独立会话")
	}
	for id, v := range r.Compactions {
		if v == nil || v.ID != id || id == "" || len(id) > 96 || v.Operator == "" || strings.TrimSpace(v.Reason) == "" || len(v.Reason) > 2000 || v.Generation < 0 || v.Generation > r.Generation {
			return fmt.Errorf("上下文整理身份或代次无效")
		}
		switch v.State {
		case "scheduled", "running", "completed", "skipped", "deferred", "failed", "cancelled", "interrupted":
		default:
			return fmt.Errorf("上下文整理回执状态无效")
		}
		if v.PriorState != "" && activeAgent(v.PriorState) {
			return fmt.Errorf("空闲整理不能恢复为活跃任务")
		}
		if v.Outcome != nil && (v.Outcome.Purpose != "mother_maintenance" || validateCompaction(v.Outcome, v.Outcome.Covered, v.Outcome.State == "completed") != nil) {
			return fmt.Errorf("上下文整理结果无效")
		}
	}
	if id := r.CompactionRun; id != "" && (r.Compactions[id] == nil || r.Compactions[id].PriorState == "") {
		return fmt.Errorf("空闲整理缺少原任务状态")
	}
	return nil
}

func (m *AgentManager) conversationCompactionStatus(id, request string) (any, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	j := m.jobs[id]
	if j == nil || j.record.Spec.Kind != "conversation" {
		return nil, fmt.Errorf("目标不是会话实例")
	}
	if v := j.record.Compactions[request]; v != nil {
		return cloneConversationCompaction(v), nil
	}
	return nil, fmt.Errorf("未找到该上下文整理请求")
}

func (m *AgentManager) requestConversationCompaction(ctx context.Context, id, request, reason, operator string, generation int) (any, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if request == "" || len(request) > 96 || strings.TrimSpace(reason) == "" || len(reason) > 2000 || operator == "" {
		return nil, fmt.Errorf("整理需要有效请求编号、操作者和原因")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	j := m.jobs[id]
	if j == nil || j.record.Spec.Kind != "conversation" || j.record.DeletionPending {
		return nil, fmt.Errorf("目标会话不可用")
	}
	if old := j.record.Compactions[request]; old != nil {
		if old.Generation != generation || old.Operator != operator || old.Reason != reason {
			return nil, fmt.Errorf("整理请求编号内容冲突")
		}
		return cloneConversationCompaction(old), nil
	}
	if m.updateFrozen || m.ctx.Err() != nil || j.record.Generation != generation || j.record.LinkCancelled || j.record.State == "cancelled" || j.record.State == "cancelling" || j.record.State == "waiting_user" || j.record.MotherTakeover != nil {
		return nil, fmt.Errorf("会话已停止、等待用户、交接中或代次变化")
	}
	for _, v := range j.record.Compactions {
		if conversationCompactionPending(v) {
			return nil, fmt.Errorf("已有上下文整理排队，请先回查结果")
		}
	}
	busy := activeAgent(j.record.State)
	if busy && j.finishing {
		return nil, fmt.Errorf("当前回合正在提交，请稍后按同一编号重试")
	}
	if !busy && j.done != nil {
		select {
		case <-j.done:
		default:
			return nil, fmt.Errorf("当前会话尚未完全结束")
		}
	}
	spec, err := m.resolveConversationSpec(j.record)
	if err != nil {
		return nil, err
	}
	settings, err := m.specSettings(spec)
	if err != nil {
		return nil, err
	}
	v := &conversationCompaction{ID: request, Operator: operator, Reason: reason, Generation: generation, State: "scheduled"}
	if j.record.Compactions == nil {
		j.record.Compactions = map[string]*conversationCompaction{}
	}
	previous := copyRecord(j.record)
	j.record.Compactions[request] = v
	if !busy {
		v.PriorState = j.record.State
		j.record.CompactionRun = request
		j.record.State = "queued"
		j.runStarted.Store(0)
		j.runCheckpointStart = 0
	}
	if err = m.saveLocked(j); err != nil {
		j.record = previous
		return nil, err
	}
	if !busy {
		j.done = make(chan struct{})
		j.conversationTurn = &spec
		j.conversationSettings = settings
		m.launchLocked(j, "", true)
	}
	return cloneConversationCompaction(v), nil
}

// This executes in the target runtime after previous-run compaction recovery.
func (m *AgentManager) adoptConversationCompaction(j *agentJob, a *SessionArchive, c *contextCompaction) error {
	if compactionPending(c.snapshot()) {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, value := range j.record.Compactions {
		if value.State != "scheduled" || value.Generation != j.record.Generation {
			continue
		}
		v := cloneConversationCompaction(value)
		v.State = "running"
		v.Outcome = &CompactionState{RequestID: "mother-" + workflowHash(j.record.ID+":"+v.ID), Trigger: "manual", State: "scheduled", Purpose: "mother_maintenance", Updated: time.Now().UTC().Format(time.RFC3339Nano)}
		if err := a.Append("compaction_state", v.Outcome); err != nil {
			return err
		}
		j.record.Compactions[v.ID] = v
		if err := m.saveLocked(j); err != nil {
			return err
		}
		c.set(v.Outcome)
		return nil
	}
	return nil
}

func (m *AgentManager) settleConversationCompaction(j *agentJob, c *contextCompaction, runErr error, ended bool) error {
	outcome := c.snapshot()
	m.mu.Lock()
	defer m.mu.Unlock()
	changed := false
	for id, old := range j.record.Compactions {
		if !conversationCompactionPending(old) || old.Generation != j.record.Generation {
			continue
		}
		v := cloneConversationCompaction(old)
		if outcome != nil && v.Outcome != nil && outcome.RequestID == v.Outcome.RequestID && !compactionPending(outcome) {
			v.State, v.Outcome = outcome.State, cloneCompaction(outcome)
			if j.record.CompactionRun == id && outcome.State == "completed" && outcome.Compression != nil && j.record.Context != nil {
				j.record.Context.Tokens = max(0, j.record.Context.Tokens-outcome.Compression.BeforeTokens+outcome.Compression.AfterTokens)
			}
		} else if ended {
			v.State = "interrupted"
			if errors.Is(runErr, context.Canceled) {
				v.State = "cancelled"
			}
			if runErr != nil {
				v.Error = m.redact(runErr.Error())
			}
		} else {
			continue
		}
		j.record.Compactions[id] = v
		changed = true
	}
	if changed {
		return m.saveLocked(j)
	}
	return nil
}

func (m *AgentManager) conversationMaintenanceDone(j *agentJob) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return j.record.CompactionRun != "" && !conversationCompactionPending(j.record.Compactions[j.record.CompactionRun])
}

// Called from finish before ordinary task completion/Link result processing.
// Result, error, delivery, user messages and generation remain the old task's.
func (m *AgentManager) finishConversationMaintenance(j *agentJob, runErr error) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	id := j.record.CompactionRun
	if id == "" {
		return false
	}
	v := cloneConversationCompaction(j.record.Compactions[id])
	if v == nil {
		j.record.State = "persistence_failed"
		j.record.Error = "上下文整理缺少恢复记录"
		_ = m.saveLocked(j)
		return true
	}
	if conversationCompactionPending(v) {
		v.State = "interrupted"
		if errors.Is(runErr, context.Canceled) {
			v.State = "cancelled"
		}
	}
	if runErr != nil && v.Error == "" {
		v.Error = m.redact(runErr.Error())
	}
	j.record.Compactions[id] = v
	j.record.State = v.PriorState
	j.record.CompactionRun = ""
	j.finishing = true
	if err := m.saveLocked(j); err != nil {
		j.record.CompactionRun = id
		j.record.State = "persistence_failed"
		j.record.Error = "上下文整理收尾未提交，原结果和档案保留"
	}
	return true
}

// Process loss never creates another summary request. Adopt a matching durable
// checkpoint if it committed; otherwise retain an interrupted receipt.
func (m *AgentManager) recoverConversationCompaction(j *agentJob) (bool, error) {
	changed := false
	for id, old := range j.record.Compactions {
		if !conversationCompactionPending(old) {
			continue
		}
		v := cloneConversationCompaction(old)
		path, err := SessionPath(filepath.Join(m.dir, "config.json"), j.record.ID)
		if err != nil {
			return false, err
		}
		a := &SessionArchive{Path: path}
		r, err := a.read()
		if err == nil && r.Compaction != nil && v.Outcome != nil && r.Compaction.RequestID == v.Outcome.RequestID && !compactionPending(r.Compaction) {
			v.State, v.Outcome = r.Compaction.State, cloneCompaction(r.Compaction)
			if v.State == "completed" {
				j.record.Compression = v.Outcome.Compression
			}
		} else {
			v.State = "interrupted"
			v.Error = "进程在整理完成回执前结束；原文保留，不自动再次请求模型"
			if v.Outcome != nil {
				v.Outcome.State = "interrupted"
				v.Outcome.Code = "PREVIOUS_RUN_INTERRUPTED"
				v.Outcome.Updated = time.Now().UTC().Format(time.RFC3339Nano)
			}
		}
		j.record.Compactions[id] = v
		changed = true
	}
	if id := j.record.CompactionRun; id != "" {
		v := j.record.Compactions[id]
		if v == nil || v.PriorState == "" {
			return false, fmt.Errorf("上下文整理缺少原会话状态")
		}
		j.record.State = v.PriorState
		j.record.CompactionRun = ""
		changed = true
	}
	if changed {
		return true, m.saveLocked(j)
	}
	return false, nil
}
