// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: sendReceipt
// Impact: python -B scripts/code-atlas.py show Core/workspace_send_receipt.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
)

// Read only: a missing receipt is unknown, never permission to replay an old
// runtime's input in the current conversation. No model or archive is opened.
func (w *Workspace) sendReceipt(raw json.RawMessage) (any, error) {
	var p struct {
		RequestID   string               `json:"request_id"`
		Message     string               `json:"message"`
		Attachments []ComposerAttachment `json:"attachments"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if p.RequestID == "" || len(p.RequestID) > 128 || len(p.Message) > 64<<10 {
		return nil, fmt.Errorf("消息确认参数无效")
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	hash := attachmentMessageHash(p.Message, p.Attachments)
	match := func(messages []workspaceMessage) bool {
		for _, m := range messages {
			if m.ID == p.RequestID && m.From == "user" && m.To == WorkspaceMatrix && workspaceMessageHash(m) == hash {
				return true
			}
		}
		return false
	}
	accepted := match(w.state.Messages)
	if old, ok := w.retiredMessages[p.RequestID]; ok && old.Message.From == "user" && old.Message.To == WorkspaceMatrix {
		originalHash := old.Message.MessageHash
		if originalHash == "" {
			originalHash = old.TextHash // Compatibility for receipts without the original hash.
		}
		if originalHash == hash {
			accepted = true
		}
	}
	if !accepted && w.contextBook != nil {
		for _, s := range w.contextBook.Sessions {
			if match(s.Messages) {
				accepted = true
				break
			}
		}
	}
	return map[string]any{"ok": true, "request_id": p.RequestID, "accepted": accepted}, nil
}
