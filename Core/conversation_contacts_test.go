// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: testAvatarURL; TestBuiltinContactCannotDeleteOrConfigureModelThroughSession; TestConversationContactsSessionsSharedPromptAndArchive; TestConversationContactWorkTools; ordinaryContactViews; builtinContactViews; TestIdleContactOrderRemainsStableAcrossPolling; TestConversationListTiesUsePersistentIdentity
// Impact: python -B scripts/code-atlas.py show Core/conversation_contacts_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

func testAvatarURL(t *testing.T) string {
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 8, 8))); err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(b.Bytes())
}

// Exercise both contact and direct-session APIs: hiding the model selector in
// the renderer alone must not let an old client edit a builtin's model.
func TestBuiltinContactCannotDeleteOrConfigureModelThroughSession(t *testing.T) {
	for _, builtin := range []string{"eyra", "cota", "vaya"} {
		t.Run(builtin, func(t *testing.T) {
			m, _ := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("editing a contact started a model") })
			h := NewWorkspaceHost(m.config, "", "")
			t.Cleanup(h.Close)
			ctx := context.Background()
			created, err := h.conversationCall(ctx, rawJSON(map[string]any{"action": "contact_create", "request_id": "builtin-fixture", "model_id": "local-model", "name": "自定义显示名", "prompt_text": "private role text"}))
			if err != nil {
				t.Fatal(err)
			}
			id := created.(map[string]any)["id"].(string)
			cm, _ := h.conversationManager()
			c, err := cm.readContact(id)
			if err != nil {
				t.Fatal(err)
			}
			c.Builtin = builtin
			if err = cm.writeContact(c); err != nil {
				t.Fatal(err)
			}
			before, err := cm.Status(cm.owner, id)
			if err != nil {
				t.Fatal(err)
			}
			for _, request := range []map[string]any{
				{"action": "contact_delete", "id": id},
				{"action": "contact_update", "id": id, "model_id": "local-model", "name": "不可部分保存"},
				{"action": "contact_update", "id": id, "model_parameters": map[string]any{"reasoning_effort": "high"}},
				{"action": "configure", "id": id, "revision": before.ConversationRevision, "model_id": "local-model"},
			} {
				if _, err = h.conversationCall(ctx, rawJSON(request)); err == nil {
					t.Fatalf("accepted builtin mutation: %s", request["action"])
				}
			}
			after, err := cm.Status(cm.owner, id)
			if err != nil || before.ConversationRevision != after.ConversationRevision || before.Spec.ModelID != after.Spec.ModelID {
				t.Fatal("rejected edit changed the session", err)
			}
			c, err = cm.readContact(id)
			if err != nil || c.Deleted || c.Name != "自定义显示名" {
				t.Fatal("rejected edit changed the contact", err)
			}
			if _, err = h.conversationCall(ctx, rawJSON(map[string]any{"action": "contact_update", "id": id, "name": "可编辑名字", "prompt_text": "updated role text", "prompt_hash": conversationPromptHash("private role text")})); err == nil {
				t.Fatal("builtin accepted a second editable profile store")
			}
		})
	}
}

// Contacts: one identity, several sessions sharing its prompt but not context;
// rename and model follow every session; delete archives and refuses new turns.
func TestConversationContactsSessionsSharedPromptAndArchive(t *testing.T) {
	var mu sync.Mutex
	bodies := []string{}
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		text, _ := json.Marshal(body)
		mu.Lock()
		bodies = append(bodies, string(text))
		mu.Unlock()
		fixtureAnswer(w, "chat", "reply", nil)
	})
	h := NewWorkspaceHost(m.config, "", " ")
	t.Cleanup(h.Close)
	call := func(ctx context.Context, p map[string]any) any {
		t.Helper()
		v, err := h.conversationCall(ctx, rawJSON(p))
		if err != nil {
			t.Fatal(p["action"], err)
		}
		return v
	}
	created := call(context.Background(), map[string]any{"action": "contact_create", "request_id": "c1", "model_id": "local-model", "name": "  小橘 ", "description": "爱聊天", "prompt_text": "persona-orange", "avatar": testAvatarURL(t)}).(map[string]any)
	id := created["id"].(string)
	if created["name"] != "小橘" || created["created_by"] != "user" || created["avatar_rev"] != 1 || len(created["sessions"].([]map[string]any)) != 1 {
		t.Fatal(created)
	}
	if again := call(context.Background(), map[string]any{"action": "contact_create", "request_id": "c1", "model_id": "local-model", "name": "  小橘 ", "description": "爱聊天", "prompt_text": "persona-orange", "avatar": testAvatarURL(t)}).(map[string]any); again["id"] != id {
		t.Fatal("retry created another contact", again)
	}
	if a := call(context.Background(), map[string]any{"action": "contact_avatar", "id": id}).(map[string]any); !strings.HasPrefix(a["avatar"].(string), "data:image/png;base64,") {
		t.Fatal(a)
	}
	second := call(context.Background(), map[string]any{"action": "session_create", "contact_id": id, "request_id": "s2"}).(map[string]any)
	sid := second["id"].(string)
	if sid == id || second["contact_id"] != id {
		t.Fatal(second)
	}
	if a := call(context.Background(), map[string]any{"action": "contact_avatar", "id": sid}).(map[string]any); a["avatar_rev"] != 1 {
		t.Fatal("session id did not resolve to its contact", a)
	}
	if st := call(context.Background(), map[string]any{"action": "settings", "id": sid}).(map[string]any); st["contact"].(map[string]any)["id"] != id {
		t.Fatal(st["contact"])
	}
	cm, _ := h.conversationManager()
	send := func(session, request string, generation int) {
		t.Helper()
		call(context.Background(), map[string]any{"action": "send", "id": session, "request_id": request, "message": request, "generation": generation})
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if r, err := cm.Wait(ctx, cm.owner, session, 5000); err != nil || r.State != "completed" {
			t.Fatal(r.State, err)
		}
	}
	send(sid, "hello-second", 0)
	if !strings.Contains(bodies[0], "persona-orange") {
		t.Fatal("second session lost the contact prompt")
	}
	detail := call(context.Background(), map[string]any{"action": "contact", "id": id}).(map[string]any)
	name, desc := "大橘", ""
	call(context.Background(), map[string]any{"action": "contact_update", "id": id, "name": name, "description": desc, "prompt_text": "persona-big", "prompt_hash": detail["prompt_hash"], "avatar": ""})
	send(id, "hello-first", 0)
	if !strings.Contains(bodies[1], "persona-big") || strings.Contains(bodies[1], "hello-second") {
		t.Fatal("prompt not shared or context leaked between sessions")
	}
	if _, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_update", "id": id, "prompt_text": "x", "prompt_hash": "stale"})); err == nil {
		t.Fatal("stale prompt hash accepted")
	}
	contacts := call(context.Background(), map[string]any{"action": "contacts"}).([]map[string]any)
	contacts = ordinaryContactViews(contacts)
	if len(contacts) != 1 || contacts[0]["name"] != "大橘" || contacts[0]["description"] != "" || contacts[0]["avatar_rev"] != 0 || len(contacts[0]["sessions"].([]map[string]any)) != 2 {
		t.Fatal(contacts)
	}
	for _, row := range call(context.Background(), map[string]any{"action": "list"}).([]map[string]any) {
		if row["title"] != "大橘" || row["contact_id"] != id {
			t.Fatal("rename did not reach every session", row)
		}
	}
	if last := contacts[0]["sessions"].([]map[string]any)[0]["last"].(map[string]any); last["text"] != "reply" {
		t.Fatal(last)
	}
	// Eyra-created contacts are marked; legacy plain create still lists as a contact.
	eyra := call(context.WithValue(context.Background(), conversationCallerKey{}, "eyra"), map[string]any{"action": "create", "request_id": "e1", "model_id": "local-model", "title": "研究员"}).(AgentRecord)
	contacts = call(context.Background(), map[string]any{"action": "contacts"}).([]map[string]any)
	found := false
	for _, c := range contacts {
		found = found || c["id"] == eyra.ID && c["created_by"] == "eyra" && c["name"] == "研究员"
	}
	if !found {
		t.Fatal(contacts)
	}
	call(context.Background(), map[string]any{"action": "contact_delete", "id": id})
	for _, c := range call(context.Background(), map[string]any{"action": "contacts"}).([]map[string]any) {
		if c["id"] == id {
			t.Fatal("deleted contact still listed")
		}
	}
	for _, row := range call(context.Background(), map[string]any{"action": "list"}).([]map[string]any) {
		if row["contact_id"] == id {
			t.Fatal("deleted contact still on the rail")
		}
	}
	if _, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "send", "id": sid, "request_id": "late", "message": "late", "generation": 1})); err == nil {
		t.Fatal("deleted contact accepted a turn")
	}
	if _, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "snapshot", "id": sid})); err != nil {
		t.Fatal("archived history unreadable", err)
	}
	for _, bad := range []map[string]any{
		{"action": "contact_create", "request_id": "b1", "model_id": "local-model", "description": strings.Repeat("长", 1001)},
		{"action": "contact_create", "request_id": "b2", "model_id": "local-model", "name": "x", "avatar": "data:image/gif;base64,AAAA"},
		{"action": "contact_create", "request_id": "b3", "model_id": "local-model", "name": strings.Repeat("长", 121)},
		{"action": "session_create", "contact_id": id, "request_id": "b4"},
	} {
		if _, err := h.conversationCall(context.Background(), rawJSON(bad)); err == nil {
			t.Fatal("accepted", bad)
		}
	}
}

// Working contacts get exactly their assigned tools on top of search and vision;
// removing them returns the contact to the plain chat pair.
func TestConversationContactWorkTools(t *testing.T) {
	var mu sync.Mutex
	var last []string
	var system string
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		names := []string{}
		for _, v := range body["tools"].([]any) {
			names = append(names, v.(map[string]any)["name"].(string))
		}
		text, _ := json.Marshal(body)
		mu.Lock()
		last, system = names, string(text)
		mu.Unlock()
		fixtureAnswer(w, "chat", "ok", nil)
	})
	h := NewWorkspaceHost(m.config, "", " ")
	t.Cleanup(h.Close)
	cm, _ := h.conversationManager()
	run := func(id, request string, generation int) []string {
		t.Helper()
		if _, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "send", "id": id, "request_id": request, "message": request, "generation": generation})); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if r, err := cm.Wait(ctx, cm.owner, id, 5000); err != nil || r.State != "completed" {
			t.Fatal(r.State, r.Error, err)
		}
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), last...)
	}
	if _, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_create", "request_id": "bad", "model_id": "local-model", "name": "越权", "tools": []string{"settings"}})); err == nil {
		t.Fatal("global settings tool accepted for a contact")
	}
	v, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_create", "request_id": "w1", "model_id": "local-model", "name": "工匠", "tools": []string{"terminal", "apply_patch"}}))
	if err != nil {
		t.Fatal(err)
	}
	c := v.(map[string]any)
	id := c["id"].(string)
	if c["works"] != true || strings.Join(c["tools"].([]string), ",") != "agents,apply_patch,memory,terminal,view_image,web_search" {
		t.Fatal(c)
	}
	names := strings.Join(run(id, "work", 0), ",")
	if !strings.HasPrefix(names, "web_search,view_image,") || !strings.Contains(names, "terminal") || !strings.Contains(names, "apply_patch") || !strings.Contains(names, "core_link") || strings.Contains(names, "toolbox") {
		t.Fatal("work tools", names)
	}
	if !strings.Contains(system, "当前实例配置了工作工具") {
		t.Fatal("working contact missing its runtime notes")
	}
	empty := []string{}
	if _, err = h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_update", "id": id, "tools": empty})); err != nil {
		t.Fatal(err)
	}
	if names = strings.Join(run(id, "chat", 1), ","); names != "web_search,view_image,memory,core_link" {
		t.Fatal("tools not removed", names)
	}
	if strings.Contains(system, "当前实例配置了工作工具") {
		t.Fatal("chat contact still sees the shell runtime")
	}
}

func ordinaryContactViews(rows []map[string]any) []map[string]any {
	out := []map[string]any{}
	for _, row := range rows {
		if row["builtin"] == "" && row["embedded"] != true && row["program"] == "" {
			out = append(out, row)
		}
	}
	return out
}

func builtinContactViews(rows []map[string]any) []map[string]any {
	out := []map[string]any{}
	for _, row := range rows {
		if row["builtin"] != "" {
			out = append(out, row)
		}
	}
	return out
}

// Empty activity is normal for bundled contacts before their first conversation.
// Repeated polls must not reshuffle these identities as Go iterates its maps.
func TestIdleContactOrderRemainsStableAcrossPolling(t *testing.T) {
	m, _ := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("contact polling called a model") })
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	var originalIDs []string
	for poll := 0; poll < 32; poll++ {
		value, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contacts"}))
		if err != nil {
			t.Fatal(err)
		}
		all := value.([]map[string]any)
		for i, row := range all {
			id := row["id"].(string)
			if poll == 0 {
				originalIDs = append(originalIDs, id)
			} else if i >= len(originalIDs) || originalIDs[i] != id {
				t.Fatalf("poll %d changed persistent identity order at %d", poll, i)
			}
		}
		if len(all) != len(originalIDs) {
			t.Fatal("contact catalogue changed during read-only polling")
		}
		rows := builtinContactViews(all)
		if len(rows) != 3 {
			t.Fatalf("unexpected contacts: %d", len(rows))
		}
		for i, want := range []string{"eyra", "cota", "vaya"} {
			if rows[i]["builtin"] != want {
				t.Fatalf("poll %d position %d: got %v, want %s", poll, i, rows[i]["builtin"], want)
			}
		}
	}
}

func TestConversationListTiesUsePersistentIdentity(t *testing.T) {
	a := map[string]any{"id": "a", "activity": "2026-11-11T02:00:00Z"}
	b := map[string]any{"id": "b", "activity": "2026-11-11T02:00:00Z"}
	if !conversationListLess(a, b) || conversationListLess(b, a) || conversationListLess(a, a) {
		t.Fatal("equal timestamps are not ordered by identity")
	}
	b["activity"] = "2026-11-11T02:00:01Z"
	if conversationListLess(a, b) || !conversationListLess(b, a) {
		t.Fatal("recent activity no longer sorts first")
	}
}
