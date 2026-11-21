// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestConversationDefaultModelFollowsMotherAndKeepsSessionOverride; TestGroupInheritedModelCreateAddHandoffAndActualSend
// Impact: python -B scripts/code-atlas.py show Core/conversation_defaults_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

func TestConversationDefaultModelFollowsMotherAndKeepsSessionOverride(t *testing.T) {
	m, _ := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("configuration must not execute") })
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	s.ActiveProfile, s.MatrixProfile = "", ""
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	call := func(p map[string]any) map[string]any {
		t.Helper()
		v, e := h.conversationCall(context.Background(), rawJSON(p))
		if e != nil {
			t.Fatal(e)
		}
		return v.(map[string]any)
	}
	created := call(map[string]any{"action": "contact_create", "request_id": "inherit-default"})
	id := created["id"].(string)
	if created["model_inherited"] != true || created["model_id"] != "" {
		t.Fatal(created)
	}
	cm, _ := h.conversationManager()
	r, _ := cm.Status(cm.owner, id)
	if r.State != "idle" {
		t.Fatal("creating without model is not idle", r.State)
	}
	if _, err = cm.resolveConversationSpec(r); err == nil {
		t.Fatal("missing model resolved")
	}
	s.ActiveProfile = "local-model"
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	resolved, err := cm.resolveConversationSpec(r)
	if err != nil || resolved.ModelID != "local-model" {
		t.Fatal(resolved.ModelID, err)
	}
	// A previous turn freezes its resolved model in the record; defaults must
	// still be authoritative on the following turn.
	r.Spec.ModelID = "previous-model"
	resolved, err = cm.resolveConversationSpec(r)
	if err != nil || resolved.ModelID != "local-model" {
		t.Fatal(resolved.ModelID, err)
	}
	call(map[string]any{"action": "contact_update", "id": id, "model_id": "local-model"})
	if _, err = cm.configureSessionModel(id, r.ConversationRevision+1, "local-model"); err != nil {
		t.Fatal(err)
	}
	call(map[string]any{"action": "contact_update", "id": id, "model_unconfigured": true})
	r, _ = cm.Status(cm.owner, id)
	if r.ConversationModel != "local-model" {
		t.Fatal("profile change removed session override", r.ConversationModel)
	}
	s.ActiveProfile = ""
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	resolved, err = cm.resolveConversationSpec(r)
	if err != nil || resolved.ModelID != "local-model" {
		t.Fatal("explicit session override depends on mother's configuration", err)
	}
	c, _ := cm.readContact(id)
	if c.Defaults.ModelID != "" {
		t.Fatal("follow persisted a model ID")
	}
}

func TestGroupInheritedModelCreateAddHandoffAndActualSend(t *testing.T) {
	f := newGroupFixture(t, nil)
	create := func(name string) string {
		return f.must(map[string]any{"action": "contact_create", "request_id": name, "name": name})["id"].(string)
	}
	first, second := create("继承甲"), create("继承乙")
	gid := f.must(map[string]any{"action": "group_create", "request_id": "inherited-group", "name": "继承模型群", "members": []string{first, builtinContactID("cota")}, "host_contact": first})["id"].(string)
	f.must(map[string]any{"action": "group_update", "id": gid, "members": []string{first, builtinContactID("cota"), second}})
	f.must(map[string]any{"action": "group_update", "id": gid, "host_contact": second, "expected_host_contact": first})
	g, err := f.m.readGroup(gid)
	if err != nil {
		t.Fatal(err)
	}
	member := g.member(second).Session
	s, err := Load(f.m.config)
	if err != nil {
		t.Fatal(err)
	}
	alternate := s.APIProfiles[0]
	alternate.ID, alternate.Model = "alternate", "alternate-wire-model"
	s.APIProfiles = append(s.APIProfiles, alternate)
	s.ActiveProfile, s.MatrixProfile = "alternate", "alternate"
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	send := func(request, expected string) {
		t.Helper()
		f.must(map[string]any{"action": "group_post", "id": gid, "request_id": request, "text": request})
		f.settle(gid)
		f.mu.Lock()
		bodies := append([]string(nil), f.body["host"]...)
		f.mu.Unlock()
		if len(bodies) == 0 {
			t.Fatal("no model request")
		}
		var body map[string]any
		if e := json.Unmarshal([]byte(bodies[len(bodies)-1]), &body); e != nil || body["model"] != expected {
			t.Fatalf("outgoing model=%v want=%s: %v", body["model"], expected, e)
		}
	}
	send("mother-model-changed", "alternate-wire-model")
	r, err := f.m.Status(f.m.owner, member)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.m.configureSessionModel(member, r.ConversationRevision, "local-model"); err != nil {
		t.Fatal(err)
	}
	send("explicit-session-override", "fixture")
	for _, id := range []string{first, second} {
		c, e := f.m.readContact(id)
		if e != nil || c.Defaults == nil || c.Defaults.ModelID != "" {
			t.Fatal("group admission pinned inherited contact", id, e)
		}
	}
	// Restore inheritance, then reopen the same group. No new private session or
	// group member is substituted, and the next actual request follows Eyra.
	r, _ = f.m.Status(f.m.owner, member)
	if _, err = f.m.configureSessionModel(member, r.ConversationRevision, ""); err != nil {
		t.Fatal(err)
	}
	f.h.Close()
	f.h = NewWorkspaceHost(f.m.config, "", "")
	t.Cleanup(f.h.Close)
	f.m, err = f.h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	g, err = f.m.readGroup(gid)
	if err != nil || g.member(second).Session != member {
		t.Fatal("group member changed on reopen", err)
	}
	send("reopened-inherited-model", "alternate-wire-model")
	// Explicit broken configuration must not silently fall back to Eyra.
	f.must(map[string]any{"action": "contact_update", "id": first, "model_id": "local-model"})
	s.APIProfiles = s.APIProfiles[1:]
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	if _, err = f.call(map[string]any{"action": "group_update", "id": gid, "host_contact": first, "expected_host_contact": second}); err == nil {
		t.Fatal("handoff accepted unavailable explicit model")
	}
	if _, err = f.call(map[string]any{"action": "group_create", "request_id": "invalid-model-group", "name": "invalid", "members": []string{first}}); err == nil {
		t.Fatal("group accepted unavailable explicit model")
	}
}
