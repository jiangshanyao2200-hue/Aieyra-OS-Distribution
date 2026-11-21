// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: askFixture; fixtureAsk; TestAskUserDurableOwnershipAndReceipts; TestAskUserCatalogFailureRollsBackQuestionAndAnswer; TestAskUserImmediateBoundedAndIdempotent; TestAskUserExplicitEmptySubmissionAcceptsRecommendation; TestAskUserReplayReportsCurrentStateWithoutRedelivery; TestAskUserOnlyPrimaryDesktopAndArgumentValidation; TestAskUserTextOptionLaterSkipAndReplyReceipts; TestAskUserContinuesToolsAndAnswerDrainsThenStartsNextRound
// Impact: python -B scripts/code-atlas.py show Core/workspace_ask_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func askFixture(t *testing.T) *Workspace {
	t.Helper()
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unit fixture called a model") })
	w := modeWorkspace(t, m.config, dir, HostOS)
	w.cancel()
	<-w.done // stop only this fixture's dispatcher; leave tool state available
	return w
}

func fixtureAsk(t *testing.T, w *Workspace, key string) string {
	t.Helper()
	ctx := context.WithValue(context.Background(), toolInvocationKey{}, key)
	r, err := w.askUser(ctx, WorkspaceMatrix, rawJSON(map[string]any{"question": "选什么风格？", "assumption": "先按冷白色继续", "options": []WorkspaceAskOption{{Label: "冷白"}, {Label: "暖色"}}, "recommended": 1}))
	if err != nil {
		t.Fatal(err)
	}
	return r.(map[string]any)["id"].(string)
}

func TestAskUserDurableOwnershipAndReceipts(t *testing.T) {
	w := askFixture(t)
	answered := fixtureAsk(t, w, "answered")
	pending := fixtureAsk(t, w, "pending")
	owner := w.contextBook.Active
	answer := rawJSON(map[string]any{"id": answered, "action": "answer", "text": "保留原文", "request_id": "durable-answer"})
	if _, err := w.replyAsk(answer); err != nil {
		t.Fatal(err)
	}
	// Catalog and live state must not share mutable legacy option storage.
	w.state.AskRequests[1].Options[0].Label = "live mutation"
	if w.contextSessionLocked().AskRequests[1].Options[0].Label != "冷白" {
		t.Fatal("live question aliases durable catalog")
	}
	w.state.AskRequests[1].Options[0].Label = "冷白"
	config, dir := w.config, w.state.Workdir
	w.Close()
	reopened := modeWorkspace(t, config, dir, HostOS)
	reopened.cancel()
	<-reopened.done
	if reopened.contextBook.Active != owner || len(reopened.state.AskRequests) != 2 || len(reopened.state.Messages) != 1 || reopened.state.Messages[0].State != "interrupted" {
		t.Fatal("reopening lost receipts or replayed pending input", reopened.state)
	}
	rows := reopened.pendingAsksLocked()
	if len(rows) != 1 || rows[0].ID != pending || rows[0].Assumption != "先按冷白色继续" {
		t.Fatal("pending question not restored", rows)
	}
	for i := 0; i < 2; i++ {
		if got := fixtureAsk(t, reopened, "answered"); got != answered {
			t.Fatal("closed tool call duplicated", got)
		}
		if _, err := reopened.replyAsk(answer); err != nil {
			t.Fatal(err)
		}
	}
	if len(reopened.state.Messages) != 1 || reopened.state.Messages[0].State != "interrupted" {
		t.Fatal("uncertain answer redelivered after reopen")
	}
	contextTestAction(t, reopened, "new", map[string]any{"title": "另一会话"})
	if len(reopened.state.AskRequests) != 0 {
		t.Fatal("new context inherited another context's questions")
	}
	if _, err := reopened.replyAsk(answer); err == nil {
		t.Fatal("answer crossed context ownership")
	}
	contextTestAction(t, reopened, "switch", map[string]any{"id": owner})
	if rows := reopened.pendingAsksLocked(); len(rows) != 1 || rows[0].ID != pending {
		t.Fatal("switching lost pending question", rows)
	}
	if got := fixtureAsk(t, reopened, "pending"); got != pending {
		t.Fatal("pending tool call duplicated after context switch")
	}
	if _, err := reopened.replyAsk(rawJSON(map[string]any{"id": answered, "action": "answer", "text": "更改回答", "request_id": "changed"})); err == nil {
		t.Fatal("closed receipt changed after context switch")
	}
}

func TestAskUserCatalogFailureRollsBackQuestionAndAnswer(t *testing.T) {
	w := askFixture(t)
	id := fixtureAsk(t, w, "saved")
	prior := string(rawJSON(w.contextBook))
	digest := w.contextCatalogDigest
	w.contextCatalogDigest = "stale-catalog-revision"
	args := rawJSON(map[string]any{"question": "未保存的问题", "recommendation": "稍后"})
	ctx := context.WithValue(context.Background(), toolInvocationKey{}, "unsaved")
	if _, err := w.askUser(ctx, WorkspaceMatrix, args); err == nil {
		t.Fatal("stale catalog accepted new question")
	}
	if len(w.state.AskRequests) != 1 || string(rawJSON(w.contextBook)) != prior {
		t.Fatal("failed save leaked new question into live state or catalog")
	}
	answer := rawJSON(map[string]any{"id": id, "action": "answer", "request_id": "retry-same-answer"})
	if _, err := w.replyAsk(answer); err == nil {
		t.Fatal("stale catalog accepted answer")
	}
	if w.state.AskRequests[0].State != "pending" || len(w.state.Messages) != 0 || string(rawJSON(w.contextBook)) != prior {
		t.Fatal("failed answer lost pending state or enqueued input")
	}
	w.contextCatalogDigest = digest
	for i := 0; i < 2; i++ {
		if _, err := w.replyAsk(answer); err != nil {
			t.Fatal(err)
		}
	}
	if len(w.state.Messages) != 1 || w.contextSessionLocked().AskRequests[0].ReplyID != "retry-same-answer" {
		t.Fatal("save retry did not commit answer exactly once")
	}
}

func TestAskUserImmediateBoundedAndIdempotent(t *testing.T) {
	w := askFixture(t)
	id := fixtureAsk(t, w, "call-1")
	if repeat := fixtureAsk(t, w, "call-1"); repeat != id {
		t.Fatal("uncertain call duplicated", repeat)
	}
	fixtureAsk(t, w, "call-2")
	fixtureAsk(t, w, "call-3")
	ctx := context.WithValue(context.Background(), toolInvocationKey{}, "call-4")
	if _, err := w.askUser(ctx, WorkspaceMatrix, rawJSON(map[string]any{"question": "第四个？", "assumption": "继续"})); err == nil {
		t.Fatal("pending limit ignored")
	}
	if _, err := w.askUser(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"question": "？", "assumption": "继续"})); err == nil {
		t.Fatal("missing receipt accepted")
	}
	ctx = context.WithValue(context.Background(), toolInvocationKey{}, "call-1")
	if _, err := w.askUser(ctx, WorkspaceMatrix, rawJSON(map[string]any{"question": "changed", "assumption": "继续"})); err == nil {
		t.Fatal("call identity conflict accepted")
	}
	w.mu.Lock()
	rows := w.pendingAsksLocked()
	w.mu.Unlock()
	if len(rows) != 3 || rows[0].CallKey != "" || rows[0].CallHash != "" || rows[0].ReplyID != "" {
		t.Fatal("private receipt leaked", rows)
	}
	rows[0].Options[0].Label = "mutated snapshot"
	if w.state.AskRequests[0].Options[0].Label != "冷白" {
		t.Fatal("snapshot aliases state")
	}
}

func TestAskUserExplicitEmptySubmissionAcceptsRecommendation(t *testing.T) {
	w := askFixture(t)
	ctx := context.WithValue(context.Background(), toolInvocationKey{}, "recommended-question")
	result, err := w.askUser(ctx, WorkspaceMatrix, rawJSON(map[string]any{"question": "如何安排？", "recommendation": "先完成当前项目，再检查结果"}))
	if err != nil {
		t.Fatal(err)
	}
	id := result.(map[string]any)["id"].(string)
	if len(w.state.Messages) != 0 || w.state.AskRequests[0].State != "pending" {
		t.Fatal("recommendation implied an answer")
	}
	if _, err = w.replyAsk(rawJSON(map[string]any{"id": id, "action": "answer", "text": ""})); err == nil {
		t.Fatal("missing submission identity accepted")
	}
	if _, err = w.replyAsk(rawJSON(map[string]any{"id": id, "action": "later"})); err != nil {
		t.Fatal(err)
	}
	if len(w.state.Messages) != 0 {
		t.Fatal("deferring implied consent")
	}
	answer := rawJSON(map[string]any{"id": id, "action": "answer", "text": " \n ", "request_id": "accept"})
	for i := 0; i < 2; i++ {
		if _, err = w.replyAsk(answer); err != nil {
			t.Fatal(err)
		}
	}
	if len(w.state.Messages) != 1 || !strings.Contains(w.state.Messages[0].Text, askAnswerAccepted+"先完成当前项目，再检查结果") {
		t.Fatal(w.state.Messages)
	}
	if text, ok := askAnswerDisplay(w.state.Messages[0].Text); !ok || text != w.state.Messages[0].DisplayText {
		t.Fatal("history changed the accepted recommendation", text)
	}
	ctx = context.WithValue(ctx, toolInvocationKey{}, "free-answer")
	result, err = w.askUser(ctx, WorkspaceMatrix, rawJSON(map[string]any{"question": "还有补充吗？", "recommendation": "按原计划继续"}))
	if err != nil {
		t.Fatal(err)
	}
	id = result.(map[string]any)["id"].(string)
	if _, err = w.replyAsk(rawJSON(map[string]any{"id": id, "action": "answer", "text": "先暂停处理", "request_id": "free-answer"})); err != nil {
		t.Fatal(err)
	}
	if w.state.Messages[1].DisplayText != "回答：先暂停处理" || strings.Contains(w.state.Messages[1].Text, askAnswerAccepted) {
		t.Fatal("free answer was replaced by recommendation")
	}
}

func TestAskUserReplayReportsCurrentStateWithoutRedelivery(t *testing.T) {
	for _, action := range []string{"answer", "skip"} {
		t.Run(action, func(t *testing.T) {
			w := askFixture(t)
			ctx := context.WithValue(context.Background(), toolInvocationKey{}, "same-question")
			args := rawJSON(map[string]any{"question": "先确认目录？", "assumption": "目录确认前只阅读项目文档"})
			call := func() map[string]any {
				t.Helper()
				r, err := w.askUser(ctx, WorkspaceMatrix, args)
				if err != nil {
					t.Fatal(err)
				}
				return r.(map[string]any)
			}
			first := call()
			if first["state"] != "pending" {
				t.Fatal("question was treated as answered", first)
			}
			if _, err := w.replyAsk(rawJSON(map[string]any{"id": first["id"], "action": "later"})); err != nil {
				t.Fatal(err)
			}
			if later := call(); later["state"] != "pending" {
				t.Fatal("later changed pending state", later)
			}
			if _, err := w.replyAsk(rawJSON(map[string]any{"id": first["id"], "request_id": "reply", "action": action, "text": "使用工作目录"})); err != nil {
				t.Fatal(err)
			}
			for i := 0; i < 2; i++ {
				last := call()
				if last["id"] != first["id"] || last["state"] != action {
					t.Fatal("replayed question has stale state", last)
				}
			}
			if len(w.state.AskRequests) != 1 || len(w.state.Messages) != 1 {
				t.Fatal("replay duplicated question or answer")
			}
		})
	}
}

func TestAskUserOnlyPrimaryDesktopAndArgumentValidation(t *testing.T) {
	w := askFixture(t)
	contains := func(items []string, name string) bool {
		for _, s := range items {
			if s == name {
				return true
			}
		}
		return false
	}
	if !contains(w.permissions(WorkspaceMatrix), "ask_user") || contains(w.permissions(WorkspaceProject), "ask_user") {
		t.Fatal("role permissions")
	}
	ctx := context.WithValue(context.Background(), toolInvocationKey{}, "call")
	valid := rawJSON(map[string]any{"question": "？", "assumption": "继续"})
	if _, err := w.askUser(ctx, WorkspaceProject, valid); err == nil {
		t.Fatal("child role accepted")
	}
	for _, raw := range []json.RawMessage{
		rawJSON(map[string]any{"question": strings.Repeat("问", 201), "assumption": "继续"}),
		rawJSON(map[string]any{"question": "？"}),
		rawJSON(map[string]any{"question": "？", "assumption": "继续", "recommended": 1}),
		rawJSON(map[string]any{"question": "？", "assumption": "继续", "options": []WorkspaceAskOption{{Label: ""}}}),
	} {
		if _, err := w.askUser(ctx, WorkspaceMatrix, raw); err == nil {
			t.Fatal("invalid question accepted", string(raw))
		}
	}
	w.host.terminal = true
	if contains(w.permissions(WorkspaceMatrix), "ask_user") {
		t.Fatal("CLI exposes desktop ask")
	}
	if _, err := w.askUser(ctx, WorkspaceMatrix, valid); err == nil {
		t.Fatal("terminal invocation accepted")
	}
	w.host.terminal = false
	w.split = &workspaceSplit{}
	if _, err := w.askUser(ctx, WorkspaceMatrix, valid); err == nil {
		t.Fatal("split invocation accepted")
	}
	w.split = nil
	if _, err := w.Call(ctx, "workspace.ask_reply", rawJSON(map[string]any{"task_id": "foreign", "id": "ask"})); err == nil {
		t.Fatal("foreign task bypass")
	}
}

func TestAskUserTextOptionLaterSkipAndReplyReceipts(t *testing.T) {
	w := askFixture(t)
	id := fixtureAsk(t, w, "one")
	if _, err := w.replyAsk(rawJSON(map[string]any{"id": id, "action": "later"})); err != nil {
		t.Fatal(err)
	}
	if w.state.AskRequests[0].State != "pending" || len(w.state.Messages) != 0 {
		t.Fatal("later consumed question")
	}
	answer := rawJSON(map[string]any{"id": id, "request_id": "answer-1", "action": "answer", "text": "只写我的想法"})
	for i := 0; i < 2; i++ {
		if _, err := w.replyAsk(answer); err != nil {
			t.Fatal(err)
		}
	}
	if len(w.state.Messages) != 1 || !strings.Contains(w.state.Messages[0].Text, "【用户回答你的提问】") || w.state.Messages[0].DisplayText != "回答：只写我的想法" {
		t.Fatal(w.state.Messages)
	}
	if _, err := w.replyAsk(rawJSON(map[string]any{"id": id, "request_id": "changed", "action": "answer", "option": 2})); err == nil {
		t.Fatal("closed question changed")
	}
	id = fixtureAsk(t, w, "two")
	if _, err := w.replyAsk(rawJSON(map[string]any{"id": id, "request_id": "answer-2", "action": "answer", "option": 2, "text": "尽量柔和"})); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(w.state.Messages[1].Text, "选了 B / 写了 尽量柔和") {
		t.Fatal(w.state.Messages[1])
	}
	id = fixtureAsk(t, w, "three")
	skip := rawJSON(map[string]any{"id": id, "request_id": "skip-1", "action": "skip"})
	for i := 0; i < 2; i++ {
		if _, err := w.replyAsk(skip); err != nil {
			t.Fatal(err)
		}
	}
	if len(w.state.Messages) != 3 || !strings.Contains(w.state.Messages[2].Text, "用户跳过了这个问题，按你的假设继续") {
		t.Fatal(w.state.Messages)
	}
	w.mu.Lock()
	pending := w.pendingAsksLocked()
	w.mu.Unlock()
	if len(pending) != 0 {
		t.Fatal("closed questions remained public")
	}
	w.updateFrozen = true
	if _, err := w.replyAsk(skip); err == nil {
		t.Fatal("frozen handoff accepted")
	}
}

func TestAskUserContinuesToolsAndAnswerDrainsThenStartsNextRound(t *testing.T) {
	var requests atomic.Int32
	continued, release := make(chan struct{}), make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		n := requests.Add(1)
		switch n {
		case 1:
			fixtureAnswer(rw, "ask", "", []any{map[string]any{"type": "function_call", "id": "fc_ask", "call_id": "ask_1", "name": "ask_user", "arguments": `{"question":"需要什么颜色？","assumption":"先生成冷白草稿"}`}})
		case 2:
			close(continued)
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
			fixtureAnswer(rw, "work", "", []any{map[string]any{"type": "function_call", "id": "fc_patch", "call_id": "patch_1", "name": "report", "arguments": string(rawJSON(map[string]any{"action": "report", "format": "md", "title": "asked-proof.txt", "content": "continued without blocking\n"}))}})
		case 3:
			b, _ := json.Marshal(body)
			if !strings.Contains(string(b), "【用户回答你的提问】") || !strings.Contains(string(b), "暖色") {
				t.Error("answer lost at boundary")
			}
			fixtureAnswer(rw, "done", "已按回答调整", nil)
		default:
			fixtureAnswer(rw, "next", "收到新轮回答", nil)
		}
	})
	w := modeWorkspace(t, m.config, dir, HostOS)
	// Exercise the real original-message observer as well as answer delivery.
	// Without it this scenario missed the workspace-lock reentry regression.
	w.service = NewSettingsService(m.config)
	t.Cleanup(func() { w.flushTranscript(3 * time.Second); w.service.Close() })
	w.mu.Lock()
	record, err := w.dispatchLocked(WorkspaceMatrix, "initial", "做一个草稿，缺信息也继续")
	w.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-continued:
	case <-time.After(10 * time.Second):
		t.Fatal("ask_user blocked next request")
	}
	w.mu.Lock()
	questions := w.pendingAsksLocked()
	w.mu.Unlock()
	if len(questions) != 1 {
		t.Fatal(questions)
	}
	if _, err := w.replyAsk(rawJSON(map[string]any{"id": questions[0].ID, "action": "answer", "request_id": "mid-answer", "text": "暖色"})); err != nil {
		t.Fatal(err)
	}
	close(release)
	finished, err := w.manager.Wait(context.Background(), w.state.ID, record.ID, 10000)
	if err != nil || finished.State != "completed" {
		t.Fatal(finished.State, finished.Error, err)
	}
	w.flushTranscript(3 * time.Second)
	original, originalErr := w.memory(context.Background(), map[string]any{"action": "pac_history", "query": "暖色"})
	if originalErr != nil || !strings.Contains(string(original), "暖色") {
		t.Fatalf("answered supplement not durably searchable: %s %v", original, originalErr)
	}
	assertFixtureReport(t, w, "asked-proof.txt", "continued without blocking\n")
	id := fixtureAsk(t, w, "after-end")
	if _, err := w.replyAsk(rawJSON(map[string]any{"id": id, "action": "answer", "request_id": "new-round", "text": "下一轮补充"})); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		r, err := w.manager.Status(w.state.ID, record.ID)
		if err == nil && r.Generation > finished.Generation && r.State == "completed" {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("idle answer did not start a new round")
}
