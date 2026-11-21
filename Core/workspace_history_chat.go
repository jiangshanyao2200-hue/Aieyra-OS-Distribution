// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: managedHistoryMessage; historyChatKey; managedHistoryChat
// Impact: python -B scripts/code-atlas.py show Core/workspace_history_chat.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"fmt"
	"sort"
	"strings"
)

// Managed history reads the original conversation, independently of the short
// live chat tail and the model's current checkpoint. Internal context edits,
// recalls and collaborator instructions are not human conversation records.
func managedHistoryMessage(m Message) bool {
	if m.Role == RoleAssistant {
		return m.Name == ""
	}
	if m.Role != RoleUser {
		return false
	}
	if m.Name != "" {
		return strings.HasPrefix(m.Name, "workspace_") && strings.HasPrefix(m.Content, "【你工作时用户补充了 ")
	}
	prefix := RecallPrefix()
	return prefix == "" || !strings.HasPrefix(m.Content, prefix)
}

func historyChatKey(generation int, role, originalRole, name, content string, attachments ...ComposerAttachment) string {
	if originalRole == RoleUser && name == "" {
		// The archive stores the host's manifest in Content; the live chat keeps
		// it separately. Match the original body and snapshot metadata, not the
		// shortened display text or today's attachment instruction wording.
		if len(attachments) == 0 {
			if at, items, ok := historyAttachmentManifest(content); ok {
				content, attachments = content[:at], items
			}
		}
		if len(attachments) > 0 {
			return fmt.Sprintf("%d:%s:attachments:%s", generation, role, attachmentMessageHash(content, attachments))
		}
	}
	return fmt.Sprintf("%d:%s:%s", generation, role, workspaceTextHash(historySupplementText(originalRole, name, content)))
}

// Reconcile exact originals with recent delivery metadata. Generation and
// multiplicity matter: two identical submissions are still two messages.
// Named supplemental batches have their own durable source identity.
func managedHistoryChat(entries map[string]historyEntry, messages []workspaceMessage) (map[string]bool, map[string]workspaceMessage) {
	byKey := map[string][]historyEntry{}
	names := map[string]bool{}
	for _, v := range entries {
		if v.chatKey == "" {
			continue
		}
		byKey[v.chatKey] = append(byKey[v.chatKey], v)
		if v.chatName != "" {
			names[v.chatName] = true
		}
	}
	for key := range byKey {
		sort.Slice(byKey[key], func(i, j int) bool { return historyKey(byKey[key][i]) < historyKey(byKey[key][j]) })
	}
	matched := map[string]bool{}
	projected := map[string]workspaceMessage{}
	for i := len(messages) - 1; i >= 0; i-- {
		m := messages[i]
		if internalTeamNotification(m) || m.Generation <= 0 || !(workspaceChatInput(m) || workspaceChatOutput(m)) {
			continue
		}
		if m.DeliveryName != "" && names[m.DeliveryName] {
			matched[m.ID] = true
			continue
		}
		role := RoleUser
		if m.From == WorkspaceMatrix {
			role = RoleAssistant
		}
		key := historyChatKey(m.Generation, m.From, string(role), "", m.Text, m.Attachments...)
		rows := byKey[key]
		if len(rows) == 0 {
			continue
		}
		v := rows[len(rows)-1]
		byKey[key] = rows[:len(rows)-1]
		matched[m.ID], projected[v.ID] = true, m
	}
	return matched, projected
}
