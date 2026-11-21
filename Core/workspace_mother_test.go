// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMotherInterventionIsAttributedScopedAndAudited
// Impact: python -B scripts/code-atlas.py show Core/workspace_mother_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestMotherInterventionIsAttributedScopedAndAudited(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	var recipientCalls atomic.Int32
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, req *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(req.Body).Decode(&body)
		data := string(rawJSON(body))
		if strings.Contains(data, "INDEPENDENT-RECIPIENT") {
			recipientCalls.Add(1)
			if strings.Contains(data, "MOTHER-PRIVATE-HISTORY") || !strings.Contains(data, "母体介入") {
				t.Error("intervention lost attribution or copied mother's private history")
			}
			fixtureAnswer(rw, "recipient", "repaired", nil)
			return
		}
		close(entered)
		select {
		case <-release:
		case <-req.Context().Done():
			return
		}
		fixtureAnswer(rw, "mother", "done", nil)
	})
	h, home := openCoreLinkHome(t, m.config, dir)
	defer h.Close()
	defer once.Do(func() { close(release) })
	value, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_create", "request_id": "recipient", "name": "Eyra", "model_id": "local-model", "prompt_text": "INDEPENDENT-RECIPIENT"}))
	if err != nil {
		t.Fatal(err)
	}
	target := value.(map[string]any)["id"].(string)
	if _, err = home.Send("task", "MOTHER-PRIVATE-HISTORY"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("mother did not start")
	}
	home.mu.Lock()
	actor, scope := home.state.Roles[WorkspaceMatrix], home.coreLinkScopeLocked()
	archivePath := home.contextArchivePath(home.contextSessionLocked().Archive)
	home.mu.Unlock()
	cm, _ := h.conversationManager()
	compact := map[string]any{"kind": "conversation", "action": "compact", "id": target, "request_id": "compact-empty", "generation": 0, "reason": "整理会话上下文"}
	if _, err = home.manager.Call(context.Background(), actor, rawJSON(compact)); err == nil {
		t.Fatal("unbound caller acquired compaction authority")
	}
	pretender := context.WithValue(context.Background(), conversationLinkCallerKey{}, conversationLinkCaller{ID: target, Generation: 1})
	if _, err = cm.Call(pretender, target, rawJSON(compact)); err == nil {
		t.Fatal("contact named Eyra acquired compaction authority")
	}
	args := map[string]any{"kind": "conversation", "action": "send", "id": target, "request_id": "repair-once", "generation": 0, "reason": "核对委派失败并补充缺失事实", "message": "Repair the failed step using only the supplied fact."}
	if _, err = home.manager.Call(context.Background(), actor, rawJSON(args)); err == nil {
		t.Fatal("unbound caller acquired mother authority")
	}
	forged := context.WithValue(context.Background(), conversationLinkCallerKey{}, conversationLinkCaller{ID: target, Generation: 1})
	if _, err = cm.Call(forged, target, rawJSON(args)); err == nil {
		t.Fatal("contact named Eyra acquired mother authority")
	}
	ctx := context.WithValue(context.Background(), conversationLinkCallerKey{}, conversationLinkCaller{ID: actor, Generation: 1})
	result, err := home.manager.Call(ctx, actor, rawJSON(args))
	if err != nil {
		t.Fatal(err)
	}
	request := result.(map[string]any)
	if _, leaks := request["spec"]; leaks || strings.Contains(string(rawJSON(request)), "INDEPENDENT-RECIPIENT") {
		t.Fatal("intervention receipt imported target context")
	}
	requestGeneration := request["generation"].(int)
	finished, err := cm.Wait(context.Background(), cm.owner, target, 10000)
	if err != nil || finished.State != "completed" || recipientCalls.Load() != 1 {
		t.Fatal(finished.State, finished.Error, err)
	}
	if _, err = home.manager.Call(ctx, actor, rawJSON(args)); err != nil || recipientCalls.Load() != 1 {
		t.Fatal("intervention replayed instead of returning its receipt", err)
	}
	if origin := finished.TurnOrigins["repair-once"]; origin.Kind != "intervention" || origin.From != scope || origin.Scope != target {
		t.Fatal("lost operator attribution", origin)
	}
	if err = validateConversationLinkRecord(finished); err != nil {
		t.Fatal("intervention cannot reopen", err)
	}
	view, err := home.manager.Call(ctx, actor, rawJSON(map[string]any{"kind": "conversation", "action": "snapshot", "id": target}))
	if err != nil {
		t.Fatal(err)
	}
	for _, msg := range view.(map[string]any)["messages"].([]map[string]any) {
		if msg["id"] == "repair-once" && msg["from"] != "mother" {
			t.Fatal("intervention impersonated the user", msg)
		}
	}
	if err = cm.CancelGeneration(cm.owner, target, requestGeneration); err != nil {
		t.Fatal(err)
	}
	args["request_id"], args["generation"] = "after-user-stop", requestGeneration
	if _, err = home.manager.Call(ctx, actor, rawJSON(args)); err == nil || recipientCalls.Load() != 1 {
		t.Fatal("mother automatically restarted a stopped task")
	}
	data, err := os.ReadFile(archivePath)
	if err != nil || !strings.Contains(string(data), `"mother_action"`) || !strings.Contains(string(data), `"phase":"completed"`) || !strings.Contains(string(data), `"phase":"failed"`) {
		t.Fatal("audit was not retained in persistent history", err)
	}
	if _, err = (&SessionArchive{Path: archivePath}).read(); err != nil {
		t.Fatal("mother audit made the conversation impossible to reopen", err)
	}
}
