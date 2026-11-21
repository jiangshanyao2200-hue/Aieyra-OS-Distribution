// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: cloneWorkspaceModels; mergeWorkspaceUsage; backgroundUsageScopeLocked; recordBackgroundUsageLocked
// Impact: python -B scripts/code-atlas.py show Core/workspace_preferences.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// Session preferences and accounting follow the durable conversation, while
// runtime workspaces and execution roles remain disposable.
func cloneWorkspaceModels(models map[string]string) map[string]string {
	next := make(map[string]string, len(models))
	for role, model := range models {
		next[role] = model
	}
	return next
}

// Add receipt summaries without turning absent cache/reasoning into known zero.
// JSON catalogs contain float64 counts; live summaries contain ints.
func mergeWorkspaceUsage(values ...map[string]any) map[string]any {
	out := workspaceUsage(nil)
	for key, value := range out {
		if _, ok := value.(int); !ok {
			continue
		}
		total := 0
		for _, row := range values {
			total += int(memInt(row[key]))
		}
		out[key] = total
	}
	samples := out["samples"].(int)
	chat := samples - out["image_samples"].(int)
	out["cached_known"] = chat > 0 && out["cache_reported"].(int) == chat
	out["reasoning_known"] = chat > 0 && out["reasoning_reported"].(int) == chat
	out["complete"] = samples > 0 && out["reported"].(int) == samples
	return out
}

// Capture before releasing the workspace lock for a provider call. A cancelled
// or late reply still belongs to the source conversation, never the new view.
func (w *Workspace) backgroundUsageScopeLocked() string {
	if s := w.contextSessionLocked(); s != nil {
		return s.ID
	}
	return w.state.ID
}

func (w *Workspace) recordBackgroundUsageLocked(scope string, settings *Settings, u AgentUsage) {
	if w.contextBook == nil && w.Mode() == HostOS && w.split == nil && w.coreLinkRegistered.Load() {
		// The first incurred startup cost also needs a durable owner, even
		// when no user turn follows. Adopt older receipts before adding this one.
		if err := w.beginContextBookLocked(); err != nil {
			w.feed.publish(WorkspaceMatrix, "error", map[string]string{"message": "后台用量归属保存失败：" + w.manager.redact(err.Error())})
		}
	}
	if scope == w.state.ID && w.initialContextID != "" {
		scope = w.initialContextID
	}
	u = w.manager.appendBackgroundUsage(scope, WorkspaceMatrix, settings, u)
	w.greetingUsage = append(w.greetingUsage, u)
	w.greeting.Revision++
	if w.contextBook == nil {
		return // The first durable conversation adopts these startup receipts.
	}
	for i := range w.contextBook.Sessions {
		s := &w.contextBook.Sessions[i]
		if s.ID != scope {
			continue
		}
		s.BackgroundUsage = mergeWorkspaceUsage(s.BackgroundUsage, workspaceUsage([]AgentUsage{u}))
		if err := w.saveContextBookLocked(w.contextBook); err != nil {
			// Keep the actual receipt in memory and the existing usage ledger.
			// A later catalog save retries persistence, never charges it again.
			w.feed.publish(WorkspaceMatrix, "error", map[string]string{"message": "后台用量保存失败：" + w.manager.redact(err.Error())})
		}
		return
	}
}
