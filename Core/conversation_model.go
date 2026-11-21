// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: configureSessionModel
// Impact: python -B scripts/code-atlas.py show Core/conversation_model.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "fmt"

// A quick selection belongs to one conversation. Builtin defaults continue to
// belong to model connections; an admitted request retains its frozen spec.
func (m *AgentManager) configureSessionModel(id string, revision int, model string) (any, error) {
	conversationContactsMu.Lock()
	defer conversationContactsMu.Unlock()
	if contact, sessions, err := m.liveContact(id); err == nil && contact.Program != "" {
		if len(sessions) != 1 || sessions[0].ID != id {
			return nil, fmt.Errorf("程序会话绑定不唯一")
		}
		return m.updateContact(contactPatch{ID: contact.ID, ModelID: model, ModelUnconfigured: model == "", ExpectedRevision: &revision})
	}
	m.sessionDeleteMu.Lock()
	defer m.sessionDeleteMu.Unlock()
	if model != "" {
		if _, err := m.settings(model); err != nil {
			return nil, err
		}
	}
	c, sessions, err := m.liveContact(id)
	if err != nil {
		return nil, err
	}
	if c.Defaults == nil && builtinConversationRole(c.Builtin) == "" && len(sessions) > 0 {
		c.Defaults = conversationDefaults(sessions[len(sessions)-1].Spec)
		if err = m.writeContact(c); err != nil {
			return nil, err
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	j := m.jobs[id]
	if j == nil || j.record.Spec.Kind != "conversation" || j.record.DeletionPending {
		return nil, fmt.Errorf("会话不存在或正在清理")
	}
	if j.record.ConversationRevision != revision {
		return nil, fmt.Errorf("设置已更新，请重新读取后保存")
	}
	old := copyRecord(j.record)
	j.record.ConversationModel = model
	j.record.ConversationRevision++
	if err = m.saveLocked(j); err != nil {
		j.record = old
		return nil, err
	}
	return map[string]any{"ok": true, "model_id": model, "effective": "next_request_boundary", "revision": j.record.ConversationRevision}, nil
}
