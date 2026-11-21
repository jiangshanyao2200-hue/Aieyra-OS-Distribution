// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestConversationGroupHostMentionsAndLazyBacklog; TestGroupMentionsPreferLongerNames
// Impact: python -B scripts/code-atlas.py show Core/conversation_groups_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

// Group chat: the host answers unaddressed user messages and @-points members;
// unaddressed members make no request, then receive the backlog lazily; replies
// land in the group; [PASS] stays silent; group sessions stay out of contacts.
func TestConversationGroupHostMentionsAndLazyBacklog(t *testing.T) {
	var mu sync.Mutex
	calls := map[string]int{}
	bodies := map[string]string{}
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		raw, _ := json.Marshal(body)
		text := string(raw)
		who := "host"
		switch {
		case strings.Contains(text, "persona-jia"):
			who = "jia"
		case strings.Contains(text, "persona-yi"):
			who = "yi"
		}
		mu.Lock()
		calls[who]++
		n := calls[who]
		bodies[who] = text
		mu.Unlock()
		switch {
		case who == "host":
			fixtureAnswer(w, "h", "@甲 你先说说看法", nil)
		case who == "jia" && n == 1:
			fixtureAnswer(w, "j1", "", []any{map[string]any{"type": "function_call", "id": "fc_g", "call_id": "call_g", "name": "group", "arguments": `{"action":"read","after":0}`}})
		case who == "jia":
			fixtureAnswer(w, "j2", "我建议琥珀色。", nil)
		default:
			fixtureAnswer(w, "y", groupPass, nil)
		}
	})
	h := NewWorkspaceHost(m.config, "", " ")
	t.Cleanup(h.Close)
	call := func(p map[string]any) any {
		t.Helper()
		v, err := h.conversationCall(context.Background(), rawJSON(p))
		if err != nil {
			t.Fatal(p["action"], err)
		}
		return v
	}
	jia := call(map[string]any{"action": "contact_create", "request_id": "c-jia", "model_id": "local-model", "name": "甲", "prompt_text": "persona-jia"}).(map[string]any)["id"].(string)
	yi := call(map[string]any{"action": "contact_create", "request_id": "c-yi", "model_id": "local-model", "name": "乙", "prompt_text": "persona-yi"}).(map[string]any)["id"].(string)
	g := call(map[string]any{"action": "group_create", "request_id": "g1", "name": "方案讨论", "members": []string{jia, yi}}).(map[string]any)
	id := g["id"].(string)
	if again := call(map[string]any{"action": "group_create", "request_id": "g1", "name": "方案讨论", "members": []string{jia, yi}}).(map[string]any); again["id"] != id {
		t.Fatal("retry created another group")
	}
	wait := func(want int) []groupMessage {
		t.Helper()
		deadline := time.Now().Add(8 * time.Second)
		for {
			v := call(map[string]any{"action": "group", "id": id}).(map[string]any)
			msgs := v["messages"].([]groupMessage)
			idle := true
			for _, member := range v["members"].([]map[string]any) {
				idle = idle && member["state"] == "idle"
			}
			if len(msgs) >= want && idle {
				return msgs
			}
			if time.Now().After(deadline) {
				t.Fatalf("group did not settle: %+v", v)
			}
			time.Sleep(40 * time.Millisecond)
		}
	}
	call(map[string]any{"action": "group_post", "id": id, "text": "我们讨论一下配色"})
	msgs := wait(4)
	if len(msgs) != 4 || msgs[1].From != "user" || msgs[2].From != groupHost || msgs[3].From != jia || msgs[3].Text != "我建议琥珀色。" || msgs[3].Kind != "result" {
		t.Fatalf("%+v", msgs)
	}
	if len(msgs[2].Mentions) != 1 || msgs[2].Mentions[0] != jia {
		t.Fatal("host mention not parsed", msgs[2])
	}
	mu.Lock()
	if calls["yi"] != 0 || calls["host"] != 1 || calls["jia"] != 2 {
		t.Fatal("unaddressed member made a request or counts wrong", calls)
	}
	mu.Unlock()
	call(map[string]any{"action": "group_post", "id": id, "text": "@乙 你同意吗"})
	msgs = wait(5)
	mu.Lock()
	yiBody := bodies["yi"]
	mu.Unlock()
	if !strings.Contains(yiBody, "我建议琥珀色。") || !strings.Contains(yiBody, "我们讨论一下配色") {
		t.Fatal("backlog not delivered lazily")
	}
	if len(msgs) != 5 {
		t.Fatalf("[PASS] was posted: %+v", msgs)
	}
	contacts := call(map[string]any{"action": "contacts"}).([]map[string]any)
	contacts = ordinaryContactViews(contacts)
	if len(contacts) != 2 {
		t.Fatal("group host listed as a contact", contacts)
	}
	for _, c := range contacts {
		if len(c["sessions"].([]map[string]any)) != 1 {
			t.Fatal("group session listed among private sessions", c)
		}
	}
	if rows := call(map[string]any{"action": "list"}).([]map[string]any); len(rows) != 2 {
		t.Fatal("group sessions on the rail", rows)
	}
	groups := call(map[string]any{"action": "groups"}).([]map[string]any)
	if len(groups) != 1 || groups[0]["last"].(map[string]any)["text"] != "@乙 你同意吗" || len(groups[0]["members"].([]map[string]any)) != 2 {
		t.Fatal(groups)
	}
	for _, bad := range []map[string]any{{"action": "group_create", "request_id": "g2", "name": "", "members": []string{jia}}, {"action": "group_create", "request_id": "g3", "name": "x", "members": []string{}}, {"action": "group_post", "id": id, "text": "  "}} {
		if _, err := h.conversationCall(context.Background(), rawJSON(bad)); err == nil {
			t.Fatal("accepted", bad)
		}
	}
	call(map[string]any{"action": "group_delete", "id": id})
	if _, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "group", "id": id})); err == nil {
		t.Fatal("deleted group still readable")
	}
}

func TestGroupMentionsPreferLongerNames(t *testing.T) {
	names := map[string]string{"a": "小橘", "b": "小橘猫", groupHost: "Eyra"}
	got := groupMentions("@小橘猫 和 @Eyra 看看", names, "")
	if strings.Join(got, ",") != "b,host" && strings.Join(got, ",") != "host,b" {
		t.Fatal(got)
	}
	if got := groupMentions("@小橘 自己", names, "a"); len(got) != 0 {
		t.Fatal("self mention", got)
	}
}
