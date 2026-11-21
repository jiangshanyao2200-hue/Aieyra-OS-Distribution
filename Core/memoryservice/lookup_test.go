// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/memoryservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMemoryLookupKeepsSourcesProjectsAndPaging; TestMemoryLookupEmptyPageCanReachEarlierOriginal; TestMemoryLookupBoundsAndLegacyScope
// Impact: python -B scripts/code-atlas.py show Core/memoryservice/lookup_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package memory

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// 统一 lookup：三类分开返回且保留各自出处；项目边界不越；合成游标逐页取完不重不漏，
// 翻完的类不再重复出现；records 不再顺带混入原文（原文只在 transcripts 里出现一次）。
func TestMemoryLookupKeepsSourcesProjectsAndPaging(t *testing.T) {
	s := pacTestStore(t)
	memoryCall(t, s, memoryRow{"action": "record", "kind": "preference", "title": "界面配色", "content": "用户偏好琥珀色强调色", "scope": "project", "source": "explicit user request"}, "project:a", "test")
	memoryCall(t, s, memoryRow{"action": "record", "kind": "preference", "title": "别的项目", "content": "琥珀色只属于项目B", "scope": "project"}, "project:b", "test")
	msgs := []Message{{Role: RoleUser, Content: "主按钮请用琥珀色"}, {Role: RoleAssistant, Content: "好的，主按钮改成琥珀色"}}
	for i := 0; i < 7; i++ {
		msgs = append(msgs, Message{Role: RoleUser, Content: fmt.Sprintf("琥珀色样本 第%d条", i)})
	}
	pacTestTranscript(t, s, "project:a", "session/a", msgs)
	pacTestSeal(t, s, "project:a", "session/a", "A", "阶段完成：主按钮改为琥珀色。", 0, 1)
	pacTestTranscript(t, s, "project:b", "session/b", []Message{{Role: RoleUser, Content: "项目B也提到琥珀色"}})

	page := memoryCall(t, s, memoryRow{"action": "lookup", "query": "琥珀色", "limit": 4}, "project:a", "test")
	records, packets, transcripts := page["records"].([]memoryRow), page["packets"].([]memoryRow), page["transcripts"].([]memoryRow)
	if len(records) != 1 || records[0]["kind"] != "preference" || records[0]["source"] != "explicit user request" {
		t.Fatalf("records 出处或项目边界不对: %v", records)
	}
	if len(packets) != 1 || !strings.HasPrefix(memString(packets[0]["id"]), "pac_") {
		t.Fatalf("packets 未返回或越界: %v", packets)
	}
	if page["transcript_records"] != nil || page["notice"] == nil || len(transcripts) != 4 || page["next_cursor"] == nil {
		t.Fatalf("首页结构不对: %v", page)
	}
	seen := map[int64]bool{}
	roles := map[string]string{}
	for pages := 0; ; pages++ {
		for _, row := range page["transcripts"].([]memoryRow) {
			if row["key"] != "session/a" {
				t.Fatalf("原文越过项目边界: %v", row)
			}
			pos := memInt(row["position"])
			if seen[pos] {
				t.Fatal("翻页重复", pos)
			}
			seen[pos] = true
			roles[memString(row["role"])] = memString(row["source"])
		}
		if pages > 0 && (len(page["records"].([]memoryRow)) != 0 || len(page["packets"].([]memoryRow)) != 0) {
			t.Fatalf("已翻完的类又出现: %v", page)
		}
		if page["next_cursor"] == nil {
			break
		}
		if pages > 5 {
			t.Fatal("游标不收敛")
		}
		page = memoryCall(t, s, memoryRow{"action": "lookup", "query": "琥珀色", "limit": 4, "cursor": page["next_cursor"]}, "project:a", "test")
	}
	if len(seen) != 9 {
		t.Fatalf("原文命中应为 9 条，实际 %d", len(seen))
	}
	if roles["user"] != "用户原话" || !strings.Contains(roles["assistant"], "不是用户提供") {
		t.Fatalf("原文出处标签丢失: %v", roles)
	}
	// 项目 B 只看到自己的。
	b := memoryCall(t, s, memoryRow{"action": "lookup", "query": "琥珀色"}, "project:b", "test")
	if len(b["records"].([]memoryRow)) != 1 || len(b["packets"].([]memoryRow)) != 0 || len(b["transcripts"].([]memoryRow)) != 1 {
		t.Fatalf("项目B越界: %v", b)
	}
	for _, bad := range []memoryRow{{"action": "lookup", "query": ""}, {"action": "lookup", "query": "琥珀色", "cursor": "not-a-cursor"}, {"action": "lookup", "query": "琥珀色", "cursor": "eyJ4IjoiMSJ9"}} {
		if _, err := s.Call(context.Background(), bad, "project:a", "test"); err == nil {
			t.Fatalf("无效输入未拒绝: %v", bad)
		}
	}
	// 原 search history:true 的原文兜底保持不变（不受 lookup 内部标记影响）。
	if r := memoryCall(t, s, memoryRow{"action": "search", "query": "样本 第3条", "history": true}, "project:a", "test"); r["transcript_records"] == nil {
		t.Fatalf("search 原文兜底被改变: %v", r)
	}
}

func TestMemoryLookupEmptyPageCanReachEarlierOriginal(t *testing.T) {
	s := pacTestStore(t)
	if page := memoryCall(t, s, memoryRow{"action": "lookup", "query": "fresh"}, "project:a", "test"); page["next_cursor"] != nil {
		t.Fatal("empty store should finish", page)
	}
	messages := []Message{{Role: RoleUser, Content: "精确回查代号青竹81"}}
	for i := 0; i < 512; i++ {
		messages = append(messages, Message{Role: RoleAssistant, Content: "ordinary later message"})
	}
	for start := 0; start < len(messages); start += 128 {
		var rows []any
		if err := json.Unmarshal(rawJSON(transcriptRows("earlier", start, messages[start:min(start+128, len(messages))], nil)), &rows); err != nil {
			t.Fatal(err)
		}
		memoryCall(t, s, memoryRow{"action": "transcript_append", "rows": rows}, "project:a", "test")
	}
	first := memoryCall(t, s, memoryRow{"action": "lookup", "query": "青竹81"}, "project:a", "test")
	if len(first["transcripts"].([]memoryRow)) != 0 || first["next_cursor"] == nil {
		t.Fatal("empty bounded page lost continuation", first)
	}
	for _, other := range []struct{ query, project string }{{"wrong query", "project:a"}, {"青竹81", "project:b"}} {
		if _, err := s.Call(context.Background(), memoryRow{"action": "lookup", "query": other.query, "cursor": first["next_cursor"]}, other.project, "test"); err == nil {
			t.Fatal("cursor accepted for another query/project")
		}
	}
	last := memoryCall(t, s, memoryRow{"action": "lookup", "query": "青竹81", "cursor": first["next_cursor"]}, "project:a", "test")
	rows := last["transcripts"].([]memoryRow)
	if len(rows) != 1 || last["next_cursor"] != nil || rows[0]["scope"] != "project:a" {
		t.Fatal("earlier original not recovered", last)
	}
	full := memoryCall(t, s, memoryRow{"action": "pac_message", "key": rows[0]["key"], "position": rows[0]["position"]}, "project:a", "test")
	if !strings.Contains(memString(full["content"]), "精确回查代号青竹81") {
		t.Fatal("lookup reference does not retrieve exact original", full)
	}
}

func TestMemoryLookupBoundsAndLegacyScope(t *testing.T) {
	s := pacTestStore(t)
	var messages []Message
	for i := 0; i < 8; i++ {
		messages = append(messages, Message{Role: RoleUser, Content: strings.Repeat("琥珀色🌱", 500)})
	}
	pacTestTranscript(t, s, "project:a", "legacy", messages)
	if err := memoryExec(context.Background(), s.db, "DELETE FROM transcript_scopes WHERE session='legacy'"); err != nil {
		t.Fatal(err)
	}
	r := memoryCall(t, s, memoryRow{"action": "lookup", "query": "琥珀色", "limit": 20}, "project:b", "test")
	rows := r["transcripts"].([]memoryRow)
	if len(rows) != 5 || r["next_cursor"] == nil {
		t.Fatal("per-source cap is not effective")
	}
	for _, row := range rows {
		if row["scope"] != "legacy_global" || len([]rune(memString(row["excerpt"]))) > 600 || row["truncated"] != true {
			t.Fatal("legacy provenance or excerpt bound lost", row)
		}
	}
}
