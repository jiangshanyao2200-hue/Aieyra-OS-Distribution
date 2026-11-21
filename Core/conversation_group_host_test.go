// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestGroupHostChangeKeepsInstancesAndCommittedRouting
// Impact: python -B scripts/code-atlas.py show Core/conversation_group_host_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestGroupHostChangeKeepsInstancesAndCommittedRouting(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	f := newGroupFixture(t, func(who string, n int) string {
		if who == "host" && n == 1 {
			close(entered)
			<-release
		}
		return groupPass
	})
	defer once.Do(func() { close(release) })
	jia := f.must(map[string]any{"action": "contact_create", "request_id": "jia", "model_id": "local-model", "name": "甲", "prompt_text": "persona-jia"})["id"].(string)
	yi := f.must(map[string]any{"action": "contact_create", "request_id": "yi", "model_id": "local-model", "name": "乙", "prompt_text": "persona-yi"})["id"].(string)
	gid := f.must(map[string]any{"action": "group_create", "request_id": "group", "name": "handoff", "members": []string{jia, yi}, "host_contact": jia})["id"].(string)
	first := map[string]any{"action": "group_post", "id": gid, "request_id": "first", "text": "first request"}
	f.must(first)
	f.settle(gid)
	conversationGroupsMu.Lock()
	g, err := f.m.readGroup(gid)
	if err != nil {
		conversationGroupsMu.Unlock()
		t.Fatal(err)
	}
	initial, replacement := g.Host.Session, g.member(yi).Session
	r, _ := f.m.Status(f.m.owner, initial)
	_, err = f.m.linkRoom(r)
	conversationGroupsMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	patch := map[string]any{"action": "group_update", "id": gid, "host_contact": yi, "expected_host_contact": jia, "members": []string{jia, yi}}
	view := f.must(patch)
	if view["host_contact"] != yi || view["host_name"] != "乙" || view["initial_host_contact"] != jia {
		t.Fatal("host projection is inconsistent", view)
	}
	f.must(patch) // same successful update is retryable
	conversationGroupsMu.Lock()
	g, err = f.m.readGroup(gid)
	link, linkErr := f.m.readGroup(linkLogID(gid))
	conversationGroupsMu.Unlock()
	if err != nil || linkErr != nil || g.Host.Session != initial || g.member(yi).Session != replacement || link.Host.Session != replacement {
		t.Fatal("host handoff replaced a private context or left stale Link authority", err, linkErr)
	}
	// The original committed user request retains its recipient after handoff.
	f.must(first)
	f.settle(gid)
	f.mu.Lock()
	beforeJia, beforeYi := len(f.body["jia"]), len(f.body["host"])
	f.mu.Unlock()
	if beforeJia != 1 || beforeYi != 0 {
		t.Fatal("replayed request changed recipient", beforeJia, beforeYi)
	}
	f.must(map[string]any{"action": "group_post", "id": gid, "request_id": "second", "text": "second request"})
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("new coordinator did not receive unaddressed user message")
	}
	if _, err = f.call(map[string]any{"action": "group_update", "id": gid, "host_contact": jia, "expected_host_contact": yi}); err == nil {
		t.Fatal("host changed during active work")
	}
	once.Do(func() { close(release) })
	f.settle(gid)
	f.must(map[string]any{"action": "group_post", "id": gid, "request_id": "mention", "text": "@主持 check this"})
	f.settle(gid)
	f.mu.Lock()
	jCalls, yCalls := len(f.body["jia"]), len(f.body["host"])
	f.mu.Unlock()
	if jCalls != 1 || yCalls != 2 {
		t.Fatal("host mention used obsolete identity", jCalls, yCalls)
	}
	if _, err = f.call(map[string]any{"action": "group_update", "id": gid, "host_contact": jia, "expected_host_contact": jia}); err == nil {
		t.Fatal("stale host update was accepted")
	}
	// Private contact sessions were never used by either coordinator.
	for _, id := range []string{jia, yi} {
		r, e := f.m.Status(f.m.owner, id)
		if e != nil || r.Generation != 0 {
			t.Fatal("handoff borrowed a private chat", e)
		}
	}
	config := f.m.config
	f.h.Close()
	h := NewWorkspaceHost(config, "", "")
	defer h.Close()
	value, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "group", "id": gid}))
	if err != nil || value.(map[string]any)["host_contact"] != yi {
		t.Fatal("host assignment did not survive restart", err)
	}
}
