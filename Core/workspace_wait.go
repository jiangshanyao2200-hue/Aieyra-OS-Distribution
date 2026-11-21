// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: waitTeamBoundary
// Impact: python -B scripts/code-atlas.py show Core/workspace_wait.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "context"

func (w *Workspace) waitTeamBoundary(ctx context.Context, id string) (AgentRecord, error) {
	for {
		w.mu.Lock()
		pending := false
		for _, message := range w.state.Messages {
			if message.To == WorkspaceMatrix && (message.State == "queued" || message.State == "context") {
				pending = true
				break
			}
		}
		w.mu.Unlock()
		if pending {
			return w.manager.Status(w.state.ID, id)
		}
		w.manager.mu.Lock()
		job := w.manager.jobs[id]
		done := job.done
		w.manager.mu.Unlock()
		select {
		case <-ctx.Done():
			return AgentRecord{}, ctx.Err()
		case <-done:
			return w.manager.Status(w.state.ID, id)
		case <-w.notified:
		}
	}
}
