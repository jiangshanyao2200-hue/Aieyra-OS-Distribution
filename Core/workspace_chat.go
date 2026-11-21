// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workspaceChatTurns; workspaceRetiredMessage; workspaceTextHash; workspaceChatInput; workspaceChatOutput; workspacePendingInput; retainChatLocked; snapshotMessagesLocked
// Impact: python -B scripts/code-atlas.py show Core/workspace_chat.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"crypto/sha256"
	"fmt"
)

const workspaceChatTurns = 20

// Retired request receipts contain identity and terminal status, never the
// discarded chat body. Keep them for the runtime so retries cannot execute twice.
type workspaceRetiredMessage struct {
	Message  workspaceMessage
	TextHash string
}

func workspaceTextHash(text string) string { return fmt.Sprintf("%x", sha256.Sum256([]byte(text))) }

func workspaceChatInput(m workspaceMessage) bool {
	return m.From == "user" && m.To == WorkspaceMatrix
}

func workspaceChatOutput(m workspaceMessage) bool {
	return m.From == WorkspaceMatrix && m.To == "user" && m.State != "commentary"
}

func workspacePendingInput(m workspaceMessage) bool {
	switch m.State {
	case "queued", "context", "delivered", "waiting_human", "waiting_user", "running", "cancelling":
		return true
	}
	return false
}

// Call only at mutation boundaries, never from saveLocked: dispatch/drain may
// still hold pointers into Messages. Model archives and tool receipts are owned
// by the manager and are deliberately outside this ordinary-chat retention.
func (w *Workspace) retainChatLocked() {
	if w.Mode() != HostOS {
		return
	}
	keep := map[string]bool{}
	generations := map[int]bool{}
	count := 0
	for i := len(w.state.Messages) - 1; i >= 0; i-- {
		m := w.state.Messages[i]
		if !workspaceChatInput(m) {
			continue
		}
		count++
		if count <= workspaceChatTurns || workspacePendingInput(m) {
			keep[m.ID] = true
			if m.Generation > 0 {
				generations[m.Generation] = true
			}
		}
	}
	rows := make([]workspaceMessage, 0, len(w.state.Messages))
	for _, m := range w.state.Messages {
		retain := true
		switch {
		case workspaceChatInput(m):
			retain = keep[m.ID]
			if !retain {
				if w.retiredMessages == nil {
					w.retiredMessages = map[string]workspaceRetiredMessage{}
				}
				receipt := m
				receipt.MessageHash, receipt.Text, receipt.Error = workspaceMessageHash(m), "", ""
				receipt.Attachments = nil
				w.retiredMessages[m.ID] = workspaceRetiredMessage{Message: receipt, TextHash: attachmentMessageHash(m.Text, m.Attachments)}
			}
		case workspaceChatOutput(m):
			if m.TurnID != "" {
				retain = keep[m.TurnID]
			} else if m.Generation > 0 {
				// Compatibility for replies created before explicit turn linking.
				retain = generations[m.Generation]
			}
		}
		if retain {
			rows = append(rows, m)
		}
	}
	if len(rows) != len(w.state.Messages) {
		w.state.Messages = rows
		w.state.Revision++
	}
}

// The bounded process tail must not displace retained chat or queued requests.
// Legacy and CLI keep their existing paged snapshot contract.
func (w *Workspace) snapshotMessagesLocked() []workspaceMessage {
	rows := w.state.Messages
	if w.Mode() != HostOS {
		return append([]workspaceMessage{}, rows[max(0, len(rows)-200):]...)
	}
	selected := make([]bool, len(rows))
	process := 0
	for i := len(rows) - 1; i >= 0; i-- {
		m := rows[i]
		if workspaceChatInput(m) || workspaceChatOutput(m) || workspacePendingInput(m) {
			selected[i] = true
		} else if process < 200 {
			selected[i] = true
			process++
		}
	}
	result := make([]workspaceMessage, 0, min(len(rows), 300))
	for i, m := range rows {
		if selected[i] {
			result = append(result, m)
		}
	}
	return result
}
