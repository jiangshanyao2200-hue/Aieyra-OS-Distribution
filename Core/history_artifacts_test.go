// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestDeliveredFilesSurviveRestartInHistory
// Impact: python -B scripts/code-atlas.py show Core/history_artifacts_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestDeliveredFilesSurviveRestartInHistory(t *testing.T) {
	file := filepath.Join(t.TempDir(), "memory.sqlite")
	now := int64(1780000000000)
	s := nativeMemory(t, file, &now, now)
	note := artifactNoteRow("previous", 0, workspaceMessage{Artifacts: []WorkspaceArtifact{{Path: "搬家待办.html", Kind: "html"}, {Path: "docs/说明.md", Kind: "markdown"}}})
	note.At = now + 2
	rows := []any{
		map[string]any{"key": "previous/agent", "pos": 0, "at": now, "role": RoleUser, "content": "做个搬家待办网页"},
		map[string]any{"key": "previous/agent", "pos": 1, "at": now + 1, "role": RoleAssistant, "content": "做好了。"},
		map[string]any{"key": note.Key, "pos": note.Pos, "at": note.At, "role": note.Role, "name": note.Name, "content": note.Content},
		map[string]any{"key": "current/agent", "pos": 0, "at": now + 3, "role": RoleUser, "content": "current excluded"},
	}
	fastCall(t, s, memoryRow{"action": "transcript_append", "rows": rows})
	r := fastCall(t, s, memoryRow{"action": "transcript_history", "exclude_prefix": "current/", "limit": 10})
	data, _ := json.Marshal(r["rows"])
	var raw []memoryHistoryRow
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatal(err)
	}
	entries := projectMemoryRows(raw)
	if len(entries) != 2 || entries[0].Text != "做好了。" || len(entries[0].Artifacts) != 2 || entries[0].Artifacts[0].Path != "搬家待办.html" || entries[0].Artifacts[1].Kind != "markdown" || len(entries[1].Artifacts) != 0 {
		t.Fatalf("delivered files not attached to their reply: %+v", entries)
	}
	// A note whose reply is on another page still offers its files on its own.
	alone := projectMemoryRows(raw[:1])
	if len(alone) != 1 || len(alone[0].Artifacts) != 2 || alone[0].Text != "" {
		t.Fatalf("standalone note: %+v", alone)
	}
}
