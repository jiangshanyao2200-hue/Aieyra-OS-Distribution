// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMemoryHistoryPagesSurviveReopenAndExcludeCurrent; TestHistoryAllIncludesPreCompressionPublicMessagesWithoutRecordDuplicates; TestMemoryHistoryOriginalKeepsSurroundingWhitespace
// Impact: python -B scripts/code-atlas.py show Core/memory_history_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

func TestMemoryHistoryPagesSurviveReopenAndExcludeCurrent(t *testing.T) {
	file := filepath.Join(t.TempDir(), "memory.sqlite")
	now := int64(1780000000000)
	s := nativeMemory(t, file, &now, now)
	rows := []any{}
	for i := 0; i < 60; i++ {
		rows = append(rows, map[string]any{"key": "previous/agent", "pos": i, "at": now + int64(i/3), "role": RoleAssistant, "content": fmt.Sprint("reply ", i)})
	}
	rows = append(rows, map[string]any{"key": "current/agent", "pos": 0, "at": now + 100, "role": RoleUser, "content": "current excluded"})
	fastCall(t, s, memoryRow{"action": "transcript_append", "rows": rows})
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = nativeMemory(t, file, &now, now)
	cursor := ""
	seen := map[string]bool{}
	for {
		r := fastCall(t, s, memoryRow{"action": "transcript_history", "exclude_prefix": "current/", "before": cursor, "limit": 17})
		batch := r["rows"].([]any)
		if len(batch) == 0 {
			break
		}
		for _, raw := range batch {
			row := raw.(map[string]any)
			id := fmt.Sprintf("memory:%s:%012d", row["session"], memInt(row["pos"]))
			if seen[id] {
				t.Fatal("repeated row", id)
			}
			seen[id] = true
			cursor = historyKey(historyEntry{ID: id, At: time.UnixMilli(memInt(row["at"])).UTC().Format(time.RFC3339Nano)})
			original := fastCall(t, s, memoryRow{"action": "transcript_history_original", "entry_id": id})
			if original["row"].(map[string]any)["content"] != row["content"] {
				t.Fatal("wrong original")
			}
		}
	}
	if len(seen) != 60 {
		t.Fatal("missing historical rows", len(seen))
	}
	for _, id := range []string{"memory:", "memory:x:", "memory::1", "memory:previous/agent:000000000001junk", "memory:previous/agent:-1"} {
		if _, err := s.Call(context.Background(), memoryRow{"action": "transcript_history_original", "entry_id": id}, "global", "test"); err == nil {
			t.Fatal("invalid history ID accepted", id)
		}
	}
}
func TestHistoryAllIncludesPreCompressionPublicMessagesWithoutRecordDuplicates(t *testing.T) {
	w, _, _ := historyFixture(t)
	m := workspaceMessage{ID: workspaceID(), From: WorkspaceMatrix, To: "user", Text: "old reply", State: "completed", At: time.Now().UTC().Format(time.RFC3339Nano)}
	w.feed.publish(WorkspaceMatrix, "message", m)
	w.mu.Lock()
	w.state.Messages = []workspaceMessage{m}
	w.state.Documents = append(w.state.Documents, WorkspaceDocument{ID: workspaceID(), Kind: "record", Title: "这次的记录", Format: "md", At: m.At})
	w.resetHistoryLocked()
	segment := w.state.HistorySegment
	w.mu.Unlock()
	r, err := w.historyPage(rawJSON(map[string]any{"segment": segment, "all_history": true}))
	if err != nil {
		t.Fatal(err)
	}
	entries := r.(map[string]any)["entries"].([]historyEntry)
	if len(entries) != 1 || entries[0].Text != m.Text {
		t.Fatalf("duplicate/hidden history: %+v", entries)
	}
	w.mu.Lock()
	w.state.Messages = nil
	w.mu.Unlock()
	r, err = w.historyPage(rawJSON(map[string]any{"segment": segment, "all_history": true}))
	if err != nil {
		t.Fatal(err)
	}
	entries = r.(map[string]any)["entries"].([]historyEntry)
	if len(entries) != 1 || entries[0].Text != m.Text {
		t.Fatal("retired chat lost its receipt")
	}
	receipt, err := w.historyReceipt(rawJSON(map[string]any{"segment": segment, "all_history": true, "entry_id": entries[0].ID}))
	if err != nil || receipt.(map[string]any)["input"] != m.Text {
		t.Fatal("original lost", err)
	}
}

// R46：查看原文必须逐字保留首尾空白（检索预览会去掉）；补充说明不一致时仍用预览。
func TestMemoryHistoryOriginalKeepsSurroundingWhitespace(t *testing.T) {
	now := int64(1780000000000)
	s := nativeMemory(t, filepath.Join(t.TempDir(), "memory.sqlite"), &now, now)
	text := "  第一行\n  代码缩进\n\n"
	rows := []any{
		map[string]any{"key": "old/agent", "pos": 0, "at": now, "role": RoleUser, "content": "第一行\n  代码缩进", "payload": `{"role":"user","content":"  第一行\n  代码缩进\n\n"}`},
		map[string]any{"key": "old/agent", "pos": 1, "at": now + 1, "role": RoleUser, "content": "看图\n[附图 1 张]", "payload": `{"role":"user","content":"看图","image_attachments":[{"asset":"x"}]}`},
	}
	fastCall(t, s, memoryRow{"action": "transcript_append", "rows": rows})
	got := fastCall(t, s, memoryRow{"action": "transcript_history_original", "entry_id": "memory:old/agent:000000000000"})["row"].(map[string]any)
	if got["content"] != text || got["payload"] != nil {
		t.Fatalf("原文空白未保留: %q", got["content"])
	}
	img := fastCall(t, s, memoryRow{"action": "transcript_history_original", "entry_id": "memory:old/agent:000000000001"})["row"].(map[string]any)
	if img["content"] != "看图\n[附图 1 张]" {
		t.Fatalf("带附图消息应沿用预览: %q", img["content"])
	}
}
