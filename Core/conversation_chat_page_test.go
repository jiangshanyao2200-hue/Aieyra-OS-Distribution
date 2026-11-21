// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestChatPageGroupPagesBackwardsWithoutLossOrDuplicates
// Impact: python -B scripts/code-atlas.py show Core/conversation_chat_page_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"net/http"
	"slices"
	"strconv"
	"testing"
	"time"
)

// chat_page is the read-only history behind the unified side column: the newest
// rounds first, older pages on demand, until the whole record is reachable.
func TestChatPageGroupPagesBackwardsWithoutLossOrDuplicates(t *testing.T) {
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		fixtureAnswer(w, "h", "收到", nil)
	})
	h := NewWorkspaceHost(m.config, "", "")
	t.Cleanup(h.Close)
	call := func(p map[string]any) (any, error) {
		return h.conversationCall(context.Background(), rawJSON(p))
	}
	must := func(p map[string]any) map[string]any {
		t.Helper()
		v, err := call(p)
		if err != nil {
			t.Fatal(p["action"], err)
		}
		return v.(map[string]any)
	}
	jia := must(map[string]any{"action": "contact_create", "request_id": "c-jia", "model_id": "local-model", "name": "甲", "prompt_text": "persona-jia"})["id"].(string)
	id := must(map[string]any{"action": "group_create", "request_id": "g1", "name": "分页", "members": []string{jia}})["id"].(string)
	const total = 5
	for i := 1; i <= total; i++ {
		must(map[string]any{"action": "group_post", "id": id, "text": "第" + strconv.Itoa(i) + "条", "request_id": "p" + strconv.Itoa(i)})
		deadline := time.Now().Add(8 * time.Second)
		for {
			v := must(map[string]any{"action": "group", "id": id})
			idle := true
			for _, member := range v["members"].([]map[string]any) {
				idle = idle && member["state"] == "idle"
			}
			if len(v["messages"].([]groupMessage)) >= 1+2*i && idle {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("round %d did not settle: %+v", i, v)
			}
			time.Sleep(40 * time.Millisecond)
		}
	}
	page := func(before string) map[string]any {
		t.Helper()
		return must(map[string]any{"action": "chat_page", "id": id, "kind": "group", "before": before, "limit_rounds": 2})
	}
	first := page("")
	rounds := map[string]bool{}
	for _, e := range first["entries"].([]map[string]any) {
		rounds[e["round_id"].(string)] = true
	}
	if len(rounds) != 2 || first["has_more"] != true || first["before"] == "" || first["reset"] != false {
		t.Fatalf("first page should hold the two newest rounds and a cursor: %+v", first)
	}
	var pages [][]map[string]any
	cursor := ""
	for n := 0; ; n++ {
		if n > 10 {
			t.Fatal("paging never reached the oldest round")
		}
		p := page(cursor)
		if p["reset"] == true {
			t.Fatal("a cursor issued inside the same page chain was reset", p)
		}
		pages = append(pages, p["entries"].([]map[string]any))
		if p["has_more"] != true {
			break
		}
		cursor = p["before"].(string)
	}
	if len(pages) != 3 {
		t.Fatalf("five rounds at two per page should take three pages, got %d", len(pages))
	}
	var users []string
	seen := map[string]bool{}
	for i := len(pages) - 1; i >= 0; i-- {
		for _, e := range pages[i] {
			if seen[e["id"].(string)] {
				t.Fatal("entry repeated across pages", e)
			}
			seen[e["id"].(string)] = true
			if e["sender_id"] == "user" {
				users = append(users, e["text"].(string))
			}
		}
	}
	if want := []string{"第1条", "第2条", "第3条", "第4条", "第5条"}; !slices.Equal(users, want) {
		t.Fatalf("paged history lost or reordered messages: %v", users)
	}
	all := must(map[string]any{"action": "chat_page", "id": id, "kind": "group"})
	if all["has_more"] != false || len(all["entries"].([]map[string]any)) < 2*total {
		t.Fatalf("the default page is twenty rounds and must hold this whole short history: %+v", all)
	}
	for _, bad := range []map[string]any{
		{"action": "chat_page", "id": id, "kind": "group", "limit_rounds": 21},
		{"action": "chat_page", "id": id, "kind": "group", "limit_rounds": -1},
		{"action": "chat_page", "id": "../x", "kind": "group"},
		{"action": "chat_page", "id": id, "kind": "other"},
	} {
		if _, err := call(bad); err == nil {
			t.Fatal("invalid chat_page request was accepted", bad)
		}
	}
	for _, forged := range []map[string]any{
		{"action": "chat_page", "id": id, "kind": "group", "before": "!!!", "limit_rounds": 2},
		{"action": "chat_page", "id": id, "kind": "conversation", "before": first["before"], "limit_rounds": 2},
	} {
		v := must(forged)
		if v["reset"] != true || len(v["entries"].([]map[string]any)) != 0 {
			t.Fatalf("a forged or foreign cursor must reset without reading: %+v", v)
		}
	}
}
