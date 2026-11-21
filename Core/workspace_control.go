// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workspaceMessageHash; controlSend; controlSendScoped; linkNotice; controlStatus; controlCancel; controlEvents
// Impact: python -B scripts/code-atlas.py show Core/workspace_control.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
)

func workspaceMessageHash(m workspaceMessage) string {
	if m.MessageHash != "" {
		return m.MessageHash
	}
	return attachmentMessageHash(m.Text, m.Attachments)
}

// 摘要绑定原始字节，正文仍先脱敏；两者随同一消息原子保存。
func (w *Workspace) controlSend(id, text string, attachments ...ComposerAttachment) (workspaceMessage, error) {
	return w.controlSendScoped("", id, text, attachments...)
}

// The epoch changes with the active conversation. Check it in the same
// critical section as enqueue so a concurrent switch cannot redirect a send.
func (w *Workspace) controlSendScoped(epoch, id, text string, attachments ...ComposerAttachment) (workspaceMessage, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if epoch != "" && epoch != w.epoch {
		return workspaceMessage{}, fmt.Errorf("workspace changed; inspect the active conversation before sending")
	}
	hash := attachmentMessageHash(text, attachments)
	return w.enqueueAttachmentsLocked("user", WorkspaceMatrix, id, w.manager.redact(text), "queued", hash, attachments)
}

// 宿主收到办公室点名时叫醒 Eyra：走普通队列，界面显示为一条来源提示而不是用户发言。
func (w *Workspace) linkNotice(id, text, display string) (workspaceMessage, error) {
	if w.Mode() != HostOS {
		return workspaceMessage{}, fmt.Errorf("只有 Aieyra OS 能接收办公室提示")
	}
	if !strings.HasPrefix(id, "link-") || strings.TrimSpace(display) == "" {
		return workspaceMessage{}, fmt.Errorf("办公室提示无效")
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.startupDeferred {
		return workspaceMessage{}, fmt.Errorf("模块启动未启用 Eyra 自动工作；办公室提示保留待用户开始任务后处理")
	}
	return w.enqueueAttachmentsLocked("user", WorkspaceMatrix, id, w.manager.redact(text), "queued", "", nil, w.manager.redact(display), "link")
}

// Preserve the pre-existing Control exchange surface while the desktop uses
// richer workspace snapshots. A stale Control cancel cannot stop a newer task.
func (w *Workspace) controlStatus(request string) (any, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := w.reconcileDeliveredLocked(); err != nil {
		return nil, err
	}
	records := []any{}
	var current AgentRecord
	if id := w.state.Roles[WorkspaceMatrix]; id != "" {
		current, _ = w.manager.Status(w.state.ID, id)
	}
	generationInputs := map[int]int{}
	for _, m := range w.state.Messages {
		if workspaceChatInput(m) {
			generationInputs[m.Generation]++
		}
	}
	for index, m := range w.state.Messages {
		if m.From != "user" || m.To != WorkspaceMatrix {
			continue
		}
		state := m.State
		if state == "delivered" || state == "queued" {
			state = "running"
		}
		row := map[string]any{"request_id": m.ID, "message_hash": workspaceMessageHash(m), "state": state, "phase": m.State, "started_at": m.At, "updated_at": m.At, "model": current.Spec.ModelID, "generation": m.Generation}
		if m.Error != "" {
			row["error"] = m.Error
		}
		turnID := m.TurnID
		if turnID == "" {
			turnID = m.ID
		}
		for i := len(w.state.Messages) - 1; m.Generation > 0 && i > index; i-- {
			out := w.state.Messages[i]
			if !workspaceChatOutput(out) || out.Generation != m.Generation || m.AgentID != "" && out.AgentID != "" && m.AgentID != out.AgentID {
				continue
			}
			// Old replies without a turn ID are usable only when the generation
			// identifies a single input. Current replies carry the original ID.
			if out.TurnID == turnID || out.TurnID == "" && generationInputs[m.Generation] == 1 {
				row["reply"], row["updated_at"] = out.Text, out.At
				row["reply_id"], row["agent_id"], row["turn_id"] = out.ID, out.AgentID, turnID
				if state != "completed" {
					row["error"] = out.Text
				}
				break
			}
		}
		if request == m.ID {
			return row, nil
		}
		records = append(records, row)
	}
	if request != "" {
		if old, ok := w.retiredMessages[request]; ok {
			m := old.Message
			return map[string]any{"request_id": m.ID, "message_hash": m.MessageHash, "state": m.State, "phase": m.State, "started_at": m.At, "updated_at": m.At, "generation": m.Generation, "chat_retained": false}, nil
		}
		return nil, fmt.Errorf("request not found")
	}
	return map[string]any{"busy": activeAgent(current.State), "phase": current.State, "model": current.Spec.ModelID, "requests": records}, nil
}

func (w *Workspace) controlCancel(request string) (any, error) {
	w.mu.Lock()
	current, _ := w.manager.Status(w.state.ID, w.state.Roles[WorkspaceMatrix])
	valid := false
	for _, message := range w.state.Messages {
		if message.ID == request && message.To == WorkspaceMatrix && (message.State == "queued" || message.State == "delivered" && message.Generation == current.Generation) {
			valid = true
			break
		}
	}
	if !valid {
		w.mu.Unlock()
		return nil, fmt.Errorf("request is not active")
	}
	// 检查请求与取消共用工作区锁，避免取消到刚开始的下一轮。
	err := w.cancelLocked()
	w.mu.Unlock()
	if err != nil {
		return nil, err
	}
	return w.controlStatus(request)
}

func (w *Workspace) controlEvents(args json.RawMessage) (any, error) {
	var p struct {
		Cursor int64 `json:"cursor"`
		Limit  int   `json:"limit"`
	}
	if err := json.Unmarshal(args, &p); err != nil {
		return nil, err
	}
	w.mu.Lock()
	id := w.state.Roles[WorkspaceMatrix]
	w.mu.Unlock()
	if id == "" {
		return map[string]any{"events": []any{}, "cursor": 0, "has_more": false}, nil
	}
	return w.manager.events(filepath.Join(w.manager.dir, "sessions", id+".jsonl"), p.Cursor, p.Limit)
}
