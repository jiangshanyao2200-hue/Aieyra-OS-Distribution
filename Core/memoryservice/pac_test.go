// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/memoryservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: pacTestStore; pacTestTranscript; pacTestSeal; TestPACSealReplayHierarchyAndProjectIsolation; TestPACOriginalPaginationPreservesLongToolPayload; TestPACFailureRollsBackAndConcurrentMergeCannotConsumeTwice; TestPACLegacyMigrationIsIdempotentAndKeepsDiarySources; TestPACSchemaUpgradeMakesConsistentBackup; TestPACUnsealedHistoryRemainsDiscoverableAndScoped; TestPACHistoryMultiTermAllConstraintsAndPaging
// Impact: python -B scripts/code-atlas.py show Core/memoryservice/pac_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package memory

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func pacTestStore(t *testing.T) *Store {
	t.Helper()
	now := int64(1792560000000)
	return nativeMemory(t, filepath.Join(t.TempDir(), "memory.sqlite"), &now, now)
}

func pacTestTranscript(t *testing.T, s *Store, scope, key string, messages []Message) {
	t.Helper()
	var rows []any
	if err := json.Unmarshal(rawJSON(transcriptRows(key, 0, messages, nil)), &rows); err != nil {
		t.Fatal(err)
	}
	memoryCall(t, s, memoryRow{"action": "transcript_append", "rows": rows}, scope, "test")
}

func pacTestSeal(t *testing.T, s *Store, scope, key, request, content string, first, last int) memoryRow {
	t.Helper()
	return memoryCall(t, s, memoryRow{"action": "pac_seal", "title": request, "keywords": "琥珀色 动画", "content": content, "key": key, "request_id": request, "first_pos": first, "last_pos": last}, scope, "test")
}

func TestPACSealReplayHierarchyAndProjectIsolation(t *testing.T) {
	s := pacTestStore(t)
	pacTestTranscript(t, s, "project:a", "session/a", []Message{{Role: RoleUser, Content: "修复动画"}, {Role: RoleAssistant, Content: "完成第一阶段"}, {Role: RoleUser, Content: "继续历史"}, {Role: RoleAssistant, Content: "完成第二阶段"}})
	a := pacTestSeal(t, s, "project:a", "session/a", "A", "动画完成；用户要求保持琥珀色。", 0, 1)
	b := pacTestSeal(t, s, "project:a", "session/a", "B", "历史完成；仍需性能验证。", 2, 3)
	replayed := pacTestSeal(t, s, "project:a", "session/a", "A", "动画完成；用户要求保持琥珀色。", 0, 1)
	if replayed["id"] != a["id"] || replayed["replayed"] != true {
		t.Fatalf("retry created a new packet: %v", replayed)
	}
	for _, args := range []memoryRow{
		{"action": "pac_seal", "title": "A", "content": "changed", "key": "session/a", "request_id": "A", "first_pos": 0, "last_pos": 1},
		{"action": "pac_seal", "title": "overlap", "content": "overlap", "key": "session/a", "request_id": "C", "first_pos": 1, "last_pos": 2},
		{"action": "pac_merge", "title": "duplicate", "content": "bad", "request_id": "duplicate", "children": []string{memString(a["id"]), memString(a["id"])}},
	} {
		if _, err := s.Call(context.Background(), args, "project:a", "test"); err == nil {
			t.Fatalf("invalid transaction accepted: %v", args)
		}
	}
	if _, err := s.Call(context.Background(), memoryRow{"action": "pac_read", "id": a["id"]}, "project:b", "test"); err == nil {
		t.Fatal("cross-project packet exposed")
	}
	if _, err := s.Call(context.Background(), memoryRow{"action": "pac_seal", "title": "foreign", "content": "bad", "request_id": "foreign", "key": "session/a", "first_pos": 0, "last_pos": 1}, "project:b", "test"); err == nil {
		t.Fatal("cross-project source accepted")
	}
	merged := memoryCall(t, s, memoryRow{"action": "pac_merge", "title": "界面阶段", "content": "动画和历史完成，仍需性能验证。", "keywords": "琥珀色 历史", "request_id": "AB", "children": []string{memString(a["id"]), memString(b["id"])}}, "project:a", "test")
	snap := memoryCall(t, s, memoryRow{"action": "pac_snapshot"}, "project:a", "test")
	packets := snap["packets"].([]memoryRow)
	if len(packets) != 1 || packets[0]["id"] != merged["id"] || memInt(packets[0]["level"]) != 1 {
		t.Fatalf("hierarchy roots wrong: %v", packets)
	}
	read := memoryCall(t, s, memoryRow{"action": "pac_read", "id": merged["id"]}, "project:a", "test")
	if len(read["children"].([]memoryRow)) != 2 {
		t.Fatal("children not retained")
	}
	child := memoryCall(t, s, memoryRow{"action": "pac_read", "id": a["id"]}, "project:a", "test")
	if !strings.Contains(memString(child["record"].(memoryRow)["content"]), "琥珀色") {
		t.Fatal("merging destroyed source summary")
	}
	search := memoryCall(t, s, memoryRow{"action": "pac_search", "query": "琥珀色"}, "project:a", "test")
	if len(search["records"].([]memoryRow)) < 2 {
		t.Fatal("archived children no longer searchable")
	}
	other := memoryCall(t, s, memoryRow{"action": "pac_search", "query": "琥珀色"}, "project:b", "test")
	if len(other["records"].([]memoryRow)) != 0 {
		t.Fatal("cross-project search leaked")
	}
}

func TestPACOriginalPaginationPreservesLongToolPayload(t *testing.T) {
	s := pacTestStore(t)
	text := strings.Repeat("精确原文🌱", 7000)
	m := Message{Role: RoleTool, ToolCallID: "call-1", Content: text}
	pacTestTranscript(t, s, "project:a", "long", []Message{m})
	p := pacTestSeal(t, s, "project:a", "long", "long", "长工具输出已归档，按ID回查。", 0, 0)
	cursor, original := "", ""
	for i := 0; i < 100; i++ {
		page := memoryCall(t, s, memoryRow{"action": "pac_original", "id": p["id"], "cursor": cursor, "limit_chars": 1000}, "project:a", "test")
		piece := memString(page["content"])
		if len([]rune(piece)) > 1000 || page["format"] != "message_json" || page["legacy_truncated"] != false {
			t.Fatalf("invalid original page: %v", page)
		}
		original += piece
		cursor = memString(page["next_cursor"])
		if cursor == "" {
			break
		}
	}
	var decoded Message
	if err := json.Unmarshal([]byte(original), &decoded); err != nil || decoded.Content != text || decoded.ToolCallID != "call-1" {
		t.Fatalf("full tool source was lost: %v, content length %d", err, len(decoded.Content))
	}
}

func TestPACFailureRollsBackAndConcurrentMergeCannotConsumeTwice(t *testing.T) {
	s := pacTestStore(t)
	pacTestTranscript(t, s, "global", "gaps", []Message{{Role: RoleUser, Content: "原文"}})
	before := memoryCall(t, s, memoryRow{"action": "pac_snapshot"}, "global", "test")
	_, err := s.Call(context.Background(), memoryRow{"action": "pac_seal", "title": "missing", "content": "不能封存缺失原文", "key": "gaps", "first_pos": 0, "last_pos": 2, "request_id": "missing"}, "global", "test")
	if err == nil {
		t.Fatal("missing source accepted")
	}
	after := memoryCall(t, s, memoryRow{"action": "pac_snapshot"}, "global", "test")
	if before["version"] != after["version"] || len(after["packets"].([]memoryRow)) != 0 {
		t.Fatal("failed seal changed the root set")
	}
	ids := []string{}
	for i := 0; i < 3; i++ {
		key := fmt.Sprint("work", i)
		pacTestTranscript(t, s, "global", key, []Message{{Role: RoleUser, Content: key}})
		ids = append(ids, memString(pacTestSeal(t, s, "global", key, key, "done "+key, 0, 0)["id"]))
	}
	memoryCall(t, s, memoryRow{"action": "pac_merge", "title": "first", "content": "first merged", "request_id": "first", "children": ids[:2]}, "global", "test")
	if _, err = s.Call(context.Background(), memoryRow{"action": "pac_merge", "title": "late", "content": "late merge", "request_id": "late", "children": ids[1:]}, "global", "test"); err == nil {
		t.Fatal("stale merge stole an existing child")
	}
	snap := memoryCall(t, s, memoryRow{"action": "pac_snapshot"}, "global", "test")
	if len(snap["packets"].([]memoryRow)) != 2 {
		t.Fatal("failed merge retired an unrelated root")
	}
}

func TestPACLegacyMigrationIsIdempotentAndKeepsDiarySources(t *testing.T) {
	s := pacTestStore(t)
	pacTestTranscript(t, s, "global", "old", []Message{{Role: RoleUser, Content: "偏好琥珀色"}, {Role: RoleAssistant, Content: "记住了"}})
	segment := fastCall(t, s, memoryRow{"action": "fast_append", "key": "old", "content": "琥珀色偏好", "first_pos": 0, "last_pos": 1, "source": "legacy"})
	fastCall(t, s, memoryRow{"action": "fast_organize", "retire": []any{memInt(segment["id"])}, "pinned": "长期要求：琥珀色", "diary": map[string]any{"title": "旧日记", "content": "今天讨论了配色"}})
	one := memoryCall(t, s, memoryRow{"action": "pac_snapshot"}, "global", "test")
	two := memoryCall(t, s, memoryRow{"action": "pac_snapshot"}, "global", "test")
	if one["version"] != two["version"] || len(one["profile"].([]memoryRow)) == 0 {
		t.Fatal("migration repeated or legacy preferences disappeared")
	}
	diary := memoryCall(t, s, memoryRow{"action": "pac_read", "id": "pac_legacy_diary_1"}, "global", "test")
	if len(diary["children"].([]memoryRow)) != 1 {
		t.Fatal("diary lost its source link")
	}
	source := memoryCall(t, s, memoryRow{"action": "pac_original", "id": fmt.Sprintf("pac_legacy_fast_%d", memInt(segment["id"]))}, "global", "test")
	if !strings.Contains(memString(source["content"]), "琥珀色") {
		t.Fatal("legacy original cannot be retrieved")
	}
	legacy := fastCall(t, s, memoryRow{"action": "diary_read", "id": 1})
	if !strings.Contains(string(rawJSON(legacy)), "今天讨论") {
		t.Fatal("migration removed old diary data")
	}
}

func TestPACSchemaUpgradeMakesConsistentBackup(t *testing.T) {
	file := filepath.Join(t.TempDir(), "memory.sqlite")
	s, err := openMemoryStore(file, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec("PRAGMA user_version=1"); err != nil {
		t.Fatal(err)
	}
	_ = s.Close()
	s, err = openMemoryStore(file, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	_ = s.Close()
	files, err := filepath.Glob(file + ".pre-pac-v1-*.sqlite")
	if err != nil || len(files) != 1 {
		t.Fatalf("upgrade backup missing: %v %v", files, err)
	}
	if info, e := os.Stat(files[0]); e != nil || info.Size() == 0 {
		t.Fatal("upgrade snapshot is empty")
	}
}

func TestPACUnsealedHistoryRemainsDiscoverableAndScoped(t *testing.T) {
	s := pacTestStore(t)
	pacTestTranscript(t, s, "project:a", "unfinished-a", []Message{{Role: RoleUser, Content: "月光图表尚未完成"}})
	pacTestTranscript(t, s, "project:b", "unfinished-b", []Message{{Role: RoleUser, Content: "其它项目的月光图表"}})
	page := memoryCall(t, s, memoryRow{"action": "pac_history", "query": "月光"}, "project:a", "test")
	rows := page["records"].([]memoryRow)
	if len(rows) != 1 || rows[0]["key"] != "unfinished-a" {
		t.Fatal("raw history unavailable or leaked", page)
	}
	r := memoryCall(t, s, memoryRow{"action": "pac_message", "key": "unfinished-a", "position": 0}, "project:a", "test")
	if r["format"] != "message_json" || !strings.Contains(memString(r["content"]), "尚未完成") {
		t.Fatal("raw history source lost", r)
	}
	if _, err := s.Call(context.Background(), memoryRow{"action": "pac_message", "key": "unfinished-b", "position": 0}, "project:a", "test"); err == nil {
		t.Fatal("foreign raw history readable")
	}
}

// R46：原文检索的多个关键词按“同一条全部出现”匹配，不截断约束、翻页不跳过；search history:true 无记忆命中时顺带给出原文结果。
func TestPACHistoryMultiTermAllConstraintsAndPaging(t *testing.T) {
	s := pacTestStore(t)
	secret := "BookingGuard 扩展交付时请回复回执口令 蓝鲸42，并按 CLI 约定输出"
	msgs := []Message{{Role: RoleUser, Content: secret}, {Role: RoleAssistant, Content: "BookingGuard 已收到"}}
	for i := 0; i < 50; i++ {
		text := fmt.Sprintf("普通消息 %d", i)
		if i%2 == 0 {
			text = fmt.Sprintf("分页样本 甲 乙 第%d条", i)
		}
		msgs = append(msgs, Message{Role: RoleUser, Content: text})
	}
	pacTestTranscript(t, s, "project:a", "booking", msgs)
	pacTestTranscript(t, s, "project:b", "foreign", []Message{{Role: RoleUser, Content: "BookingGuard 回执 口令 约定 CLI 其它项目"}})

	page := memoryCall(t, s, memoryRow{"action": "pac_history", "query": "BookingGuard 回执 口令 约定 CLI"}, "project:a", "test")
	rows := page["records"].([]memoryRow)
	if len(rows) != 1 || rows[0]["key"] != "booking" || memInt(rows[0]["position"]) != 0 {
		t.Fatalf("多关键词未按全部出现匹配或越过范围: %v", page)
	}
	if rows[0]["role"] != "user" || rows[0]["source"] != "用户原话" || rows[0]["excerpt"] != secret {
		t.Fatalf("用户原话出处或原文不对: %v", rows[0])
	}
	// 助手复述的同一口令要标明是助手说的，不能被当成用户来源（R46 自然测试失败点）。
	if r := memoryCall(t, s, memoryRow{"action": "pac_history", "query": "BookingGuard 已收到"}, "project:a", "test"); len(r["records"].([]memoryRow)) != 1 || r["records"].([]memoryRow)[0]["role"] != "assistant" || !strings.Contains(memString(r["records"].([]memoryRow)[0]["source"]), "不是用户提供") {
		t.Fatalf("助手回复未标明出处: %v", r)
	}
	// 第 9 个词不存在时不能命中（不截断约束）；9 个词全在时命中。
	if r := memoryCall(t, s, memoryRow{"action": "pac_history", "query": "BookingGuard 扩展 交付 回执 口令 蓝鲸42 CLI 约定 不存在"}, "project:a", "test"); len(r["records"].([]memoryRow)) != 0 || r["hint"] == nil {
		t.Fatalf("第九个约束被丢弃或缺少无命中引导: %v", r)
	}
	if r := memoryCall(t, s, memoryRow{"action": "pac_history", "query": "BookingGuard 扩展 交付 回执 口令 蓝鲸42 CLI 约定 输出"}, "project:a", "test"); len(r["records"].([]memoryRow)) != 1 {
		t.Fatalf("九个约束全部满足却未命中: %v", r)
	}
	// 翻页：25 条命中分散在非命中之间，每页 7 条，逐页取完恰好 25 条且不重复。
	seen, cursor := map[int64]bool{}, any(nil)
	for pages := 0; pages < 20; pages++ {
		q := memoryRow{"action": "pac_history", "query": "分页样本 甲 乙", "limit": 7}
		if cursor != nil {
			q["cursor"] = cursor
		}
		r := memoryCall(t, s, q, "project:a", "test")
		for _, row := range r["records"].([]memoryRow) {
			pos := memInt(row["position"])
			if seen[pos] {
				t.Fatal("翻页重复", pos)
			}
			seen[pos] = true
		}
		if cursor = r["next_cursor"]; cursor == nil {
			break
		}
	}
	if len(seen) != 25 {
		t.Fatalf("翻页跳过或遗漏命中: %d", len(seen))
	}
	// search history:true：记忆记录无命中时附原文检索结果，仍按项目范围。
	found := memoryCall(t, s, memoryRow{"action": "search", "history": true, "query": "BookingGuard 回执 口令 约定 CLI"}, "project:a", "test")
	tr, _ := found["transcript_records"].([]memoryRow)
	if len(found["records"].([]memoryRow)) != 0 || len(tr) != 1 || tr[0]["key"] != "booking" {
		t.Fatalf("search history:true 未给出原文检索结果: %v", found)
	}
}
