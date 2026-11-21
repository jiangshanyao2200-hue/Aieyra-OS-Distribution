// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: historyFixture; TestNumberedHistoryKeepsTenWholeTurnsAndSearchResults; TestWorkspaceHistoryKeepsInternalTeamInputOutOfConversation; TestWorkspaceHistoryPublicThinkingIsPagedOriginalAndNotDuplicatedByToolTurn; TestWorkspaceHistoryStablePagesAndCompactBoundary; TestWorkspaceHistoryOriginalReceiptPagingAndOwnership; TestWorkspaceHistoryNestedAndPartialArchive; TestWorkspaceHistoryScanBudgetExcludesSystemActions; TestWorkspaceHistorySeparatesNoticesFromReportsAndCompaction; TestWorkspaceHistoryLongMessagesAndDamagedSource; TestWorkspaceHistoryExcludesDurableHostActionsAndKeepsUnavailableMessages; TestWorkspaceNoticeSharedRetryAndCollision; TestWorkspaceHistoryKeepsDeliveredFiles; TestWorkspaceHistoryArchivedFileChangeIsReadableWithExactReceipt
// Impact: python -B scripts/code-atlas.py show Core/workspace_history_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func historyFixture(t *testing.T) (*Workspace, string, *SessionArchive) {
	t.Helper()
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("history must never execute a model request") })
	id := workspaceID()
	a := &SessionArchive{ephemeral: true}
	w.manager.mu.Lock()
	w.manager.jobs[id] = &agentJob{record: AgentRecord{ID: id, Parent: w.state.ID, State: "completed"}, archive: a}
	w.manager.mu.Unlock()
	return w, id, a
}

func TestNumberedHistoryKeepsTenWholeTurnsAndSearchResults(t *testing.T) {
	w, _, _ := historyFixture(t)
	var rows []historyEntry
	for n := 1; n <= 111; n++ {
		name := fmt.Sprintf("turn-%03d", n)
		rows = append(rows, historyEntry{ID: name, Kind: "message", Role: "user", Text: name})
		for i := 0; i < 21; i++ {
			rows = append(rows, historyEntry{ID: fmt.Sprintf("%s-tool-%d", name, i), Kind: "tool"})
		}
		rows = append(rows, historyEntry{ID: name + "-answer", Kind: "message", Role: "matrix", Text: "结果 " + name})
	}
	for _, tc := range []struct {
		page, first, last, n int
		query                string
	}{
		{1, 102, 111, 230, ""}, {6, 52, 61, 230, ""}, {12, 1, 1, 23, ""}, {40, 1, 1, 23, ""},
		{6, 52, 61, 10, "结果"}, {1, 102, 111, 20, "turn-"},
	} {
		got, pages, page := w.numberedHistory(rows, tc.page, tc.query)
		if len(got) != tc.n || pages != 12 || page != min(tc.page, 12) || !strings.HasPrefix(got[0].ID, fmt.Sprintf("turn-%03d", tc.first)) || !strings.HasPrefix(got[len(got)-1].ID, fmt.Sprintf("turn-%03d", tc.last)) {
			t.Fatalf("request %d %q got page %d/%d with %d entries", tc.page, tc.query, page, pages, len(got))
		}
	}
	if got, pages, page := w.numberedHistory(rows, 1, "没有这句话"); len(got) != 0 || pages != 1 || page != 1 {
		t.Fatal("empty search", len(got), pages, page)
	}
}

func TestWorkspaceHistoryKeepsInternalTeamInputOutOfConversation(t *testing.T) {
	w, _, archive := historyFixture(t)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	notifications := []workspaceMessage{
		{ID: "typed-notice", Origin: "team_result", From: WorkspaceProject, To: WorkspaceMatrix, At: now, Text: "internal model instructions"},
		{ID: "team-result-execution-old-3", From: WorkspaceExecution, To: WorkspaceMatrix, At: now, Text: "legacy internal instructions"},
	}
	for _, m := range notifications {
		if err := archive.Append("host", WorkspaceEvent{Kind: "message", Data: m}); err != nil {
			t.Fatal(err)
		}
	}
	w.mu.Lock()
	w.state.Messages = append(w.state.Messages, notifications[0])
	w.state.Messages = append(w.state.Messages,
		workspaceMessage{ID: "team-result-quoted", From: "user", To: WorkspaceMatrix, At: now, Text: "[Team result] 是什么意思？"},
		workspaceMessage{ID: "public-reply", From: WorkspaceProject, To: "user", At: now, Text: "检查完成"})
	w.state.TeamTalk = append(w.state.TeamTalk, workspaceTalk{ID: "public-brief", From: WorkspaceProject, Brief: "已完成检查", Kind: "result"})
	w.mu.Unlock()
	result, err := w.historyPage(rawJSON(map[string]any{}))
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, row := range result.(map[string]any)["entries"].([]historyEntry) {
		seen[row.ID] = true
		if strings.Contains(row.Text, "internal") {
			t.Fatal("internal model input exposed as conversation", row.ID)
		}
	}
	if !seen["message:team-result-quoted"] || !seen["message:public-reply"] {
		t.Fatal("legitimate user or role message was filtered", seen)
	}
	for _, m := range notifications {
		if seen["message:"+m.ID] {
			t.Fatal("notification reached history", m.ID)
		}
		if _, err := w.historyReceipt(rawJSON(map[string]any{"entry_id": "message:" + m.ID})); err == nil {
			t.Fatal("notification exposed through original-message receipt", m.ID)
		}
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.state.Messages) != 3 || w.state.Messages[0].Text != notifications[0].Text || len(w.state.TeamTalk) != 1 || w.state.TeamTalk[0].Brief != "已完成检查" {
		t.Fatal("history projection changed task input or the public brief")
	}
}

func TestWorkspaceHistoryPublicThinkingIsPagedOriginalAndNotDuplicatedByToolTurn(t *testing.T) {
	w, _, archive := historyFixture(t)
	call := ToolCall{ID: "local-only", Function: FunctionCall{Name: "update_plan", Arguments: `{}`}}
	thought := strings.Repeat("公开摘要🙂", 2000)
	response := Message{Role: RoleAssistant, ReasoningContent: thought, ToolCalls: []ToolCall{call}}
	if err := archive.Append("tool_intent", ToolIntent{InvocationID: "thought-turn", Response: response}); err != nil {
		t.Fatal(err)
	}
	if err := archive.Append("tool_turn", ToolTurn{InvocationID: "thought-turn", Messages: []Message{response}}); err != nil {
		t.Fatal(err)
	}
	if err := archive.Append("message", Message{Role: RoleAssistant, Content: "结尾正文", ReasoningContent: "结尾前公开摘要"}); err != nil {
		t.Fatal(err)
	}
	result, err := w.historyPage(rawJSON(map[string]any{"limit": 30}))
	if err != nil {
		t.Fatal(err)
	}
	thoughts := 0
	for _, row := range result.(map[string]any)["entries"].([]historyEntry) {
		if row.SortKey == "" {
			t.Fatal("缺少精确历史排序游标", row)
		}
		if row.Kind != "thinking" {
			continue
		}
		thoughts++
		receipt, err := w.historyReceipt(rawJSON(map[string]any{"entry_id": row.ID}))
		if err != nil {
			t.Fatal(err)
		}
		original := receipt.(map[string]any)["input"].(string)
		if original != thought && original != "结尾前公开摘要" {
			t.Fatal("公开摘要未从原存档取回")
		}
	}
	if thoughts != 2 {
		t.Fatal("思考缺失或被工具提交重复", thoughts)
	}
}

func TestWorkspaceHistoryStablePagesAndCompactBoundary(t *testing.T) {
	w, id, a := historyFixture(t)
	for n := 0; n < 67; n++ {
		if err := a.Append("message", Message{Role: RoleAssistant, Content: fmt.Sprintf("row-%02d", n)}); err != nil {
			t.Fatal(err)
		}
	}
	page := func(segment, before string) map[string]any {
		t.Helper()
		r, e := w.historyPage(rawJSON(map[string]any{"segment": segment, "before": before, "limit": 20}))
		if e != nil {
			t.Fatal(e)
		}
		return r.(map[string]any)
	}
	first := page("", "")
	if len(first["entries"].([]historyEntry)) != 20 || !first["has_more"].(bool) {
		t.Fatal(first)
	}
	_ = a.Append("message", Message{Role: RoleAssistant, Content: "arrived after first page"})
	seen := map[string]bool{}
	current := first
	for {
		for _, row := range current["entries"].([]historyEntry) {
			if seen[row.ID] {
				t.Fatal("duplicate cursor row")
			}
			seen[row.ID] = true
		}
		if !current["has_more"].(bool) {
			break
		}
		current = page("", current["before"].(string))
	}
	if len(seen) != 67 {
		t.Fatal("page navigation skipped older records", len(seen))
	}
	w.mu.Lock()
	w.resetHistoryLocked()
	segment := w.state.HistorySegment
	w.mu.Unlock()
	if page("", "")["reset"] != true {
		t.Fatal("late request crossed compact segment")
	}
	_ = a.Append("message", Message{Role: RoleAssistant, Content: "new segment"})
	rows := page(segment, "")["entries"].([]historyEntry)
	if len(rows) != 1 || rows[0].Text != "new segment" || rows[0].Agent != id {
		t.Fatal(rows)
	}
}

func TestWorkspaceHistoryOriginalReceiptPagingAndOwnership(t *testing.T) {
	w, id, a := historyFixture(t)
	call := ToolCall{ID: "call", Function: FunctionCall{Name: "exec_command", Arguments: `{"cmd":"synthetic"}`}}
	output := string(rawJSON(map[string]any{"ok": true, "state": "cancelled", "exit_code": 1, "output": strings.Repeat("汉字🙂\n", 40000)}))
	if err := a.Append("tool_intent", ToolIntent{InvocationID: "turn", Response: Message{ToolCalls: []ToolCall{call}}}); err != nil {
		t.Fatal(err)
	}
	if err := a.Append("tool_progress", ToolReceipt{Key: "turn:call", ToolName: "exec_command", Output: output}); err != nil {
		t.Fatal(err)
	}
	var got strings.Builder
	offset := 0
	for {
		r, e := w.historyReceipt(rawJSON(map[string]any{"agent_id": id, "id": "turn:call", "output_offset": offset}))
		if e != nil {
			t.Fatal(e)
		}
		v := r.(map[string]any)
		part := v["output"].(string)
		if len(part) > 64<<10 || !utf8.ValidString(part) || v["state"] != "cancelled" {
			t.Fatal("invalid receipt chunk/state")
		}
		got.WriteString(part)
		offset = v["next_output"].(int)
		if offset == 0 {
			break
		}
	}
	if got.String() != output {
		t.Fatal("paged output lost original data")
	}
	if _, e := w.historyReceipt(rawJSON(map[string]any{"agent_id": workspaceID(), "id": "turn:call"})); e == nil {
		t.Fatal("foreign receipt exposed")
	}
	if _, _, e := historyChunk("🙂", 1); e == nil {
		t.Fatal("split UTF-8 cursor accepted")
	}
	// Pinned readers can retrieve originals after the display segment resets.
	w.mu.Lock()
	w.resetHistoryLocked()
	w.mu.Unlock()
	if _, e := w.historyReceipt(rawJSON(map[string]any{"agent_id": id, "id": "turn:call"})); e != nil {
		t.Fatal(e)
	}
}

func TestWorkspaceHistoryNestedAndPartialArchive(t *testing.T) {
	w, id, _ := historyFixture(t)
	dir := filepath.Join(w.manager.dir, id+".shell", "cells")
	if e := os.MkdirAll(dir, 0700); e != nil {
		t.Fatal(e)
	}
	value := map[string]any{"at": time.Now().UnixMicro(), "type": "nested", "record": map[string]any{"id": 1, "call": ToolCall{Function: FunctionCall{Name: "read_file", Arguments: `{"path":"synthetic"}`}}, "state": "completed", "output": "original nested output"}}
	data := rawJSON(value)
	file := filepath.Join(dir, "cell.jsonl")
	if e := os.WriteFile(file, data, 0600); e != nil {
		t.Fatal(e)
	}
	budget := 200000
	visits := 0
	src := historySource{key: "partial", path: file}
	offset, pending, e := historyScan(src, 0, &budget, func([]byte, historyRef) error { visits++; return nil })
	if e != nil || offset != 0 || !pending || visits != 0 {
		t.Fatal(offset, pending, e, visits)
	}
	if e := os.WriteFile(file, append(data, '\n'), 0600); e != nil {
		t.Fatal(e)
	}
	r, e := w.historyReceipt(rawJSON(map[string]any{"agent_id": id, "id": "cell:1"}))
	if e != nil {
		t.Fatal(e)
	}
	got := r.(map[string]any)
	if got["output"] != "original nested output" || got["tool"] != "read_file" {
		t.Fatal(got)
	}
}

func TestWorkspaceHistoryScanBudgetExcludesSystemActions(t *testing.T) {
	w, _, a := historyFixture(t)
	for i := 0; i < 5; i++ {
		_ = a.Append("message", Message{Role: RoleAssistant, Content: strings.Repeat("x", 600000)})
	}
	r, e := w.historyPage(rawJSON(map[string]any{}))
	if e != nil {
		t.Fatal(e)
	}
	if r.(map[string]any)["indexing"] != true {
		t.Fatal("unbounded indexing")
	}
	w.feed.publish(WorkspaceMatrix, "cancel_requested", map[string]bool{"requested": true})
	for i := 0; i < 3; i++ {
		r, e = w.historyPage(rawJSON(map[string]any{}))
		if e != nil {
			t.Fatal(e)
		}
	}
	found := false
	for _, v := range r.(map[string]any)["entries"].([]historyEntry) {
		if v.Title == "cancel_requested" {
			found = true
		}
	}
	if found {
		t.Fatal("system action leaked into conversation history")
	}
}

func TestWorkspaceHistorySeparatesNoticesFromReportsAndCompaction(t *testing.T) {
	w, _, archive := historyFixture(t)
	if err := archive.Append("compaction_state", CompactionState{RequestID: "actual-compaction", State: "preparing"}); err != nil {
		t.Fatal(err)
	}
	w.mu.Lock()
	notice, err := w.publishMessageLocked("system-notice", "system", "需要留意", "md", "系统通知原文")
	if err == nil {
		_, err = w.publishMessageLocked("actual-report", "report", "需要留意", "md", "这是用户要求的报告，标题相同仍然保留。")
	}
	w.state.Messages = append(w.state.Messages, workspaceMessage{ID: "quoted-notice", From: "user", To: WorkspaceMatrix, Text: "需要留意 是什么意思？", At: time.Now().UTC().Format(time.RFC3339Nano)})
	w.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	result, err := w.historyPage(rawJSON(map[string]any{}))
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	compaction := false
	for _, row := range result.(map[string]any)["entries"].([]historyEntry) {
		seen[row.ID] = true
		compaction = compaction || row.Compaction
	}
	if seen["document:"+notice.ID] || !seen["document:actual-report"] || !seen["message:quoted-notice"] || !compaction {
		t.Fatal("notice/report/compaction distinction lost", seen, compaction)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.state.Documents) != 2 || w.state.Documents[0].ID != notice.ID {
		t.Fatal("history projection deleted the independent notification")
	}
}

func TestWorkspaceHistoryLongMessagesAndDamagedSource(t *testing.T) {
	w, id, archive := historyFixture(t)
	original := strings.Repeat("完整记录🙂汉字\n", 18000)
	w.mu.Lock()
	w.state.Messages = append(w.state.Messages, workspaceMessage{ID: "long-message", From: "user", At: time.Now().UTC().Format(time.RFC3339Nano), Text: original})
	w.mu.Unlock()
	if err := archive.Append("message", Message{Role: RoleAssistant, Content: "valid source survives"}); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(w.manager.dir, id+".shell", "cells")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "damaged.jsonl"), []byte("not json\n"), 0600); err != nil {
		t.Fatal(err)
	}
	r, err := w.historyPage(rawJSON(map[string]any{}))
	if err != nil {
		t.Fatal(err)
	}
	page := r.(map[string]any)
	if page["warning"] == "" {
		t.Fatal("damaged archive not reported")
	}
	var found, valid bool
	for _, entry := range page["entries"].([]historyEntry) {
		if entry.Text == "valid source survives" {
			valid = true
		}
		if entry.ID == "message:long-message" {
			found = entry.TextMore && len(entry.Text) <= 16<<10 && utf8.ValidString(entry.Text)
		}
	}
	if !found || !valid {
		t.Fatal("valid records or bounded long-message preview missing")
	}
	var reconstructed strings.Builder
	offset := 0
	for {
		r, err := w.historyReceipt(rawJSON(map[string]any{"entry_id": "message:long-message", "input_offset": offset}))
		if err != nil {
			t.Fatal(err)
		}
		part := r.(map[string]any)
		chunk := part["input"].(string)
		if len(chunk) > 64<<10 || !utf8.ValidString(chunk) {
			t.Fatal("invalid UTF-8 chunk")
		}
		reconstructed.WriteString(chunk)
		offset = part["next_input"].(int)
		if offset == 0 {
			break
		}
	}
	if reconstructed.String() != original {
		t.Fatal("message paging lost original text")
	}
	w.mu.Lock()
	w.resetHistoryLocked()
	w.mu.Unlock()
	if _, err := w.historyReceipt(rawJSON(map[string]any{"entry_id": "message:long-message"})); err == nil {
		t.Fatal("old segment message remained readable through history")
	}
}

func TestWorkspaceHistoryExcludesDurableHostActionsAndKeepsUnavailableMessages(t *testing.T) {
	w, _, valid := historyFixture(t)
	archive, err := NewSessionArchive(filepath.Join(t.TempDir(), "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	w.feed.mu.Lock()
	w.feed.archive = archive
	w.feed.mu.Unlock()
	w.feed.publish(WorkspaceMatrix, "cancel_requested", map[string]bool{"requested": true})
	w.feed.publish(WorkspaceMatrix, "message", workspaceMessage{ID: "durable-host-user", From: "user", To: WorkspaceMatrix, Text: "durable public message", At: time.Now().UTC().Format(time.RFC3339Nano)})
	if err := valid.Append("message", Message{Role: RoleAssistant, Content: "independent valid receipt"}); err != nil {
		t.Fatal(err)
	}
	page := func() map[string]any {
		t.Helper()
		r, err := w.historyPage(rawJSON(map[string]any{}))
		if err != nil {
			t.Fatal(err)
		}
		for _, row := range r.(map[string]any)["entries"].([]historyEntry) {
			if row.Title == "cancel_requested" {
				t.Fatal("durable system action leaked into conversation history")
			}
		}
		return r.(map[string]any)
	}
	find := func(p map[string]any) (historyEntry, bool) {
		for _, row := range p["entries"].([]historyEntry) {
			if row.ID == "message:durable-host-user" {
				return row, true
			}
		}
		return historyEntry{}, false
	}
	first := page()
	row, found := find(first)
	if !found || row.Text != "durable public message" || row.Unavailable {
		t.Fatal("durable public message missing", first)
	}
	data, err := os.ReadFile(archive.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "cancel_requested") {
		t.Fatal("history projection deleted the durable system action")
	}
	if err := os.Remove(archive.Path); err != nil {
		t.Fatal(err)
	}
	missing := page()
	row, found = find(missing)
	if !found || !row.Unavailable || missing["warning"] == "" {
		t.Fatal("missing original was not reported", missing)
	}
	var validFound bool
	for _, row := range missing["entries"].([]historyEntry) {
		validFound = validFound || row.Text == "independent valid receipt"
	}
	if !validFound {
		t.Fatal("one missing source hid valid rows")
	}
	if err := os.WriteFile(archive.Path, data, 0600); err != nil {
		t.Fatal(err)
	}
	row, found = find(page())
	if !found || row.Unavailable || row.Text != "durable public message" {
		t.Fatal("restored receipt cannot be retried")
	}
}

func TestWorkspaceNoticeSharedRetryAndCollision(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("notice made model request") })
	a, b := modeWorkspace(t, m.config, dir, HostOS), modeWorkspace(t, m.config, dir, HostOS)
	id := workspaceID()
	args := rawJSON(map[string]any{"id": id, "text": "synthetic notice"})
	first, e := a.notice(args)
	if e != nil {
		t.Fatal(e)
	}
	second, e := b.notice(args)
	if e != nil {
		t.Fatal(e)
	}
	one, _ := json.Marshal(first)
	two, _ := json.Marshal(second)
	if string(one) != string(two) {
		t.Fatal("cross-window retry duplicated report")
	}
	if _, e = b.notice(rawJSON(map[string]any{"id": id, "text": "different"})); e == nil {
		t.Fatal("same id rewrote original")
	}
	if _, e = b.documentState(rawJSON(map[string]any{"id": id, "action": "close", "expected_revision": 0})); e != nil {
		t.Fatal(e)
	}
	again, e := a.notice(args)
	if e != nil {
		t.Fatal(e)
	}
	if !again.(map[string]any)["document"].(WorkspaceDocument).Dismissed {
		t.Fatal("retry revived dismissed notice")
	}
}

func TestWorkspaceHistoryKeepsDeliveredFiles(t *testing.T) {
	w, _, _ := historyFixture(t)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	w.mu.Lock()
	w.state.Messages = append(w.state.Messages,
		workspaceMessage{ID: "done", From: WorkspaceMatrix, To: "user", State: "completed", At: now, Text: "做好了。", Artifacts: []WorkspaceArtifact{{Path: "搬家待办.html", Size: 5942, Kind: "html", Created: true}}},
		workspaceMessage{ID: "changes_x", From: WorkspaceMatrix, To: WorkspaceProject, Reference: true, State: "context", At: now, Text: `{"files":[{"path":"搬家待办.html"}],"instruction":"Eyra recorded these file changes."}`})
	w.mu.Unlock()
	r, err := w.historyPage(rawJSON(map[string]any{}))
	if err != nil {
		t.Fatal(err)
	}
	var files, note bool
	for _, entry := range r.(map[string]any)["entries"].([]historyEntry) {
		files = files || entry.ID == "message:done" && len(entry.Artifacts) == 1 && entry.Artifacts[0].Path == "搬家待办.html"
		note = note || entry.ID == "message:changes_x" && entry.Text == "Eyra 记录了文件变更：搬家待办.html" && entry.TextMore
	}
	if !files || !note {
		t.Fatalf("delivered file entry %v, change note %v", files, note)
	}
}

func TestWorkspaceHistoryArchivedFileChangeIsReadableWithExactReceipt(t *testing.T) {
	w, _, archive := historyFixture(t)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	note := workspaceMessage{ID: "changes_archived", From: WorkspaceMatrix, To: WorkspaceProject, Reference: true, State: "interrupted", At: now, Text: `{"files":[{"path":"result.html"}],"instruction":"Eyra recorded these file changes."}`}
	if err := archive.Append("host", WorkspaceEvent{Kind: "message", Data: note}); err != nil {
		t.Fatal(err)
	}
	result, err := w.historyPage(rawJSON(map[string]any{"all_history": true}))
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range result.(map[string]any)["entries"].([]historyEntry) {
		if row.ID != "message:"+note.ID {
			continue
		}
		if row.Text != "Eyra 记录了文件变更：result.html" || !row.TextMore {
			t.Fatalf("unreadable archived note: %+v", row)
		}
		original, _, err := w.receiptText(row)
		if err != nil || original != note.Text {
			t.Fatalf("exact original lost: %q %v", original, err)
		}
		return
	}
	t.Fatal("archived change note absent")
}
