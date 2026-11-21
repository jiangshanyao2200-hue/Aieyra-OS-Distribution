// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: chatRetryRequest; retryChat; chatRetryInput; chatRetryReadOnlyTool; retryChat
// Impact: python -B scripts/code-atlas.py show Core/chat_retry.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type chatRetryRequest struct {
	ID         string `json:"id"`
	SessionID  string `json:"session_id"`
	Generation int    `json:"generation"`
	Attempt    int    `json:"attempt"`
}

func (w *Workspace) retryChat(raw json.RawMessage) (any, error) {
	var p chatRetryRequest
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	session := w.contextSessionLocked()
	if w.closed || w.updateFrozen || p.SessionID != w.state.ID || p.ID == "" || p.ID != w.state.Roles[WorkspaceMatrix] {
		return nil, fmt.Errorf("会话已切换，请查看当前回执")
	}
	var archive *SessionArchive
	if session != nil && session.Archive != "" {
		archive = &SessionArchive{Path: w.contextArchivePath(session.Archive)}
	}
	value, err := w.manager.retryChat(w.state.ID, p.ID, p, archive)
	if err == nil && value["accepted"] == true {
		w.live[WorkspaceMatrix] = WorkspaceLive{Phase: "waiting", Generation: p.Generation, Revision: w.live[WorkspaceMatrix].Revision + 1}
	}
	return value, err
}

func chatRetryInput(r AgentRecord) (string, []ComposerAttachment, bool) {
	var request string
	for id, generation := range r.TurnGenerations {
		if generation != r.Generation {
			continue
		}
		if request != "" {
			return "", nil, false
		}
		request = id
	}
	if _, internal := r.TurnOrigins[request]; internal {
		return "", nil, false
	}
	text, exists := r.Turns[request]
	attachments := r.TurnAttachments[request]
	return text, attachments, request != "" && exists && (strings.TrimSpace(text) != "" || len(attachments) != 0)
}

// This is deliberately explicit. Tools outside this set can publish, charge,
// execute or change local state even when their names mention reading.
func chatRetryReadOnlyTool(name string) bool {
	switch name {
	case "read_file", "list_files", "search_files":
		return true
	default:
		return false
	}
}

func (m *AgentManager) retryChat(owner, id string, p chatRetryRequest, archive *SessionArchive) (map[string]any, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.ownsLocked(owner, id) {
		return nil, fmt.Errorf("会话已变化，请刷新")
	}
	j := m.jobs[id]
	r := j.record
	if p.Generation < 1 || r.Generation != p.Generation || p.Attempt < 0 || p.Attempt > r.ChatRetryAttempt {
		return nil, fmt.Errorf("执行回执已变化，请刷新")
	}
	receipt := map[string]any{"ok": true, "id": id, "generation": p.Generation, "chat_retry_attempt": r.ChatRetryAttempt}
	if p.Attempt < r.ChatRetryAttempt {
		return receipt, nil
	}
	if m.updateFrozen || m.ctx.Err() != nil || r.DeletionPending || r.CompactionRun != "" ||
		r.LinkCancelled || r.MotherTakeover != nil || r.RepairRun != nil || len(r.PendingMessages) != 0 ||
		(r.State != "failed" && r.State != "timed_out") || r.Failure == nil || !r.Failure.Retryable || r.Delivery != nil {
		return nil, fmt.Errorf("执行回执当前不可重试")
	}
	select {
	case <-j.done:
	default:
		return nil, errAgentFinishing
	}
	message, attachments, ok := chatRetryInput(r)
	if !ok {
		return nil, fmt.Errorf("没有找到唯一的原用户输入")
	}
	if j.archive != nil {
		archive = j.archive
	}
	if archive == nil {
		path, err := SessionPath(filepath.Join(m.dir, "config.json"), id)
		if err != nil {
			return nil, err
		}
		archive = &SessionArchive{Path: path}
	}
	restored, err := archive.read()
	if err != nil && (!os.IsNotExist(err) || r.Requests > r.TurnRequestBase) {
		return nil, err
	}
	if restored != nil && (restored.Truncated || restored.WorkspaceGeneration > r.Generation ||
		restored.WorkspaceGeneration == r.Generation && (restored.GenerationEffect || restored.GenerationUncertain)) {
		return nil, fmt.Errorf("本轮已有执行记录，请先查看原回执")
	}
	if r.Spec.Kind == "conversation" {
		resolved, err := m.resolveConversationSpec(r)
		if err != nil {
			return nil, err
		}
		settings, err := m.specSettings(resolved)
		if err != nil {
			return nil, err
		}
		j.conversationTurn, j.conversationSettings = &resolved, settings
	}
	if len(attachments) != 0 {
		settings, err := m.specSettings(r.Spec)
		if err != nil {
			return nil, err
		}
		if _, err = prepareComposerAttachments(m.config, attachments, m.conversationImageSettings(settings)); err != nil {
			return nil, err
		}
	}
	j.record.ChatRetryAttempt++
	j.record.State, j.record.Result, j.record.Error, j.record.Failure = "queued", "", "", nil
	j.record.Acceptance, j.record.Evidence, j.record.CompletedAt = "pending", "", ""
	j.record.RunTime = nil
	if err := m.saveLocked(j); err != nil {
		j.record = r
		return nil, err
	}
	j.done = make(chan struct{})
	m.launchLocked(j, message, true, attachments...)
	receipt["chat_retry_attempt"] = j.record.ChatRetryAttempt
	receipt["accepted"] = true
	return receipt, nil
}
