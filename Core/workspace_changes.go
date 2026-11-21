// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: noteChanges
// Impact: python -B scripts/code-atlas.py show Core/workspace_changes.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"time"
)

// Change receipts notify the map owner without waking an idle model. They are
// delivered at its next requested read/review boundary, never applied as a
// deterministic source index or an unverified rewrite of the agent's map.
func (w *Workspace) noteChanges(key string, patch PatchResult) error {
	if len(patch.Files) == 0 {
		return nil
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	id := "changes_" + workspaceHash([]byte(key))[:32]
	for _, message := range w.state.Messages {
		if message.ID == id {
			return nil
		}
	}
	files := []any{}
	for _, file := range patch.Files {
		files = append(files, map[string]any{"path": file.Path, "new_path": file.NewPath, "before_sha256": file.BeforeHash, "after_sha256": file.AfterHash, "operation": file.Operation})
	}
	data, _ := json.Marshal(map[string]any{"state": patch.State, "files": files, "instruction": runtimePrompt("Matrix/辅助指令/文件变更通知.txt")})
	w.state.Messages = append(w.state.Messages, workspaceMessage{ID: id, From: WorkspaceMatrix, To: WorkspaceProject, Reference: true, State: "context", Text: string(data), At: time.Now().UTC().Format(time.RFC3339Nano)})
	return w.saveLocked()
}
