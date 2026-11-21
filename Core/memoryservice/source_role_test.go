// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/memoryservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMemorySourceRoleFiltersBeforeScanAndPreservesOtherSources; TestPACHistoryCursorTiesAcrossSessions
// Impact: python -B scripts/code-atlas.py show Core/memoryservice/source_role_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package memory

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
)

// A lookup produces tool echoes in the same transcript. Source filtering must
// happen before the bounded SQL page so an older user instruction is reachable.
func TestMemorySourceRoleFiltersBeforeScanAndPreservesOtherSources(t *testing.T) {
	s := pacTestStore(t)
	messages := []Message{{Role: RoleUser, Content: "琥珀81 用户原始要求"}, {Role: RoleUser, Content: "琥珀81 用户补充"}}
	for i := 0; i < 520; i++ {
		role := RoleTool
		if i%2 == 0 {
			role = RoleAssistant
		}
		messages = append(messages, Message{Role: role, Content: fmt.Sprintf("琥珀81 搜索回显 %d", i)})
	}
	for start := 0; start < len(messages); start += 128 {
		var rows []any
		if err := json.Unmarshal(rawJSON(transcriptRows("filtered", start, messages[start:min(start+128, len(messages))], nil)), &rows); err != nil {
			t.Fatal(err)
		}
		memoryCall(t, s, memoryRow{"action": "transcript_append", "rows": rows}, "project:a", "test")
	}
	pacTestTranscript(t, s, "project:b", "foreign", []Message{{Role: RoleUser, Content: "琥珀81 私人项目"}})
	memoryCall(t, s, memoryRow{"action": "record", "kind": "preference", "title": "配色", "content": "琥珀81 偏好", "scope": "project"}, "project:a", "test")
	pacTestSeal(t, s, "project:a", "filtered", "source-role", "琥珀81 阶段摘要", 0, 1)
	for _, action := range []string{"pac_history", "lookup"} {
		t.Run(action, func(t *testing.T) {
			field := "records"
			if action == "lookup" {
				field = "transcripts"
			}
			first := memoryCall(t, s, memoryRow{"action": action, "query": "琥珀81", "source_role": "user", "limit": 1}, "project:a", "test")
			rows := first[field].([]memoryRow)
			if len(rows) != 1 || rows[0]["role"] != "user" || rows[0]["key"] != "filtered" || memInt(rows[0]["position"]) != 1 || first["next_cursor"] == nil {
				t.Fatalf("did not directly reach older user source: %v", first)
			}
			if action == "lookup" && (len(first["records"].([]memoryRow)) != 1 || len(first["packets"].([]memoryRow)) != 1) {
				t.Fatal("transcript filter removed non-transcript sources", first)
			}
			for _, role := range []string{"assistant", "tool", ""} {
				if _, err := s.Call(context.Background(), memoryRow{"action": action, "query": "琥珀81", "source_role": role, "cursor": first["next_cursor"]}, "project:a", "test"); err == nil {
					t.Fatal("cursor accepted changed source filter", role)
				}
			}
			last := memoryCall(t, s, memoryRow{"action": action, "query": "琥珀81", "source_role": "user", "cursor": first["next_cursor"]}, "project:a", "test")
			rows = last[field].([]memoryRow)
			if len(rows) != 1 || memInt(rows[0]["position"]) != 0 || last["next_cursor"] != nil {
				t.Fatal("source continuation incomplete", last)
			}
			full := memoryCall(t, s, memoryRow{"action": "pac_message", "key": rows[0]["key"], "position": rows[0]["position"]}, "project:a", "test")
			var original Message
			if json.Unmarshal([]byte(memString(full["content"])), &original) != nil || original.Role != RoleUser || original.Content != "琥珀81 用户原始要求" {
				t.Fatal("original source not retrievable", full)
			}
			for _, role := range []string{"assistant", "tool"} {
				page := memoryCall(t, s, memoryRow{"action": action, "query": "琥珀81", "source_role": role, "limit": 1}, "project:a", "test")
				if found := page[field].([]memoryRow); len(found) != 1 || found[0]["role"] != role {
					t.Fatal("wrong source role", page)
				}
			}
			for _, invalid := range []any{"system", "usre", 42, true} {
				if _, err := s.Call(context.Background(), memoryRow{"action": action, "query": "琥珀81", "source_role": invalid}, "project:a", "test"); err == nil {
					t.Fatal("invalid filter silently ignored", invalid)
				}
			}
		})
	}
}

func TestPACHistoryCursorTiesAcrossSessions(t *testing.T) {
	s := pacTestStore(t)
	for _, key := range []string{"a", "z", "中"} {
		pacTestTranscript(t, s, "project:a", key, []Message{{Role: RoleUser, Content: "tie"}, {Role: RoleUser, Content: "tie"}})
	}
	if err := memoryExec(context.Background(), s.db, "UPDATE transcript SET at=1000"); err != nil {
		t.Fatal(err)
	}
	var cursor any
	got := []string{}
	for i := 0; i < 7; i++ {
		page := memoryCall(t, s, memoryRow{"action": "pac_history", "query": "tie", "limit": 1, "cursor": cursor}, "project:a", "test")
		for _, row := range page["records"].([]memoryRow) {
			got = append(got, fmt.Sprintf("%s/%d", row["key"], memInt(row["position"])))
		}
		cursor = page["next_cursor"]
		if cursor == nil {
			break
		}
	}
	if fmt.Sprint(got) != "[a/1 a/0 z/1 z/0 中/1 中/0]" || cursor != nil {
		t.Fatal("tie order repeated or skipped rows", got, cursor)
	}
}
