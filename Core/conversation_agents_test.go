// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestConversationIdleIndependentHistoryAndRestart; TestConversationPromptCASAndInFlightSnapshot; TestConversationCannotAcquireExecutionCapabilities; TestConversationTextModelProjectionPreservesArchive; TestConversationRejectsUnadvertisedExecutionTool
// Impact: python -B scripts/code-atlas.py show Core/conversation_agents_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestConversationIdleIndependentHistoryAndRestart(t *testing.T) {
	var requests atomic.Int32
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		tools := body["tools"].([]any)
		if len(tools) != 4 {
			t.Errorf("tools=%v", tools)
		}
		for _, v := range tools {
			n := v.(map[string]any)["name"]
			if n != "web_search" && n != "view_image" && n != "core_link" && n != "memory" {
				t.Errorf("extra tool %v", n)
			}
		}
		n := requests.Add(1)
		text, _ := json.Marshal(body)
		if strings.Contains(string(text), "aieyra_shell_runtime") || strings.Contains(string(text), "matrix_child_contract") {
			t.Error("execution contract leaked")
		}
		if n == 2 && !strings.Contains(string(text), "first-answer") {
			t.Error("conversation context lost")
		}
		fixtureAnswer(w, "chat", "first-answer", nil)
	})
	h := NewWorkspaceHost(m.config, "", " ")
	t.Cleanup(h.Close)
	create := rawJSON(map[string]any{"action": "create", "request_id": "chat-create", "model_id": "local-model", "title": "聊天", "prompt": "independent-persona"})
	v, err := h.conversationCall(context.Background(), create)
	if err != nil {
		t.Fatal(err)
	}
	record := v.(AgentRecord)
	if record.State != "idle" || requests.Load() != 0 {
		t.Fatal("creation made a request", record.State)
	}
	cm, _ := h.conversationManager()
	for i, text := range []string{"hello", "continue"} {
		_, err = h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "send", "id": record.ID, "request_id": text, "message": text, "generation": i}))
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		record, err = cm.Wait(ctx, cm.owner, record.ID, 5000)
		cancel()
		if err != nil || record.State != "completed" {
			t.Fatal(record, err)
		}
	}
	v, err = cm.conversationSnapshot(record, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(v.(map[string]any)["messages"].([]map[string]any)) != 4 {
		t.Fatal("history missing", v)
	}
	record.TurnGenerations[record.Spec.RequestID] = 1
	rows, _, err := cm.conversationMessages(record, 0)
	if err != nil || len(rows) != 4 {
		t.Fatalf("creation alias changed the visible turn count: %d, %v", len(rows), err)
	}
	for _, row := range rows {
		if row["from"] == "user" && row["text"] == "" {
			t.Fatal("creation request projected as an empty user message")
		}
	}
	if len(m.List(m.owner)) != 0 {
		t.Fatal("conversation entered execution manager")
	}
	h.Close()
	h2 := NewWorkspaceHost(m.config, "", "")
	defer h2.Close()
	restored, _ := h2.conversationManager()
	saved, err := restored.Status(restored.owner, record.ID)
	if err != nil || saved.Result != "first-answer" || saved.Generation != 2 || requests.Load() != 2 {
		t.Fatal(saved, err)
	}
	if _, err = h2.conversationCall(context.Background(), create); err != nil {
		t.Fatal("idempotent create", err)
	}
}

func TestConversationPromptCASAndInFlightSnapshot(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var requests atomic.Int32
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		data, _ := json.Marshal(body)
		n := requests.Add(1)
		want := "original-prompt"
		if n > 1 {
			want = "updated-prompt"
		}
		if !strings.Contains(string(data), want) {
			t.Errorf("prompt snapshot missing %s", want)
		}
		if n == 1 {
			close(started)
			<-release
		}
		fixtureAnswer(w, "response", "ok", nil)
	})
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	v, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "create", "request_id": "create", "model_id": "local-model", "prompt": "original-prompt"}))
	if err != nil {
		t.Fatal(err)
	}
	r := v.(AgentRecord)
	cm, _ := h.conversationManager()
	_, err = cm.Send(cm.owner, r.ID, "one", "one")
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		close(release)
		t.Fatal("request not started")
	}
	prompt := "updated-prompt"
	_, err = cm.configureConversation(r.ID, 1, "", "", &prompt, conversationPromptHash("original-prompt"))
	if err != nil {
		close(release)
		t.Fatal(err)
	}
	close(release)
	r, err = cm.Wait(context.Background(), cm.owner, r.ID, 5000)
	if err != nil || r.State != "completed" {
		t.Fatal(r, err)
	}
	if _, err = cm.configureConversation(r.ID, 1, "", "", &prompt, conversationPromptHash(prompt)); err == nil {
		t.Fatal("stale revision accepted")
	}
	file, _ := childPromptFile(m.config, r.ID)
	if err = os.WriteFile(file, []byte("manual-edit"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = cm.configureConversation(r.ID, 2, "", "", &prompt, conversationPromptHash(prompt)); err == nil {
		t.Fatal("external edit overwritten")
	}
	if _, err = cm.configureConversation(r.ID, 2, "", "", &prompt, conversationPromptHash("manual-edit")); err != nil {
		t.Fatal(err)
	}
	if _, err = cm.Send(cm.owner, r.ID, "two", "two"); err != nil {
		t.Fatal(err)
	}
	r, err = cm.Wait(context.Background(), cm.owner, r.ID, 5000)
	if err != nil || r.State != "completed" {
		t.Fatal(r, err)
	}
}

func TestConversationCannotAcquireExecutionCapabilities(t *testing.T) {
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { t.Error("idle creation called provider") })
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	_, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "create", "request_id": "bad", "model_id": "local-model", "tools": []string{"settings"}}))
	if err == nil {
		t.Fatal("conversation gained shell")
	}
	h.SetTerminal()
	if _, err = h.conversationManager(); err == nil {
		t.Fatal("CLI enabled conversation host")
	}
}

func TestConversationTextModelProjectionPreservesArchive(t *testing.T) {
	images := []ImageAttachment{{Asset: "private/snapshot.png", SHA256: strings.Repeat("a", 64), MIME: "image/png"}}
	original := []Message{{Role: RoleUser, Content: "Images are supplied as image inputs.", Images: images}, {Role: RoleTool, ToolCallID: "image-call", Content: "observed", Images: images}}
	projected := conversationTextProjection(original)
	for i := range original {
		if len(original[i].Images) != 1 || len(projected[i].Images) != 0 || !strings.Contains(projected[i].Content, "private/snapshot.png") {
			t.Fatal("archive or projection damaged", original, projected)
		}
	}
	if projected[1].ToolCallID != "image-call" || original[0].Content != "Images are supplied as image inputs." {
		t.Fatal("protocol or archive changed")
	}
}

func TestConversationRejectsUnadvertisedExecutionTool(t *testing.T) {
	var requests atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if requests.Add(1) == 1 {
			fixtureAnswer(w, "bad", "", []any{map[string]any{"type": "function_call", "id": "bad-call", "call_id": "bad-call", "name": "exec_command", "arguments": `{"cmd":"echo unauthorized > forbidden.txt"}`}})
			return
		}
		data, _ := json.Marshal(body)
		if !strings.Contains(string(data), "tool_not_assigned") {
			t.Errorf("missing permission result: %s", data)
		}
		fixtureAnswer(w, "done", "只进行对话", nil)
	})
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	v, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "create", "request_id": "create-denied", "model_id": "local-model", "workdir": dir}))
	if err != nil {
		t.Fatal(err)
	}
	r := v.(AgentRecord)
	cm, _ := h.conversationManager()
	if _, err = cm.Send(cm.owner, r.ID, "denied", "hello"); err != nil {
		t.Fatal(err)
	}
	r, err = cm.Wait(context.Background(), cm.owner, r.ID, 5000)
	if err != nil || r.State != "failed" || !strings.Contains(r.Error, "tool_not_assigned") || requests.Load() != 1 {
		t.Fatal(r.State, r.Error, err)
	}
	if _, err = os.Stat(dir + "/forbidden.txt"); !os.IsNotExist(err) {
		t.Fatal("unadvertised shell executed")
	}
}
