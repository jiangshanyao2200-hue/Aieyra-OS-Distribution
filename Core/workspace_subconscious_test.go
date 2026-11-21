// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestSubconsciousStoreOrganizesDiariesDreamsAndDeepSearch; TestSubconsciousToolsFollowMemoryAndHost; subconsciousConfig; TestPACIgnoresLegacySubconsciousAndCompactsWithEyra; TestSharedDiaryReadThroughWorkspaceCall
// Impact: python -B scripts/code-atlas.py show Core/workspace_subconscious_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// 存取层：整理把指定的段写成日记（带出处）、要点整体替换、记下梦；日记只能分享标为可分享的，看过才算已读；深层检索三处都能找到。
func TestSubconsciousStoreOrganizesDiariesDreamsAndDeepSearch(t *testing.T) {
	s, err := openMemoryStore(filepath.Join(t.TempDir(), "memory", "eyra.sqlite"), nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	rows := []any{}
	for i, text := range []string{"我家的猫叫团子，是一只橘猫", "记住了，团子是橘猫", "下周三去杭州", "好的，下周三杭州"} {
		role := RoleUser
		if i%2 == 1 {
			role = RoleAssistant
		}
		rows = append(rows, map[string]any{"key": "launch1/agent", "pos": i, "at": int64(1700000000000 + int64(i)*1000), "role": role, "content": text})
	}
	fastCall(t, s, memoryRow{"action": "transcript_append", "rows": rows})
	ids := []int64{}
	for i, text := range []string{"经过：用户说猫叫团子。", "经过：用户下周三去杭州。", "经过：做记忆系统。"} {
		r := fastCall(t, s, memoryRow{"action": "fast_append", "key": "launch1/agent", "content": text, "first_pos": i * 2, "last_pos": i*2 + 1, "source": "compact"})
		ids = append(ids, memInt(r["id"]))
	}
	got := fastCall(t, s, memoryRow{"action": "transcript_range", "key": "launch1/agent", "first_pos": 1, "last_pos": 2})
	if list, _ := got["rows"].([]any); len(list) != 2 || memInt(list[0].(map[string]any)["at"]) != 1700000001000 {
		t.Fatalf("range rows wrong: %v", got)
	}
	out := fastCall(t, s, memoryRow{"action": "fast_organize", "retire": []any{ids[0], ids[1]}, "pinned": "- 用户的猫叫团子（橘猫）\n- 用户下周三去杭州", "diary": map[string]any{"title": "团子和杭州", "content": "今天记住了团子是一只橘猫，还知道了下周三要去杭州。", "shareable": true}, "dream": "梦里团子坐在西湖边的一条小船上。"})
	if memInt(out["diary_id"]) <= 0 || memInt(out["retired"]) != 2 {
		t.Fatalf("organize result wrong: %v", out)
	}
	snap := fastCall(t, s, memoryRow{"action": "fast_snapshot"})
	if segs, _ := snap["segments"].([]any); len(segs) != 1 || !strings.Contains(memString(snap["pinned"]), "橘猫") {
		t.Fatalf("snapshot after organize wrong: %v", snap)
	}
	if _, err := s.Call(context.Background(), memoryRow{"action": "fast_organize", "retire": []any{ids[0]}, "pinned": "x"}, "global", "test"); err == nil {
		t.Fatal("stale segment ids accepted")
	}
	diary := fastCall(t, s, memoryRow{"action": "diary_read", "id": out["diary_id"]})["diary"].(map[string]any)
	sources, _ := diary["sources"].([]any)
	if len(sources) != 2 || memString(sources[0].(map[string]any)["session"]) != "launch1/agent" || memInt(diary["first_at"]) != 1700000000000 {
		t.Fatalf("diary sources wrong: %v", diary)
	}
	for i, raw := range sources {
		if memInt(raw.(map[string]any)["segment"]) != ids[i] {
			t.Fatalf("diary sources do not match retired ids: %v, %v", sources, ids[:2])
		}
	}
	if list := fastCall(t, s, memoryRow{"action": "diary_list", "filter": "shareable"})["diaries"].([]any); len(list) != 1 {
		t.Fatalf("shareable list wrong: %v", list)
	}
	if r := fastCall(t, s, memoryRow{"action": "diary_mark", "id": out["diary_id"], "mark": "read"}); r["ok"] != false {
		t.Fatal("unshared diary marked read")
	}
	fastCall(t, s, memoryRow{"action": "diary_mark", "id": out["diary_id"], "mark": "shared"})
	if list := fastCall(t, s, memoryRow{"action": "diary_list", "filter": "waiting"})["diaries"].([]any); len(list) != 1 {
		t.Fatalf("waiting list wrong: %v", list)
	}
	fastCall(t, s, memoryRow{"action": "diary_mark", "id": out["diary_id"], "mark": "read"})
	if list := fastCall(t, s, memoryRow{"action": "diary_list", "filter": "waiting"})["diaries"].([]any); len(list) != 0 {
		t.Fatal("read diary still waiting")
	}
	found := fastCall(t, s, memoryRow{"action": "deep_search", "terms": []any{"团子", "橘猫"}})
	if d, _ := found["diaries"].([]any); len(d) != 1 {
		t.Fatalf("diary not found: %v", found)
	}
	if seg, _ := found["segments"].([]any); len(seg) != 1 {
		t.Fatalf("retired segment not found: %v", found)
	}
	if tr, _ := found["transcript"].([]any); len(tr) != 2 {
		t.Fatalf("transcript not found: %v", found)
	}
	if state := fastCall(t, s, memoryRow{"action": "dream_state"}); state["untold"] != true {
		t.Fatalf("dream not stored: %v", state)
	}
	claimed := fastCall(t, s, memoryRow{"action": "dream", "mode": "claim", "generate": false})
	if d, _ := claimed["dream"].(map[string]any); d == nil || !strings.Contains(memString(d["content"]), "西湖") {
		t.Fatalf("written dream not delivered: %v", claimed)
	}
}

func TestSubconsciousToolsFollowMemoryAndHost(t *testing.T) {
	defs := []ToolDefinition{{Name: "apply_patch"}, {Name: "ask_subconscious"}, {Name: "share_diary"}}
	names := func(list []ToolDefinition) string {
		out := []string{}
		for _, d := range list {
			out = append(out, d.Name)
		}
		return strings.Join(out, ",")
	}
	if got := names(filterSubconsciousTools(defs, false, false)); got != "apply_patch" {
		t.Fatal(got)
	}
	if got := names(filterSubconsciousTools(defs, true, false)); got != "apply_patch" {
		t.Fatal(got)
	}
	if got := names(filterSubconsciousTools(defs, true, true)); got != "apply_patch" {
		t.Fatal(got)
	}
	if !isWorkspaceTool("ask_subconscious") || !isWorkspaceTool("share_diary") {
		t.Fatal("subconscious tools not routed to the workspace")
	}
}

func subconsciousConfig(t *testing.T, m *AgentManager, window int) {
	t.Helper()
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	s.ContextWorkingTokens = 8192
	s.CompactPercent = 75
	compactAt := 6144
	for i := range s.APIProfiles {
		s.APIProfiles[i].CompactAtTokens = &compactAt
	}
	sub := s.APIProfiles[0]
	sub.ID, sub.Model, sub.ContextWindow, sub.CompactAtTokens = "sub-model", "fixture-sub", window, nil
	s.APIProfiles = append(s.APIProfiles, sub)
	s.SubconsciousProfile = "sub-model"
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
}

// 旧配置仍可读取，但当前压缩只走Eyra/PAC，不调用退役模型或产生潜意识聊天。
func TestPACIgnoresLegacySubconsciousAndCompactsWithEyra(t *testing.T) {
	var mu sync.Mutex
	subRequests, mainCompactions, steps := 0, 0, 0
	mainInputs := []string{}
	mainTools := map[string]bool{}
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, r *http.Request) {
		var body struct {
			Model string            `json:"model"`
			Tools []json.RawMessage `json:"tools"`
			Input []json.RawMessage `json:"input"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.Model == "fixture-sub" {
			mu.Lock()
			subRequests++
			mu.Unlock()
			t.Error("retired subconscious model was invoked")
			fixtureSizedAnswer(rw, body, "unexpected", "旧模型不应参与工作。", nil)
			return
		}
		if len(body.Input) > 0 && strings.Contains(string(body.Input[len(body.Input)-1]), "【工作上下文封存】") {
			mu.Lock()
			mainCompactions++
			mu.Unlock()
			fixtureSizedAnswer(rw, body, "pac-summary", "经过：前面几步都由我完成，文件已经写好。\n没做完的事：继续后面的步骤。", nil)
			return
		}
		mu.Lock()
		input, _ := json.Marshal(body.Input)
		mainInputs = append(mainInputs, string(input))
		for _, raw := range body.Tools {
			var d struct {
				Name string `json:"name"`
			}
			_ = json.Unmarshal(raw, &d)
			mainTools[d.Name] = true
		}
		steps++
		n := steps
		mu.Unlock()
		time.Sleep(60 * time.Millisecond)
		if n > 12 {
			fixtureSizedAnswer(rw, body, "done", "FINISHED", nil)
			return
		}
		fixtureSizedAnswer(rw, body, fmt.Sprintf("r%d", n), "", []any{
			map[string]any{"type": "message", "id": fmt.Sprintf("msg%d", n), "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": strings.Repeat("bounded progress ", 4000)}}},
			map[string]any{"type": "function_call", "id": fmt.Sprintf("fc%d", n), "call_id": fmt.Sprintf("call%d", n), "name": "report", "arguments": string(rawJSON(map[string]any{"action": "report", "format": "md", "title": fmt.Sprintf("step%d.txt", n), "content": "completed once\n"}))},
		})
	})
	subconsciousConfig(t, m, 128000)
	w := modeWorkspace(t, m.config, dir, HostOS)
	w.service = NewSettingsService(m.config)
	t.Cleanup(w.service.Close)
	w.mu.Lock()
	r, err := w.dispatchLocked(WorkspaceMatrix, workspaceID(), "finish all twelve steps and keep files")
	w.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	r, err = w.manager.Wait(context.Background(), w.state.ID, r.ID, 40000)
	if err != nil || r.State != "completed" || r.Result != "FINISHED" {
		t.Fatalf("state=%s error=%s %v", r.State, r.Error, err)
	}
	mu.Lock()
	defer mu.Unlock()
	if subRequests != 0 || mainCompactions == 0 {
		t.Fatal("PAC must use Eyra alone", subRequests, mainCompactions)
	}
	if mainTools["ask_subconscious"] || mainTools["share_diary"] {
		t.Fatal("retired tools exposed", mainTools)
	}
	carried := false
	for _, input := range mainInputs {
		carried = carried || strings.Contains(input, "前面几步都由我完成")
	}
	if !carried {
		t.Fatal("later requests did not carry the subconscious segment")
	}
	// 记忆带时间，请求尾部要有“现在”，模型才不会猜错过了多久。
	if !strings.Contains(mainInputs[len(mainInputs)-1], "本机现在是") {
		t.Fatal("memory-on request carries no local time")
	}
	snap, err := w.readPAC(context.Background())
	if err != nil || len(snap.Packets) == 0 {
		t.Fatalf("PAC not durably stored: %+v %v", snap, err)
	}
	view := w.subconsciousView()
	acts, _ := view["activities"].([]subActivity)
	if len(acts) != 0 {
		t.Fatal("PAC maintenance emitted subconscious chat activity", acts)
	}
}

// 旧的已分享日记仍可通过workspace.diary读完；仅夹具恢复历史快照，不恢复分享工具或后台生成。
func TestSharedDiaryReadThroughWorkspaceCall(t *testing.T) {
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, r *http.Request) { fixtureAnswer(rw, "x", "ok", nil) })
	subconsciousConfig(t, m, 128000)
	w := modeWorkspace(t, m.config, dir, HostOS)
	w.service = NewSettingsService(m.config)
	t.Cleanup(w.service.Close)
	ctx := context.Background()
	seg, err := w.memory(ctx, map[string]any{"action": "fast_append", "key": "k/agent", "content": "经过：写日记。", "first_pos": 0, "last_pos": 1, "source": "compact"})
	if err != nil {
		t.Fatal(err)
	}
	var appended struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(seg, &appended)
	raw, err := w.memory(ctx, map[string]any{"action": "fast_organize", "retire": []any{appended.ID}, "pinned": "- 要点", "diary": map[string]any{"title": "紫色的圆", "content": "今天画了潜意识。", "shareable": true}})
	if err != nil {
		t.Fatal(err)
	}
	var organized struct {
		DiaryID int64 `json:"diary_id"`
	}
	_ = json.Unmarshal(raw, &organized)
	if _, err := w.Call(ctx, "workspace.diary", rawJSON(map[string]any{"task_id": w.state.ID, "action": "read", "diary_id": organized.DiaryID})); err != nil {
		t.Fatal(err)
	}
	if r, _ := w.Call(ctx, "workspace.diary", rawJSON(map[string]any{"task_id": w.state.ID, "action": "read", "diary_id": organized.DiaryID})); r.(map[string]any)["ok"] != false {
		t.Fatal("unshared diary readable from the desktop")
	}
	if _, err := w.memory(ctx, map[string]any{"action": "diary_mark", "id": organized.DiaryID, "mark": "shared"}); err != nil {
		t.Fatal(err)
	}
	w.sub.mu.Lock()
	w.sub.diary = &subDiary{ID: organized.DiaryID, Title: "紫色的圆"}
	w.sub.mu.Unlock()
	if d, _ := w.subconsciousView()["diary"].(subDiary); d.ID != organized.DiaryID {
		t.Fatal("shared diary missing from snapshot")
	}
	read, err := w.Call(ctx, "workspace.diary", rawJSON(map[string]any{"task_id": w.state.ID, "action": "read", "diary_id": organized.DiaryID}))
	if err != nil || !strings.Contains(string(read.(json.RawMessage)), "今天画了潜意识") {
		t.Fatalf("read failed: %v %v", read, err)
	}
	if _, err := w.Call(ctx, "workspace.diary", rawJSON(map[string]any{"task_id": w.state.ID, "action": "done", "diary_id": organized.DiaryID})); err != nil {
		t.Fatal(err)
	}
	if _, ok := w.subconsciousView()["diary"]; ok {
		t.Fatal("read diary still on screen")
	}
	state, _ := w.memory(ctx, map[string]any{"action": "diary_read", "id": organized.DiaryID})
	if !strings.Contains(string(state), `"read":`) || strings.Contains(string(state), `"read":0`) {
		t.Fatalf("diary not marked read: %s", state)
	}
}
