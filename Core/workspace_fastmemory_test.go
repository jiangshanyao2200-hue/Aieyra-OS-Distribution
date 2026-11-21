// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: fastCall; TestFastMemoryStoreMigratesAppendsAndFindsPendingTail; TestFastMemoryRenderIsAppendOnly; fastWire; TestPACBudgetCompactionPreservesRequestPrefix
// Impact: python -B scripts/code-atlas.py show Core/workspace_fastmemory_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func fastCall(t *testing.T, s *memoryStore, a memoryRow) memoryRow {
	t.Helper()
	r, err := s.Call(context.Background(), a, "global", "test")
	if err != nil {
		t.Fatal(a["action"], err)
	}
	var out memoryRow
	if err = json.Unmarshal(rawJSON(r), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// 存取层：旧记忆迁移一次；原文按位置去重；记忆段只追加；上次会话没整理的尾巴能精确找到，整理后不再出现。
func TestFastMemoryStoreMigratesAppendsAndFindsPendingTail(t *testing.T) {
	s, err := openMemoryStore(filepath.Join(t.TempDir(), "memory", "eyra.sqlite"), nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	fastCall(t, s, memoryRow{"action": "record", "kind": "preference", "title": "报告配色", "content": "用户喜欢琥珀色图表", "source": "用户原话", "request_id": "p1"})
	state := fastCall(t, s, memoryRow{"action": "continuity_snapshot"})
	fastCall(t, s, memoryRow{"action": "continuity_commit", "request_id": "c1", "content": string(rawJSON(CompactSummary{Goals: []string{"做完记忆系统"}, OpenTasks: []string{"写日记"}})), "expected_epoch": state["epoch"], "expected_version": state["version"]})

	first := fastCall(t, s, memoryRow{"action": "fast_snapshot"})
	again := fastCall(t, s, memoryRow{"action": "fast_snapshot"})
	if !strings.Contains(memString(first["pinned"]), "琥珀色") || fmt.Sprint(first) != fmt.Sprint(again) {
		t.Fatalf("migration missing or repeated: %v / %v", first, again)
	}
	segments, _ := first["segments"].([]any)
	if len(segments) != 1 || !strings.Contains(memString(segments[0].(map[string]any)["content"]), "目标：") {
		t.Fatalf("old continuity not migrated as a readable segment: %v", segments)
	}

	rows := []any{}
	for i, text := range []string{"你好", "你好呀", "帮我写 notes.txt", "写好了 sk-abcdefghijklmnopqrstuvwx"} {
		role := RoleUser
		if i%2 == 1 {
			role = RoleAssistant
		}
		rows = append(rows, map[string]any{"key": "launch1/agent", "pos": i, "at": int64(1000 + i), "role": role, "content": text})
	}
	fastCall(t, s, memoryRow{"action": "transcript_append", "rows": rows})
	fastCall(t, s, memoryRow{"action": "transcript_append", "rows": rows[:2]})
	added := fastCall(t, s, memoryRow{"action": "fast_append", "key": "launch1/agent", "content": "经过：打了招呼。", "first_pos": 0, "last_pos": 1, "source": "compact"})
	if memInt(added["id"]) <= 0 {
		t.Fatal("segment id missing", added)
	}
	pending := fastCall(t, s, memoryRow{"action": "transcript_pending", "exclude_prefix": "launch2/"})
	tail, _ := pending["rows"].([]any)
	if pending["key"] != "launch1/agent" || memInt(pending["covered"]) != 2 || memInt(pending["last"]) != 3 || len(tail) != 2 {
		t.Fatalf("pending tail wrong: %v", pending)
	}
	if text := memString(tail[1].(map[string]any)["content"]); text != "写好了 sk-abcdefghijklmnopqrstuvwx" {
		t.Fatal("transcript must keep the original text verbatim", text)
	}
	if own := fastCall(t, s, memoryRow{"action": "transcript_pending", "exclude_prefix": "launch1/"}); own["key"] != "" {
		t.Fatal("current launch treated as pending", own)
	}
	fastCall(t, s, memoryRow{"action": "fast_append", "key": "launch1/agent", "content": "经过：写好了 notes.txt。", "first_pos": 2, "last_pos": 3, "source": "startup"})
	if done := fastCall(t, s, memoryRow{"action": "transcript_pending", "exclude_prefix": "launch2/"}); done["key"] != "" {
		t.Fatal("digested tail still pending", done)
	}
	final := fastCall(t, s, memoryRow{"action": "fast_snapshot"})
	if all, _ := final["segments"].([]any); len(all) != 3 || memInt(final["version"]) <= memInt(first["version"]) {
		t.Fatalf("segments not appended in order: %v", final)
	}
}

// 渲染只追加：多一段记忆时，前面的字节原样不变（缓存前缀不断）。
func TestFastMemoryRenderIsAppendOnly(t *testing.T) {
	one := fastSnapshot{Pinned: "- [偏好] 琥珀色图表", Segments: []fastSegment{{ID: 1, Content: "经过：第一段。", FirstAt: 1, LastAt: 2}}}
	two := one
	two.Segments = append(append([]fastSegment{}, one.Segments...), fastSegment{ID: 2, Content: "经过：第二段。", FirstAt: 3, LastAt: 4})
	a, b := renderFastMemory(one, 0), renderFastMemory(two, 0)
	if !strings.HasPrefix(b, a) || !strings.Contains(b, "【记忆段 #2") {
		t.Fatalf("render is not append-only:\n%s\n---\n%s", a, b)
	}
	if renderFastMemory(fastSnapshot{}, 0) != "" {
		t.Fatal("empty memory rendered")
	}
}

type fastWire struct {
	compact bool
	tools   int
	input   []json.RawMessage
}

// 压缩沿用主请求的同一前缀（带同样的工具），只在最后加整理指令；写成记忆段后，下一次请求的 fast memory 里有这一段，
// 最近的原文保留，工具不重放，任务照常完成。
func TestPACBudgetCompactionPreservesRequestPrefix(t *testing.T) {
	var mu sync.Mutex
	wires := []fastWire{}
	steps := 0
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, r *http.Request) {
		var body struct {
			Tools []json.RawMessage `json:"tools"`
			Input []json.RawMessage `json:"input"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		last := ""
		if len(body.Input) > 0 {
			last = string(body.Input[len(body.Input)-1])
		}
		compact := strings.Contains(last, "【工作上下文封存】")
		mu.Lock()
		wires = append(wires, fastWire{compact: compact, tools: len(body.Tools), input: body.Input})
		if compact {
			mu.Unlock()
			fixtureSizedAnswer(rw, body, "segment", "经过：前面的步骤都已完成，文件已写好。\n没做完的事：继续剩下的步骤。", nil)
			return
		}
		steps++
		n := steps
		mu.Unlock()
		if n > 6 {
			fixtureSizedAnswer(rw, body, "done", "FINISHED", nil)
			return
		}
		fixtureSizedAnswer(rw, body, fmt.Sprintf("r%d", n), "", []any{
			map[string]any{"type": "message", "id": fmt.Sprintf("msg%d", n), "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": strings.Repeat("bounded progress ", 4000)}}},
			map[string]any{"type": "function_call", "id": fmt.Sprintf("fc%d", n), "call_id": fmt.Sprintf("call%d", n), "name": "report", "arguments": string(rawJSON(map[string]any{"action": "report", "format": "md", "title": fmt.Sprintf("step%d.txt", n), "content": "completed once\n"}))},
		})
	})
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	// 小预算逼出压缩：旧的全局字段与每个模型的“开始压缩位置”都设上，两种预算算法下都在约 6K 时压缩。
	s.ContextWorkingTokens = 8192
	s.CompactPercent = 75
	compactAt := 6144
	for i := range s.APIProfiles {
		s.APIProfiles[i].CompactAtTokens = &compactAt
	}
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	w := modeWorkspace(t, m.config, dir, HostOS)
	w.service = NewSettingsService(m.config)
	t.Cleanup(w.service.Close)
	w.mu.Lock()
	r, err := w.dispatchLocked(WorkspaceMatrix, workspaceID(), "finish all six steps and keep files")
	w.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	r, err = w.manager.Wait(context.Background(), w.state.ID, r.ID, 25000)
	if err != nil || r.State != "completed" || r.Result != "FINISHED" {
		t.Fatalf("state=%s error=%s %v", r.State, r.Error, err)
	}
	mu.Lock()
	defer mu.Unlock()
	compactions := 0
	for i, wire := range wires {
		if !wire.compact {
			continue
		}
		compactions++
		if wire.tools == 0 {
			t.Fatal("compaction dropped the tool definitions (prefix changed)")
		}
		var previous *fastWire
		for j := i - 1; j >= 0; j-- {
			if !wires[j].compact {
				previous = &wires[j]
				break
			}
		}
		// 压缩请求去掉最后的整理指令后，与上一次真实请求的公共前缀要覆盖上一次请求的全部对话（只允许末尾的动态提示不同：结果提示、本机时间等）。
		prefix := wire.input[:len(wire.input)-1]
		if previous == nil {
			t.Fatal("compaction has no preceding model request")
		}
		common := 0
		for common < len(prefix) && common < len(previous.input) && bytes.Equal(prefix[common], previous.input[common]) {
			common++
		}
		tail := 0
		for k := len(previous.input) - 1; k >= 0 && (bytes.Contains(previous.input[k], []byte(`"role":"system"`)) || bytes.Contains(previous.input[k], []byte(`"role":"developer"`)) || bytes.Contains(previous.input[k], []byte(`[Aieyra runtime context]`))); k-- {
			tail++
		}
		if common < min(len(prefix), len(previous.input)-max(1, tail)) {
			t.Fatalf("compaction %d shares only %d of %d/%d items with the previous request", i, common, len(prefix), len(previous.input))
		}
	}
	if compactions == 0 {
		t.Fatalf("long turn never compacted: context=%+v wires=%d", r.Context, len(wires))
	}
	final := wires[len(wires)-1]
	joined := ""
	for _, item := range final.input {
		joined += string(item)
	}
	if !strings.Contains(joined, "前面的步骤都已完成") || !strings.Contains(joined, "pac_id") {
		t.Fatal("PAC not delivered back into context")
	}
	for i := 1; i <= 6; i++ {
		assertFixtureReport(t, w, fmt.Sprintf("step%d.txt", i), "completed once\n")
	}
	snapshot, err := w.readPAC(context.Background())
	if err != nil || len(snapshot.Packets) == 0 {
		t.Fatal("segment not stored", err)
	}
	if r.Compression == nil || r.Compression.AfterTokens >= r.Compression.BeforeTokens {
		t.Fatal("compression not recorded", r.Compression)
	}
}
