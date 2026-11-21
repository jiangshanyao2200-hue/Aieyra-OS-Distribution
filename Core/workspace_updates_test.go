// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestUpdateFreezeIncludesPrivateConversationAndBlocksNewAdmission; TestUpdateFreezeRetainsNativeManagerAdmissionAndContextCatalog
// Impact: python -B scripts/code-atlas.py show Core/workspace_updates_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"net/http"
	"sync"
	"testing"
	"time"
)

func TestUpdateFreezeIncludesPrivateConversationAndBlocksNewAdmission(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	defer once.Do(func() { close(release) })
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		close(started)
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		fixtureAnswer(w, "reply", "done", nil)
	})
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	v, e := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "create", "request_id": "freeze", "model_id": "local-model"}))
	if e != nil {
		t.Fatal(e)
	}
	r := v.(AgentRecord)
	cm, _ := h.conversationManager()
	if _, e = cm.Send(cm.owner, r.ID, "busy", "work"); e != nil {
		t.Fatal(e)
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("conversation did not start")
	}
	check := func(want bool) {
		t.Helper()
		v, e := h.freezeForUpdate(true)
		if e != nil || v.(map[string]any)["idle"] != want {
			t.Fatal(v, e)
		}
	}
	check(false)
	once.Do(func() { close(release) })
	if r, e = cm.Wait(context.Background(), cm.owner, r.ID, 5000); e != nil || r.State != "completed" {
		t.Fatal(r.State, e)
	}
	check(true)
	if _, e = cm.Send(cm.owner, r.ID, "late", "must not start"); e == nil {
		t.Fatal("send crossed update handoff")
	}
	if _, e = h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "create", "request_id": "late-create", "model_id": "local-model"})); e == nil {
		t.Fatal("create crossed update handoff")
	}
	if _, e = h.freezeForUpdate(false); e != nil {
		t.Fatal(e)
	}
	if cm.admissionFrozen() {
		t.Fatal("conversation did not unfreeze")
	}
}

func TestUpdateFreezeRetainsNativeManagerAdmissionAndContextCatalog(t *testing.T) {
	w := collaborationFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("freeze started a model") }, nil)
	packageHost, e := w.manager.ensurePackageAgentHost(true)
	if e != nil {
		t.Fatal(e)
	}
	v, e := w.host.freezeForUpdate(true)
	if e != nil || v.(map[string]any)["idle"] != true {
		t.Fatal(v, e)
	}
	if !w.manager.admissionFrozen() || !packageHost.admissionFrozen() {
		t.Fatal("manager admission not frozen")
	}
	if _, e = w.manager.ensureWorkboxHost(true); e == nil {
		t.Fatal("new workflow host crossed freeze")
	}
	if _, e = w.host.freezeForUpdate(false); e != nil {
		t.Fatal(e)
	}
	if w.manager.admissionFrozen() || packageHost.admissionFrozen() {
		t.Fatal("manager remained frozen")
	}
}
