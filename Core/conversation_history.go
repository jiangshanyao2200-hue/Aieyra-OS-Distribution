// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: conversationHistory
// Impact: python -B scripts/code-atlas.py show Core/conversation_history.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
)

// Full conversation history and originals use the OS history index, search,
// pagination and receipt readers. Opening it has no execution side effects.
func (m *AgentManager) conversationHistory(raw json.RawMessage) (any, error) {
	var p struct{ Action, ID string }
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	before, err := m.privateReceiptTarget(conversationReceiptRequest{ID: p.ID})
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	j := m.jobs[p.ID]
	if j == nil || j != before.target || j.record.DeletionPending {
		m.mu.Unlock()
		return nil, fmt.Errorf("会话历史已变化")
	}
	if j.historyView == nil {
		j.historyView = &Workspace{manager: m, config: m.config, dir: m.dir, historySession: p.ID, state: workspaceState{ID: m.owner, Roles: map[string]string{}}}
	}
	view := j.historyView
	m.mu.Unlock()
	var args map[string]any
	if err = json.Unmarshal(raw, &args); err != nil {
		return nil, err
	}
	args["task_id"], args["segment"], args["all_history"] = p.ID, p.ID, true
	var result any
	if p.Action == "history_receipt" {
		result, err = view.historyReceipt(rawJSON(args))
	} else {
		result, err = view.historyPage(rawJSON(args))
	}
	if err != nil {
		return nil, err
	}
	after, err := m.privateReceiptTarget(conversationReceiptRequest{ID: p.ID})
	if err != nil {
		return nil, err
	}
	if before != after {
		return nil, fmt.Errorf("会话历史所属身份已变化")
	}
	return result, nil
}
