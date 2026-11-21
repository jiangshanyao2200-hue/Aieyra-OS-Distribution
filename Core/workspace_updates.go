// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: freezeForUpdate; admissionFrozen; updateNotice
// Impact: python -B scripts/code-atlas.py show Core/workspace_updates.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
)

// TryLock avoids reversing the existing workspace -> host order used by
// configuration calls. All workspace locks are retained until frozen, so
// sends, greetings and queue dispatch cannot slip past the idle decision.
func (h *WorkspaceHost) freezeForUpdate(freeze bool) (any, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	locked := []*Workspace{}
	defer func() {
		for _, w := range locked {
			w.mu.Unlock()
		}
	}()
	for _, w := range h.workspaces {
		if !w.mu.TryLock() {
			return map[string]any{"ok": true, "idle": false}, nil
		}
		locked = append(locked, w)
	}
	// Snapshot chat/statistics before retaining manager locks: the shared
	// context catalog reads role status through those same manager locks.
	if freeze {
		for _, w := range locked {
			if err := w.saveLocked(); err != nil {
				return nil, err
			}
		}
	}
	// Hold manager admission and child-host publication together. Reading a
	// list and freezing later lets a private conversation start in the gap.
	managers := []*AgentManager{}
	if h.conversations != nil {
		managers = append(managers, h.conversations)
	}
	for _, w := range locked {
		managers = append(managers, w.manager)
	}
	seen := map[*AgentManager]bool{}
	unlocks := []func(){}
	defer func() {
		for i := len(unlocks) - 1; i >= 0; i-- {
			unlocks[i]()
		}
	}()
	for i := 0; i < len(managers); i++ {
		m := managers[i]
		if m == nil || seen[m] {
			continue
		}
		seen[m] = true
		if !m.packageInitMu.TryLock() {
			return map[string]any{"ok": true, "idle": false}, nil
		}
		unlocks = append(unlocks, m.packageInitMu.Unlock)
		if !m.workboxInitMu.TryLock() {
			return map[string]any{"ok": true, "idle": false}, nil
		}
		unlocks = append(unlocks, m.workboxInitMu.Unlock)
		if !m.mu.TryLock() {
			return map[string]any{"ok": true, "idle": false}, nil
		}
		unlocks = append(unlocks, m.mu.Unlock)
		if child := m.packageHost.Load(); child != nil {
			managers = append(managers, child)
		}
		if child := m.workboxHost.Load(); child != nil {
			managers = append(managers, child)
		}
		if freeze {
			for _, job := range m.jobs {
				if activeAgent(job.record.State) {
					return map[string]any{"ok": true, "idle": false}, nil
				}
			}
		}
	}
	if freeze {
		for _, w := range locked {
			if w.split != nil {
				w.split.mu.Lock()
				connecting := w.split.CancelJoin != nil
				w.split.mu.Unlock()
				if connecting {
					return map[string]any{"ok": true, "idle": false}, nil
				}
			}
			if w.greeting.State == "connecting" || w.startupWorkers > 0 {
				return map[string]any{"ok": true, "idle": false}, nil
			}
			for _, message := range w.state.Messages {
				if message.State == "queued" || message.State == "context" {
					return map[string]any{"ok": true, "idle": false}, nil
				}
			}
		}
	}
	for _, w := range locked {
		w.updateFrozen = freeze
	}
	for m := range seen {
		m.updateFrozen = freeze
	}
	h.updateFrozen = freeze
	return map[string]any{"ok": true, "idle": true, "frozen": freeze}, nil
}

func (m *AgentManager) admissionFrozen() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.updateFrozen
}
func (w *Workspace) updateNotice(ctx context.Context) (any, error) {
	raw, err := w.service.CallTool(ctx, "updates", w.state.ID, json.RawMessage(`{"action":"status"}`))
	if err != nil {
		return nil, err
	}
	var status struct {
		Phase    string `json:"phase"`
		Notified bool   `json:"notified"`
		Manual   bool   `json:"manual"`
		Release  *struct {
			ID      string `json:"id"`
			Version string `json:"version"`
		} `json:"release"`
	}
	if err = json.Unmarshal(raw, &status); err != nil {
		return nil, err
	}
	if status.Phase != "available" || status.Notified || status.Release == nil {
		return map[string]bool{"ok": true}, nil
	}
	w.mu.Lock()
	busy := w.updateFrozen || w.greeting.State == "connecting" || w.startupWorkers > 0
	for _, m := range w.state.Messages {
		busy = busy || m.State == "queued"
	}
	for _, record := range w.manager.List(w.state.ID) {
		busy = busy || activeAgent(record.State) || record.State == "waiting_user"
	}
	w.mu.Unlock()
	if busy {
		return map[string]any{"ok": true, "pending": true}, nil
	}
	text := formatPromptText(runtimePrompt("Matrix/辅助指令/更新通知.txt"), status.Release.Version, status.Release.ID)
	if status.Manual {
		text = formatPromptText(runtimePrompt("Matrix/辅助指令/Mac更新通知.txt"), status.Release.Version, status.Release.ID)
	}
	result, err := w.enqueue("cloud", WorkspaceMatrix, "release-"+status.Release.ID, text)
	if err != nil {
		return nil, err
	}
	ack, _ := json.Marshal(map[string]string{"action": "notice_ack", "id": status.Release.ID})
	_, err = w.service.CallTool(ctx, "updates", w.state.ID, ack)
	return result, err
}
