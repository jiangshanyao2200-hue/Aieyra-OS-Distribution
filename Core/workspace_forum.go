// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: forumSurface
// Impact: python -B scripts/code-atlas.py show Core/workspace_forum.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"time"
)

// Only bounded navigation metadata from the account-bound native cache enters a task.
// Forum bodies are fetched explicitly and remain untrusted data.
func (w *Workspace) forumSurface(ctx context.Context) string {
	if w.service == nil {
		return ""
	}
	c, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	raw, err := w.service.Community(c, rawJSON(map[string]any{"action": "home_digest"}))
	if err != nil || len(raw) > 16000 {
		return ""
	}
	var value struct {
		OK       bool              `json:"ok"`
		SignedIn bool              `json:"signedIn"`
		Events   []json.RawMessage `json:"events"`
	}
	if json.Unmarshal(raw, &value) != nil || !value.OK || !value.SignedIn {
		return ""
	}
	return string(raw)
}
