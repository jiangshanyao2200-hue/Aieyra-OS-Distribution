// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: sessionExperienceCall; sessionExperienceModels; TestSessionModelIsLocalDurableAndUsedByActualRequest; TestConversationGreetingOnceAndRapidCreationUsesLocal; TestConversationUsageAggregatesScopeWithoutSiblingOrPrivateText; TestConversationGreetingStopsOnUserBoundary; TestConversationEmptyContactSurvivesRestart
// Impact: python -B scripts/code-atlas.py show Core/conversation_session_experience_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func sessionExperienceCall(t *testing.T, h *WorkspaceHost, p map[string]any) map[string]any {
	t.Helper()
	v, e := h.conversationCall(context.Background(), rawJSON(p))
	if e != nil {
		t.Fatal(p["action"], e)
	}
	var out map[string]any
	if e = json.Unmarshal(rawJSON(v), &out); e != nil {
		t.Fatal(e)
	}
	return out
}

func sessionExperienceModels(t *testing.T, m *AgentManager) {
	t.Helper()
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	s.MatrixProfile = "local-model"
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
}

func TestSessionModelIsLocalDurableAndUsedByActualRequest(t *testing.T) {
	var called atomic.Int32
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if body["model"] != "session-model" {
			t.Errorf("wrong model: %v", body["model"])
		}
		called.Add(1)
		fixtureAnswer(w, "session-model", "done", nil)
	})
	sessionExperienceModels(t, m)
	s, e := Load(m.config)
	if e != nil {
		t.Fatal(e)
	}
	p := s.APIProfiles[0]
	p.ID = "session-choice"
	p.Model = "session-model"
	s.APIProfiles = append(s.APIProfiles, p)
	if e = s.Save(); e != nil {
		t.Fatal(e)
	}
	h := NewWorkspaceHost(m.config, "", "")
	defer func() { h.Close() }()
	create := func(request string) map[string]any {
		return sessionExperienceCall(t, h, map[string]any{"action": "session_create", "contact_id": builtinContactID("eyra"), "request_id": request})
	}
	first, second := create("first"), create("second")
	id := first["id"].(string)
	sessionExperienceCall(t, h, map[string]any{"action": "session_model", "id": id, "revision": first["revision"], "model_id": p.ID})
	if _, e = h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "session_model", "id": id, "revision": first["revision"], "model_id": "local-model"})); e == nil {
		t.Fatal("stale model choice accepted")
	}
	settings := sessionExperienceCall(t, h, map[string]any{"action": "settings", "id": second["id"]})
	if settings["agent"].(map[string]any)["model_id"] == p.ID {
		t.Fatal("sibling changed")
	}
	contact := sessionExperienceCall(t, h, map[string]any{"action": "contact", "id": builtinContactID("eyra")})
	if contact["model_id"] == p.ID {
		t.Fatal("role default changed")
	}
	h.Close()
	h = NewWorkspaceHost(m.config, "", "")
	sessionExperienceCall(t, h, map[string]any{"action": "send", "id": id, "request_id": "work", "message": "verify session model"})
	cm, _ := h.conversationManager()
	row, e := cm.Wait(context.Background(), cm.owner, id, 10000)
	if e != nil || row.State != "completed" || called.Load() != 1 {
		t.Fatal(row.State, called.Load(), e)
	}
	sessionExperienceCall(t, h, map[string]any{"action": "session_delete", "id": id})
	sessionExperienceCall(t, h, map[string]any{"action": "session_delete", "id": second["id"]})
	contact = sessionExperienceCall(t, h, map[string]any{"action": "contact", "id": builtinContactID("eyra")})
	if len(contact["sessions"].([]any)) != 0 {
		t.Fatal("deleted builtin session recreated")
	}
}

func TestConversationGreetingOnceAndRapidCreationUsesLocal(t *testing.T) {
	var calls atomic.Int32
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if tools, ok := body["tools"].([]any); ok && len(tools) > 0 {
			t.Error("greeting has tools")
		}
		calls.Add(1)
		fixtureAnswer(w, "hello", "你好，准备好了。", nil)
	})
	sessionExperienceModels(t, m)
	h := NewWorkspaceHost(m.config, "", "")
	defer func() { h.Close() }()
	create := func(request string) string {
		return sessionExperienceCall(t, h, map[string]any{"action": "session_create", "contact_id": builtinContactID("eyra"), "request_id": request})["id"].(string)
	}
	first := create("g1")
	g := sessionExperienceCall(t, h, map[string]any{"action": "greet", "id": first})
	if g["state"] != "online" {
		t.Fatal(g)
	}
	sessionExperienceCall(t, h, map[string]any{"action": "greet", "id": first})
	second := create("g2")
	g = sessionExperienceCall(t, h, map[string]any{"action": "greet", "id": second})
	if g["state"] != "local" || !strings.Contains(g["text"].(string), "Eyra") {
		t.Fatal(g)
	}
	cm, _ := h.conversationManager()
	row, _ := cm.Status(cm.owner, first)
	if row.Generation != 0 || len(row.Usage) != 1 || calls.Load() != 1 {
		t.Fatal(row.Generation, len(row.Usage), calls.Load())
	}
	h.Close()
	h = NewWorkspaceHost(m.config, "", "")
	sessionExperienceCall(t, h, map[string]any{"action": "greet", "id": first})
	if calls.Load() != 1 {
		t.Fatal("greeting replayed after reopening")
	}
}

func TestConversationUsageAggregatesScopeWithoutSiblingOrPrivateText(t *testing.T) {
	m, _ := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("usage query executes model") })
	sessionExperienceModels(t, m)
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	ids := []string{}
	for _, request := range []string{"root", "member", "nested", "sibling"} {
		ids = append(ids, sessionExperienceCall(t, h, map[string]any{"action": "session_create", "contact_id": builtinContactID("eyra"), "request_id": request})["id"].(string))
	}
	cm, _ := h.conversationManager()
	cm.mu.Lock()
	for i, id := range ids {
		j := cm.jobs[id]
		j.record.Usage = []AgentUsage{{Input: 10 * (i + 1), Output: i + 1, Reported: true}}
		j.record.Spec.Prompt = "private sentinel"
		if i == 1 || i == 2 {
			j.record.Link = &conversationLinkBinding{Scope: ids[0], Parent: ids[i-1]}
		}
	}
	cm.mu.Unlock()
	value := cm.conversationUsage(ids[0], false)
	sessions := value["sessions"].([]map[string]any)
	if len(sessions) != 1 || len(sessions[0]["roles"].([]map[string]any)) != 3 || sessions[0]["usage"].(map[string]any)["input_tokens"] != 60 {
		t.Fatal(value)
	}
	if strings.Contains(string(rawJSON(value)), "private sentinel") {
		t.Fatal("usage exposed prompt")
	}
	if len(cm.conversationUsage("", true)["sessions"].([]map[string]any)) != 2 {
		t.Fatal("scope grouping lost")
	}
}

func TestConversationGreetingStopsOnUserBoundary(t *testing.T) {
	for _, boundary := range []string{"send", "cancel", "delete", "close"} {
		t.Run(boundary, func(t *testing.T) {
			started := make(chan struct{})
			var calls atomic.Int32
			m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				if calls.Add(1) == 1 {
					close(started)
					select {
					case <-r.Context().Done():
					case <-time.After(5 * time.Second):
						t.Error("greeting was not cancelled")
					}
					fixtureAnswer(w, "late", "迟到的招呼", nil)
					return
				}
				fixtureAnswer(w, "work", "用户任务完成", nil)
			})
			sessionExperienceModels(t, m)
			h := NewWorkspaceHost(m.config, "", "")
			defer h.Close()
			id := sessionExperienceCall(t, h, map[string]any{"action": "session_create", "contact_id": builtinContactID("eyra"), "request_id": "greeting-boundary"})["id"].(string)
			cm, _ := h.conversationManager()
			finished := make(chan error, 1)
			go func() { _, err := cm.greetConversation(context.Background(), id); finished <- err }()
			select {
			case <-started:
			case <-time.After(5 * time.Second):
				t.Fatal("greeting not started")
			}
			switch boundary {
			case "send":
				sessionExperienceCall(t, h, map[string]any{"action": "send", "id": id, "message": "do work", "request_id": "work"})
			case "cancel":
				if err := cm.Cancel(cm.owner, id); err != nil {
					t.Fatal(err)
				}
			case "delete":
				sessionExperienceCall(t, h, map[string]any{"action": "session_delete", "id": id})
			case "close":
				h.Close()
			}
			select {
			case err := <-finished:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("greeting did not finish")
			}
			if boundary == "delete" {
				if _, err := os.Stat(filepath.Join(cm.dir, id+".json")); !os.IsNotExist(err) {
					t.Fatal("late greeting recreated deleted session", err)
				}
				return
			}
			r, err := cm.Status(cm.owner, id)
			if err != nil || r.Greeting == nil || r.Greeting.State != "local" {
				t.Fatal(r.Greeting, err)
			}
			if boundary == "send" {
				r, err = cm.Wait(context.Background(), cm.owner, id, 5000)
				if err != nil || r.State != "completed" || r.Result != "用户任务完成" {
					t.Fatal(r.State, r.Result, err)
				}
			}
		})
	}
}

func TestConversationEmptyContactSurvivesRestart(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("contact operation executes model") })
	h := NewWorkspaceHost(m.config, "", "")
	defer func() { h.Close() }()
	c := sessionExperienceCall(t, h, map[string]any{"action": "contact_create", "name": "保留联系人", "request_id": "empty-contact", "model_id": "local-model", "workdir": dir, "prompt_text": "保留提示词", "tools": []string{"update_plan"}})
	id := c["id"].(string)
	sessionExperienceCall(t, h, map[string]any{"action": "session_delete", "id": id})
	h.Close()
	h = NewWorkspaceHost(m.config, "", "")
	c = sessionExperienceCall(t, h, map[string]any{"action": "contact", "id": id})
	if len(c["sessions"].([]any)) != 0 || c["prompt"] != "保留提示词" || c["model_id"] != "local-model" {
		t.Fatal(c)
	}
	fresh := sessionExperienceCall(t, h, map[string]any{"action": "session_create", "contact_id": id, "request_id": "recreated"})
	if fresh["id"] == id || fresh["model_id"] != "local-model" {
		t.Fatal(fresh)
	}
}
