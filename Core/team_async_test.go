// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: waitTrue; plannedContext; TestTeamDispatchReturnsAtOnceAndNotifies; TestTeamWaitYieldsToUserMessage; TestDeleteConversationSession; TestDeleteConversationCleanupFailureSurvivesRestart; TestEyraIndependentSessions; TestDeleteConversationWaitsForFinalization
// Impact: python -B scripts/code-atlas.py show Core/team_async_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func waitTrue(t *testing.T, what string, fn func() bool) {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(30 * time.Millisecond)
	}
	t.Fatal(what)
}

func plannedContext() context.Context {
	return context.WithValue(context.Background(), workflowContextKey{}, workflowContext{Plan: &PlanEngine{State: &PlanState{ID: "p", Status: "active"}}})
}

// 派工默认不等；成员做完，结果主动进 Eyra 的队列，聊天里留一句，不会告知两遍。
func TestTeamDispatchReturnsAtOnceAndNotifies(t *testing.T) {
	withLegacyHomeTeam(t)
	release := make(chan struct{})
	w := collaborationFixture(t, func(rw http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
		fixtureAnswer(rw, "cota", "简报：改好了\nFiles: a.go", nil)
	}, nil)
	if _, err := w.collaborationCall(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "configure", "mode": "custom", "roles": []string{WorkspaceExecution}})); err != nil {
		t.Fatal(err)
	}
	result, err := w.team(plannedContext(), WorkspaceMatrix, rawJSON(map[string]any{"action": "dispatch", "role": WorkspaceExecution, "request_id": "async-1", "message": "work", "brief": "帮我改一下"}))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(rawJSON(result)), "will_notify") {
		t.Fatal("dispatch waited or did not promise a notice", string(rawJSON(result)))
	}
	close(release)
	notice := func() *workspaceMessage {
		w.mu.Lock()
		defer w.mu.Unlock()
		for i := range w.state.Messages {
			if m := w.state.Messages[i]; strings.HasPrefix(m.ID, "team-result-") && m.To == WorkspaceMatrix && strings.Contains(m.Text, "改好了") {
				return &m
			}
		}
		return nil
	}
	waitTrue(t, "helper result never reached Eyra", func() bool { return notice() != nil })
	w.mu.Lock()
	await := len(w.state.TeamAwait)
	talk := 0
	for _, line := range w.state.TeamTalk {
		if line.Kind == "result" {
			talk++
		}
	}
	w.mu.Unlock()
	if await != 0 || talk != 1 {
		t.Fatal("await or result talk", await, talk)
	}
}

// 显式 wait 时用户说话立刻返回；成员还在跑，做完照样告知。
func TestTeamWaitYieldsToUserMessage(t *testing.T) {
	withLegacyHomeTeam(t)
	release := make(chan struct{})
	var once atomic.Bool
	// 必须先于夹具的清理放行，否则测试服务器关闭时一直等这个请求。
	defer func() {
		if once.CompareAndSwap(false, true) {
			close(release)
		}
	}()
	w := collaborationFixture(t, func(rw http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
		fixtureAnswer(rw, "cota", "简报：做完了", nil)
	}, nil)
	if _, err := w.collaborationCall(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "configure", "mode": "custom", "roles": []string{WorkspaceExecution}})); err != nil {
		t.Fatal(err)
	}
	if _, err := w.team(plannedContext(), WorkspaceMatrix, rawJSON(map[string]any{"action": "dispatch", "role": WorkspaceExecution, "request_id": "async-2", "message": "work", "wait": false})); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	started := time.Now()
	go func() {
		_, err := w.team(plannedContext(), WorkspaceMatrix, rawJSON(map[string]any{"action": "wait", "role": WorkspaceExecution}))
		done <- err
	}()
	time.Sleep(100 * time.Millisecond)
	w.mu.Lock()
	w.state.Messages = append(w.state.Messages, workspaceMessage{ID: "user-now", From: "user", To: WorkspaceMatrix, Text: "还有一句", State: "context", At: time.Now().UTC().Format(time.RFC3339Nano)})
	w.mu.Unlock()
	w.notified <- struct{}{}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("wait did not yield to the user message")
	}
	if time.Since(started) > 5*time.Second {
		t.Fatal("wait took too long")
	}
	w.mu.Lock()
	_, pending := w.state.TeamAwait[WorkspaceExecution]
	for i := range w.state.Messages {
		if w.state.Messages[i].ID == "user-now" {
			w.state.Messages[i].State = "withdrawn"
		}
	}
	w.mu.Unlock()
	if !pending {
		t.Fatal("the running helper would never notify")
	}
}

// 删除一段会话：聊天和记录都从磁盘消失，其他会话不受影响；最后一段可删除，联系人及默认设置保留。
func TestDeleteConversationSession(t *testing.T) {
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { fixtureAnswer(w, "chat", "reply", nil) })
	h := NewWorkspaceHost(m.config, "", " ")
	t.Cleanup(h.Close)
	call := func(p map[string]any) map[string]any {
		t.Helper()
		v, err := h.conversationCall(context.Background(), rawJSON(p))
		if err != nil {
			t.Fatal(p["action"], err)
		}
		var out map[string]any
		if err := json.Unmarshal(rawJSON(v), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	contact := call(map[string]any{"action": "contact_create", "request_id": "c1", "model_id": "local-model", "name": "小助手"})
	id := contact["id"].(string)
	second := call(map[string]any{"action": "session_create", "contact_id": id, "request_id": "s2"})["id"].(string)
	manager, err := h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	record := filepath.Join(manager.dir, second+".json")
	if _, err := os.Stat(record); err != nil {
		t.Fatal("session record missing", err)
	}
	deleted := call(map[string]any{"action": "session_delete", "id": second})
	receipt := deleted["cleanup"].(map[string]any)
	if receipt["state"] != "completed" || len(receipt["steps"].([]any)) != 6 {
		t.Fatal("missing complete cleanup receipt", receipt)
	}
	// The owner is already gone. Simulate a crash before the final receipt
	// commit and ensure host retry can finish without reopening a dead identity.
	receipt["state"] = "pending"
	receipt["steps"].([]any)[5].(map[string]any)["state"] = "pending"
	receiptPath := filepath.Join(manager.dir, ".session-cleanup", second+".json")
	if err := os.WriteFile(receiptPath, rawJSON(receipt), 0600); err != nil {
		t.Fatal(err)
	}
	replay := call(map[string]any{"action": "session_delete", "id": second})
	if replay["cleanup"].(map[string]any)["state"] != "completed" {
		t.Fatal("deletion receipt not replayable", replay)
	}
	if _, err := os.Stat(record); !os.IsNotExist(err) {
		t.Fatal("session record still on disk", err)
	}
	view := call(map[string]any{"action": "contact", "id": id})
	if len(view["sessions"].([]any)) != 1 {
		t.Fatal("other session changed", view["sessions"])
	}
	// The contact remains usable without an automatically manufactured session.
	result := call(map[string]any{"action": "session_delete", "id": id})
	if result["replacement"] != nil {
		t.Fatal("deletion recreated a conversation", result)
	}
	view = call(map[string]any{"action": "contact", "id": id})
	if view["name"] != "小助手" || len(view["sessions"].([]any)) != 0 || view["model_id"] != "local-model" {
		t.Fatal("contact defaults lost", view)
	}
	fresh := call(map[string]any{"action": "session_create", "contact_id": id, "request_id": "s3"})["id"].(string)
	if fresh == id {
		t.Fatal("deleted context reused")
	}
	view = call(map[string]any{"action": "contact", "id": id})
	if len(view["sessions"].([]any)) != 1 {
		t.Fatal(view)
	}
}

func TestDeleteConversationCleanupFailureSurvivesRestart(t *testing.T) {
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { t.Error("deletion must not call a model") })
	h := NewWorkspaceHost(m.config, "", " ")
	t.Cleanup(func() { h.Close() })
	call := func(p map[string]any) map[string]any {
		t.Helper()
		v, err := h.conversationCall(context.Background(), rawJSON(p))
		if err != nil {
			t.Fatal(err)
		}
		var out map[string]any
		if err := json.Unmarshal(rawJSON(v), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	contact := call(map[string]any{"action": "contact_create", "request_id": "cleanup-contact", "model_id": "local-model", "name": "cleanup fixture"})
	id := contact["id"].(string)
	second := call(map[string]any{"action": "session_create", "contact_id": id, "request_id": "cleanup-second"})["id"].(string)
	manager, err := h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	record := filepath.Join(manager.dir, second+".json")
	archive := filepath.Join(manager.dir, "sessions", second+".jsonl")
	// A nonempty directory in place of the archive reliably injects a cleanup
	// failure on both Windows and Unix, without touching a user's files.
	if err := os.MkdirAll(archive, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(archive, "blocked"), []byte("private fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{filepath.Join(manager.dir, second+".shell"), filepath.Join(manager.dir, "results", second)} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "private.txt"), []byte("private fixture"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "session_delete", "id": second})); err == nil {
		t.Fatal("cleanup failure was reported as success")
	}
	data, err := os.ReadFile(record)
	if err != nil {
		t.Fatal("retry identity was lost", err)
	}
	var saved AgentRecord
	if json.Unmarshal(data, &saved) != nil || !saved.DeletionPending {
		t.Fatal("deletion intent was not persisted")
	}
	if _, err := manager.Send(manager.owner, second, "during-cleanup", "do not run"); err == nil || !strings.Contains(err.Error(), "删除") {
		t.Fatal("pending deletion allowed another turn", err)
	}
	h.Close()
	h = NewWorkspaceHost(m.config, "", " ")
	manager, err = h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Send(manager.owner, second, "after-restart", "do not run"); err == nil || !strings.Contains(err.Error(), "删除") {
		t.Fatal("restart discarded deletion intent", err)
	}
	view := call(map[string]any{"action": "contact", "id": id})
	if len(view["sessions"].([]any)) != 2 {
		t.Fatal("incomplete cleanup became invisible", view)
	}
	foundReceipt := false
	for _, row := range view["sessions"].([]any) {
		v := row.(map[string]any)
		if v["id"] == second {
			receipt, ok := v["cleanup"].(map[string]any)
			foundReceipt = ok && receipt["state"] == "failed" && len(receipt["steps"].([]any)) == 6
		}
	}
	if !foundReceipt {
		t.Fatal("restart lost per-resource cleanup receipt", view)
	}
	if err := os.RemoveAll(archive); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(archive, []byte("private history"), 0600); err != nil {
		t.Fatal(err)
	}
	call(map[string]any{"action": "session_delete", "id": second})
	for _, file := range []string{record, archive, filepath.Join(manager.dir, second+".shell"), filepath.Join(manager.dir, "results", second)} {
		if _, err := os.Stat(file); !os.IsNotExist(err) {
			t.Fatal("private sidecar survived", file, err)
		}
	}
	if _, err := os.Stat(filepath.Join(manager.dir, id+".json")); err != nil {
		t.Fatal("other session was removed", err)
	}
}

// Eyra 的独立会话：同一个内置联系人下多段，联系人列表能认出来。
func TestEyraIndependentSessions(t *testing.T) {
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { fixtureAnswer(w, "chat", "reply", nil) })
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	s.MatrixProfile = "local-model"
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	h := NewWorkspaceHost(m.config, "", " ")
	t.Cleanup(h.Close)
	create := func(request string) string {
		t.Helper()
		v, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "eyra_session", "request_id": request, "name": "Eyra"}))
		if err != nil {
			t.Fatal(err)
		}
		var row map[string]any
		if err := json.Unmarshal(rawJSON(v), &row); err != nil {
			t.Fatal(err)
		}
		return row["id"].(string)
	}
	first, second := create("e1"), create("e2")
	if first == "" || first == second {
		t.Fatal(first, second)
	}
	v, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contacts"}))
	if err != nil {
		t.Fatal(err)
	}
	var rows []map[string]any
	if err := json.Unmarshal(rawJSON(v), &rows); err != nil {
		t.Fatal(err)
	}
	rows = builtinContactViews(rows)
	if len(rows) != 3 || rows[0]["builtin"] != "eyra" || rows[0]["name"] != "Eyra" || len(rows[0]["sessions"].([]any)) != 2 {
		t.Fatal(string(rawJSON(rows)))
	}
}

func TestDeleteConversationWaitsForFinalization(t *testing.T) {
	m, _ := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("cleanup must not call a model") })
	h := NewWorkspaceHost(m.config, "", " ")
	t.Cleanup(h.Close)
	call := func(p map[string]any) map[string]any {
		t.Helper()
		v, err := h.conversationCall(context.Background(), rawJSON(p))
		if err != nil {
			t.Fatal(err)
		}
		var out map[string]any
		if err = json.Unmarshal(rawJSON(v), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	first := call(map[string]any{"action": "contact_create", "request_id": "finalization-contact", "model_id": "local-model", "name": "drain fixture"})
	second := call(map[string]any{"action": "session_create", "contact_id": first["id"], "request_id": "finalization-second"})["id"].(string)
	manager, err := h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	drain := make(chan struct{})
	t.Cleanup(func() {
		select {
		case <-drain:
		default:
			close(drain)
		}
	})
	manager.mu.Lock()
	manager.jobs[second].done = drain
	manager.jobs[second].record.State = "completed"
	manager.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err = h.conversationCall(ctx, rawJSON(map[string]any{"action": "session_delete", "id": second})); err == nil {
		t.Fatal("terminal state was mistaken for released writers")
	}
	if _, err = os.Stat(filepath.Join(manager.dir, second+".json")); err != nil {
		t.Fatal("record removed before final writer release", err)
	}
	close(drain)
	result := call(map[string]any{"action": "session_delete", "id": second})
	if result["cleanup"].(map[string]any)["state"] != "completed" {
		t.Fatal("cleanup did not resume after writer release", result)
	}
}
