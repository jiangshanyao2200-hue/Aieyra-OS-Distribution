// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestChatPageConversationPagesRoundsFromArchive; TestChatPageWorkingConversationKeepsProgressInsideWorkTranscript
// Impact: python -B scripts/code-atlas.py show Core/conversation_chat_page_conversation_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

// A private or program conversation has no group log: its rounds come from the
// durable archive through the history projection. chat_page must cut them into
// rounds, page backwards without loss, and say who spoke.
func TestChatPageConversationPagesRoundsFromArchive(t *testing.T) {
	h, m := receiptConversationFixture(t)
	id := strings.Repeat("a", 32)
	j, _ := receiptConversationSession(t, m, id, "own-tool-original")
	const rounds = 45
	for n := 1; n <= rounds; n++ {
		receiptMeta(t, j.archive, id, n)
		// The archive stamps each record with the wall clock; a burst of writes can share one tick on
		// a coarse clock, and ties would fall back to the hash id. Keep fixture timestamps distinct.
		time.Sleep(2 * time.Millisecond)
		receiptAppend(t, j.archive, "message", Message{Role: RoleUser, Content: fmt.Sprintf("original-user-%02d", n)})
		time.Sleep(2 * time.Millisecond)
		receiptAppend(t, j.archive, "message", Message{Role: RoleAssistant, Content: fmt.Sprintf("original-answer-%02d", n)})
		time.Sleep(2 * time.Millisecond)
	}
	page := func(before string, limit int) map[string]any {
		t.Helper()
		v, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "chat_page", "id": id, "kind": "conversation", "before": before, "limit_rounds": limit}))
		if err != nil {
			t.Fatal(err)
		}
		return v.(map[string]any)
	}
	var pages [][]map[string]any
	before := ""
	for n := 0; ; n++ {
		if n > 5 {
			t.Fatal("paging never reached the oldest round")
		}
		p := page(before, 20)
		if p["reset"] == true {
			t.Fatal("a cursor issued inside the same page chain was reset", p)
		}
		pages = append(pages, p["entries"].([]map[string]any))
		if p["has_more"] != true {
			break
		}
		before = p["before"].(string)
	}
	if len(pages) != 3 {
		t.Fatalf("45 rounds at 20 per page should take three pages, got %d", len(pages))
	}
	want := []int{20, 20, 5}
	for i, entries := range pages {
		distinct := map[string]bool{}
		for _, e := range entries {
			distinct[e["round_id"].(string)] = true
		}
		if len(distinct) != want[i] {
			t.Fatalf("page %d holds %d rounds, want %d", i, len(distinct), want[i])
		}
	}
	seen := map[string]bool{}
	var users []string
	for i := len(pages) - 1; i >= 0; i-- {
		for _, e := range pages[i] {
			key := e["id"].(string)
			if seen[key] {
				t.Fatal("entry repeated across pages", e)
			}
			seen[key] = true
			if e["kind"] != "message" {
				t.Fatal("process rows must not count as chat", e)
			}
			text := e["text"].(string)
			if strings.HasPrefix(text, "original-user-") {
				users = append(users, text)
				if e["sender_id"] != "user" {
					t.Fatalf("a user message must be labelled user, got %q: %v", e["sender_id"], e)
				}
			} else if e["sender_id"] == "user" {
				t.Fatalf("an answer must not be labelled user: %v", e)
			}
		}
	}
	if len(users) != rounds || len(seen) != 2*rounds {
		t.Fatalf("paged history lost messages: %d user messages, %d entries", len(users), len(seen))
	}
	for n, text := range users {
		if text != fmt.Sprintf("original-user-%02d", n+1) {
			t.Fatalf("paged history is out of order at %d: %s", n, text)
		}
	}
}

func TestChatPageWorkingConversationKeepsProgressInsideWorkTranscript(t *testing.T) {
	h, m := receiptConversationFixture(t)
	id := strings.Repeat("b", 32)
	j, _ := receiptConversationSession(t, m, id, "owned-original")
	receiptMeta(t, j.archive, id, 1)
	receiptAppend(t, j.archive, "message", Message{Role: RoleUser, Content: "检查实际文件"})
	time.Sleep(2 * time.Millisecond)
	receiptAppend(t, j.archive, "message", Message{Role: RoleAssistant, Content: "我正在打开文件。"})
	time.Sleep(2 * time.Millisecond)
	receiptAppend(t, j.archive, "message", Message{Role: RoleAssistant, Content: "检查完成。"})
	for _, state := range []string{"running", "waiting_user", "completed", "failed"} {
		m.mu.Lock()
		j.record.State, j.record.Generation = state, 1
		m.mu.Unlock()
		v, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "chat_page", "id": id, "kind": "conversation", "limit_rounds": 20}))
		if err != nil {
			t.Fatal(err)
		}
		rows := v.(map[string]any)["entries"].([]map[string]any)
		if len(rows) != 3 {
			t.Fatal("history lost the original messages", rows)
		}
		for _, row := range rows {
			want := row["sender_id"] != "user" && (state != "completed" || row["text"] != "检查完成。")
			if row["process"] != want {
				t.Fatalf("state=%s: process=%v want=%v row=%v", state, row["process"], want, row)
			}
		}
	}
	m.mu.Lock()
	j.record.State = "idle"
	m.mu.Unlock()
}
