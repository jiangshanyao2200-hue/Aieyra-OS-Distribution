// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestConversationFullHistoryIsPagedScopedAndReadOnly; TestConversationChatPageReconcilesLiveIDsWithoutCollapsingRepeatedTurns
// Impact: python -B scripts/code-atlas.py show Core/conversation_history_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestConversationFullHistoryIsPagedScopedAndReadOnly(t *testing.T) {
	h, m := receiptConversationFixture(t)
	id, other := strings.Repeat("a", 32), strings.Repeat("b", 32)
	j, _ := receiptConversationSession(t, m, id, "own-tool-original")
	foreign, _ := receiptConversationSession(t, m, other, "foreign-tool-secret")
	for n := 1; n <= 45; n++ {
		receiptMeta(t, j.archive, id, n)
		receiptAppend(t, j.archive, "message", Message{Role: RoleUser, Content: fmt.Sprintf("original-user-%02d", n)})
		receiptAppend(t, j.archive, "message", Message{Role: RoleAssistant, Content: fmt.Sprintf("original-answer-%02d", n)})
	}
	receiptAppend(t, j.archive, "message", Message{Role: RoleUser, Name: "core_link_instruction", Content: "internal-not-user"})
	receiptAppend(t, foreign.archive, "message", Message{Role: RoleUser, Content: "foreign-private-message"})
	seen := map[string]bool{}
	before := ""
	for page := 0; page < 10; page++ {
		v, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "history", "id": id, "before": before, "limit": 17}))
		if err != nil {
			t.Fatal(err)
		}
		result := v.(map[string]any)
		for _, row := range result["entries"].([]historyEntry) {
			if seen[row.ID] {
				t.Fatal("duplicate history page", row.ID)
			}
			seen[row.ID] = true
			if strings.Contains(row.Text, "foreign") || strings.Contains(row.Text, "internal-not-user") {
				t.Fatal("history scope or source was lost")
			}
		}
		if result["has_more"] != true {
			break
		}
		before = result["before"].(string)
	}
	if len(seen) != 91 {
		t.Fatalf("history was truncated to live rounds: %d", len(seen))
	}
	if foreign.historyView != nil || foreign.receiptHistory != nil || j.cancel != nil || j.done != nil {
		t.Fatal("history initialized another session or execution")
	}
	v, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "history", "id": id, "query": "original-user-01"}))
	if err != nil {
		t.Fatal(err)
	}
	rows := v.(map[string]any)["entries"].([]historyEntry)
	if len(rows) != 1 || rows[0].Text != "original-user-01" {
		t.Fatal("full history search omitted old original", rows)
	}
	v, err = h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "history_receipt", "id": id, "entry_id": rows[0].ID}))
	if err != nil || !strings.Contains(string(rawJSON(v)), "original-user-01") {
		t.Fatal("original history receipt unavailable", v, err)
	}
}

func TestConversationChatPageReconcilesLiveIDsWithoutCollapsingRepeatedTurns(t *testing.T) {
	h, m := receiptConversationFixture(t)
	id := strings.Repeat("a", 32)
	j, _ := receiptConversationSession(t, m, id, "original-tool")
	j.record.Generation = 2
	j.record.State = "completed"
	j.record.Result = "same answer"
	j.record.Turns = map[string]string{"first-request": "same input", "second-request": "same input"}
	j.record.TurnGenerations = map[string]int{"first-request": 1, "second-request": 2}
	j.record.History = []AgentOutcome{{Generation: 1, State: "completed", Result: "same answer"}}
	for n := 1; n <= 2; n++ {
		receiptMeta(t, j.archive, id, n)
		receiptAppend(t, j.archive, "message", Message{Role: RoleUser, Content: "same input"})
		receiptAppend(t, j.archive, "message", Message{Role: RoleAssistant, Content: "same answer"})
	}
	value, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "chat_page", "id": id}))
	if err != nil {
		t.Fatal(err)
	}
	rows := value.(map[string]any)["entries"].([]map[string]any)
	want := map[string]bool{"first-request": true, "second-request": true, id + ":1:reply": true, id + ":2:reply": true}
	if len(rows) != 4 {
		t.Fatalf("history duplicated or collapsed repeated original turns: %+v", rows)
	}
	for _, row := range rows {
		snapshot, _ := row["snapshot_id"].(string)
		if !want[snapshot] || !strings.HasPrefix(row["id"].(string), "context-message:") {
			t.Fatalf("archive/live identity mismatch: %+v", row)
		}
		delete(want, snapshot)
	}
	if len(want) != 0 || j.cancel != nil || j.done != nil {
		t.Fatal("missing identity or read started execution", want)
	}
}
