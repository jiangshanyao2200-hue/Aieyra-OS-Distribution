// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestCodingBindingUsesExistingContactsAndFollowsEyra; TestCodingScopeCannotBeCreatedThroughGenericGroupAPI
// Impact: python -B scripts/code-atlas.py show Core/program_coding_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"net/http"
	"sync/atomic"
	"testing"
)

func TestCodingBindingUsesExistingContactsAndFollowsEyra(t *testing.T) {
	useTestStage(t, ReleaseStage{Toolbox: true, TeamCollaboration: true})
	var calls atomic.Int32
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		fixtureAnswer(w, "coding", "coding reply", nil)
	})
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	open := func() map[string]any {
		t.Helper()
		v, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "program_open", "program": "coding"}))
		if err != nil {
			t.Fatal(err)
		}
		return v.(map[string]any)
	}
	first := open()
	if first["configured"] != true || first["session"] == nil {
		t.Fatal("Coding did not resolve the inherited model", first)
	}
	binding := first["binding"].(map[string]any)
	if binding["kind"] != "group" || binding["host_contact_id"] != builtinContactID("cota") {
		t.Fatal("wrong Coding host", binding)
	}
	cm, err := h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	s.ExecutionProfile = "local-model"
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	ready := open()
	binding = ready["binding"].(map[string]any)
	host := binding["host_session_id"].(string)
	if ready["configured"] != true || host == "" {
		t.Fatal("configured Cota could not run without Vaya", ready)
	}
	rows := binding["members"].([]map[string]any)
	if len(rows) != 2 || rows[1]["configured"] != true || rows[1]["session_id"] == "" {
		t.Fatal("Vaya did not receive an independent inherited-model session", rows)
	}
	for range 3 {
		if open()["binding"].(map[string]any)["host_session_id"] != host {
			t.Fatal("opening duplicated Cota")
		}
	}
	s.VisionProfile = "local-model"
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	ready = open()
	rows = ready["binding"].(map[string]any)["members"].([]map[string]any)
	vayaSession := rows[1]["session_id"].(string)
	if vayaSession == "" || vayaSession == host {
		t.Fatal("Vaya did not receive an independent group context")
	}
	for _, id := range []string{host, vayaSession} {
		r, e := cm.Status(cm.owner, id)
		if e != nil || r.Spec.GroupID != codingScopeID() || r.Generation != 0 {
			t.Fatal("opening started a turn or borrowed a private session", r, e)
		}
	}
	// A pending group must remain idle when the UI reads its public snapshot.
	conversationGroupsMu.Lock()
	g, err := cm.readGroup(codingScopeID())
	if err == nil {
		g.Host.Pending = true
		err = cm.writeGroup(g)
	}
	conversationGroupsMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "group", "id": codingScopeID()})); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 0 {
		t.Fatal("opening or reading Coding invoked a provider")
	}
	for _, action := range []string{"group_update", "group_delete"} {
		if _, err = h.conversationCall(context.Background(), rawJSON(map[string]any{"action": action, "id": codingScopeID(), "name": "replaced"})); err == nil {
			t.Fatal("generic group API changed the fixed Coding scope", action)
		}
	}
	// Reset follows Eyra; an explicit invalid choice stays invalid.
	s.ExecutionProfile = ""
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	r, err := cm.Status(cm.owner, host)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := cm.resolveConversationSpec(r)
	if err != nil || resolved.ModelID != s.defaultMotherModel() {
		t.Fatal("reset did not follow Eyra", err)
	}
	s.ExecutionProfile = "removed-model"
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	if _, err = cm.resolveConversationSpec(r); err == nil {
		t.Fatal("explicit invalid model silently fell back")
	}
	if err = cm.checkConversationAuthority(r); err == nil {
		t.Fatal("revoked role remained authorized")
	}

}

func TestCodingScopeCannotBeCreatedThroughGenericGroupAPI(t *testing.T) {
	m, _ := matrixTestManager(t, nil)
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	_, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "group_create", "name": "Coding", "members": []string{builtinContactID("cota")}, "host_contact": builtinContactID("cota"), "request_id": "program:coding"}))
	if err == nil {
		t.Fatal("generic creation reserved the managed Coding identity")
	}
}
