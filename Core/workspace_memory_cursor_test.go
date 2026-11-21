// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkspaceContextRoutesOpaqueMemoryCursors
// Impact: python -B scripts/code-atlas.py show Core/workspace_memory_cursor_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestWorkspaceContextRoutesOpaqueMemoryCursors(t *testing.T) {
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { fixtureAnswer(w, "cursor", "已经记录", nil) })
	w := modeWorkspace(t, m.config, dir, HostOS)
	w.service = NewSettingsService(m.config)
	t.Cleanup(func() { w.flushTranscript(3 * time.Second); w.service.Close() })
	contextTestTurn(t, w, "EARLIER_CURSOR_MESSAGE")
	text := "CURSOR_ORIGINAL " + strings.Repeat("逐字原文🪶\n", 500) + " TAIL"
	contextTestTurn(t, w, text)
	// Completing a turn queues transcript indexing; wait for this owned outbox
	// before asserting against the independently indexed history.
	w.flushTranscript(3 * time.Second)
	call := func(args memoryRow) memoryRow {
		t.Helper()
		args["action"] = "records"
		r, err := w.Call(context.Background(), "workspace.context", rawJSON(args))
		if err != nil {
			t.Fatal(err)
		}
		var out memoryRow
		if err = json.Unmarshal(rawJSON(r), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	history := call(memoryRow{"memory_action": "history", "query": "CURSOR_ORIGINAL", "limit": 1})
	rows := history["records"].([]any)
	if len(rows) != 1 {
		t.Fatal(history)
	}
	row := rows[0].(map[string]any)
	var content, cursor string
	for n := 0; n < 100; n++ {
		page := call(memoryRow{"memory_action": "original", "key": row["key"], "position": row["position"], "cursor": cursor, "limit_chars": 256})
		content += memString(page["content"])
		cursor = memString(page["next_cursor"])
		if cursor == "" {
			break
		}
	}
	var original Message
	if err := json.Unmarshal([]byte(content), &original); err != nil || original.Content != text {
		t.Fatal("original changed", err)
	}
	first := call(memoryRow{"memory_action": "history", "limit": 1})
	if memString(first["next_cursor"]) == "" {
		t.Fatal("expected another history page", first)
	}
	call(memoryRow{"memory_action": "history", "limit": 1, "cursor": first["next_cursor"]})
	if _, err := w.Call(context.Background(), "workspace.snapshot", rawJSON(memoryRow{"cursor": "not-a-number"})); err == nil {
		t.Fatal("snapshot must still require numeric cursor")
	}
}
