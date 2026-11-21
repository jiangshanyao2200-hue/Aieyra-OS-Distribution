// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/memoryservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestPACHistoryPagingConcurrentWrites; TestPACHistoryCursorBindsQueryAndScope; TestPACHistoryLegacyNumericCursorRemainsReadable
// Impact: python -B scripts/code-atlas.py show Core/memoryservice/history_cursor_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package memory

import (
	"context"
	"fmt"
	"testing"
)

// A real lookup adds its own user/tool transcript between pages. Neither that
// insertion nor forgetting an already returned row may shift the next page.
func TestPACHistoryPagingConcurrentWrites(t *testing.T) {
	for _, change := range []string{"append", "forget"} {
		t.Run(change, func(t *testing.T) {
			s := pacTestStore(t)
			messages := []Message{}
			for i := 0; i < 6; i++ {
				messages = append(messages, Message{Role: RoleUser, Content: fmt.Sprintf("连续检索🌿 %d", i)})
			}
			pacTestTranscript(t, s, "project:a", "cursor-original", messages)
			first := memoryCall(t, s, memoryRow{"action": "pac_history", "query": "连续检索🌿", "limit": 2}, "project:a", "test")
			seen := map[int64]bool{}
			for _, row := range first["records"].([]memoryRow) {
				seen[memInt(row["position"])] = true
			}
			if len(seen) != 2 || !seen[5] || !seen[4] {
				t.Fatal("unexpected initial page", first)
			}
			if change == "append" {
				pacTestTranscript(t, s, "project:a", "cursor-newer", []Message{{Role: RoleUser, Content: "连续检索🌿 new query"}})
				if err := memoryExec(context.Background(), s.db, "UPDATE transcript SET at=(SELECT MAX(at)+1 FROM transcript) WHERE session='cursor-newer'"); err != nil {
					t.Fatal(err)
				}
			} else if err := memoryExec(context.Background(), s.db, "DELETE FROM transcript_payloads WHERE session='cursor-original' AND pos=5; DELETE FROM transcript WHERE session='cursor-original' AND pos=5"); err != nil {
				t.Fatal(err)
			}
			cursor := first["next_cursor"]
			for pages := 0; cursor != nil && pages < 4; pages++ {
				page := memoryCall(t, s, memoryRow{"action": "pac_history", "query": "连续检索🌿", "limit": 2, "cursor": cursor}, "project:a", "test")
				for _, row := range page["records"].([]memoryRow) {
					position := memInt(row["position"])
					if row["key"] != "cursor-original" || seen[position] {
						t.Fatalf("new transcript shifted continuation: %v", row)
					}
					seen[position] = true
				}
				cursor = page["next_cursor"]
			}
			if cursor != nil || len(seen) != 6 {
				t.Fatalf("continuation skipped originals: seen=%v cursor=%v", seen, cursor)
			}
		})
	}
}

func TestPACHistoryCursorBindsQueryAndScope(t *testing.T) {
	s := pacTestStore(t)
	pacTestTranscript(t, s, "project:a", "cursor-bound", []Message{{Role: RoleUser, Content: "琥珀🌱 first"}, {Role: RoleUser, Content: "琥珀🌱 second"}})
	first := memoryCall(t, s, memoryRow{"action": "pac_history", "query": "琥珀🌱", "limit": 1}, "project:a", "test")
	for _, input := range []struct{ query, scope string }{{"different", "project:a"}, {"琥珀🌱", "project:b"}} {
		if _, err := s.Call(context.Background(), memoryRow{"action": "pac_history", "query": input.query, "cursor": first["next_cursor"]}, input.scope, "test"); err == nil {
			t.Fatal("continuation silently accepted another query or project", input)
		}
	}
}

func TestPACHistoryLegacyNumericCursorRemainsReadable(t *testing.T) {
	s := pacTestStore(t)
	pacTestTranscript(t, s, "project:a", "legacy-cursor", []Message{{Role: RoleUser, Content: "match first"}, {Role: RoleUser, Content: "match second"}, {Role: RoleUser, Content: "match third"}})
	page := memoryCall(t, s, memoryRow{"action": "pac_history", "query": "match", "cursor": "1", "limit": 1}, "project:a", "test")
	rows := page["records"].([]memoryRow)
	if len(rows) != 1 || memInt(rows[0]["position"]) != 1 || page["next_cursor"] == nil {
		t.Fatal("legacy continuation lost", page)
	}
	next := memoryCall(t, s, memoryRow{"action": "pac_history", "query": "match", "cursor": page["next_cursor"]}, "project:a", "test")
	rows = next["records"].([]memoryRow)
	if len(rows) != 1 || memInt(rows[0]["position"]) != 0 || next["next_cursor"] != nil {
		t.Fatal("legacy continuation did not finish", next)
	}
}
