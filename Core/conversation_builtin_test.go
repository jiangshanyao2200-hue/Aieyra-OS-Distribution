// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestConversationQueuedRequestChecksFrozenModelAfterRebinding; TestBuiltinRevocationDuringResponsePreventsToolExecution; TestContactToolRevocationDuringResponsePreventsWrite; TestBuiltinContactsExistWithoutModelOrSession; TestBuiltinConversationFreezesModelForTurnAndFollowsNextBinding; TestGroupCanInviteBuiltinWithoutPrivateSession
// Impact: python -B scripts/code-atlas.py show Core/conversation_builtin_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestConversationQueuedRequestChecksFrozenModelAfterRebinding(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("revoked queued model reached provider") })
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	v, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_create", "request_id": "queued-model", "model_id": "local-model", "name": "worker", "workdir": dir}))
	if err != nil {
		t.Fatal(err)
	}
	id := v.(map[string]any)["id"].(string)
	cm, err := h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	profile := s.APIProfiles[0]
	profile.ID = "replacement-model"
	s.APIProfiles = append(s.APIProfiles, profile)
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	cm.mu.Lock()
	job := cm.jobs[id]
	frozen := job.record.Spec
	job.conversationTurn = &frozen
	cm.mu.Unlock()
	for i := 0; i < cap(cm.slots); i++ {
		cm.slots <- struct{}{}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result := make(chan error, 1)
	go func() {
		_, _, e := cm.agentRequest(ctx, job, s, []Message{{Role: RoleUser, Content: "work"}}, nil, "model")
		result <- e
	}()
	if _, err = cm.updateContact(contactPatch{ID: id, ModelID: "replacement-model"}); err != nil {
		t.Fatal(err)
	}
	s.APIProfiles = []APIProfile{profile}
	s.ActiveProfile = profile.ID
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	<-cm.slots
	err = <-result
	if err == nil || !strings.Contains(err.Error(), "本回合模型已停用") {
		t.Fatal(err)
	}
}

func TestBuiltinRevocationDuringResponsePreventsToolExecution(t *testing.T) {
	var config string
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		s, e := Load(config)
		if e != nil {
			t.Error(e)
			return
		}
		off := false
		s.ExecutionEnabled = &off
		if e = s.Save(); e != nil {
			t.Error(e)
			return
		}
		fixtureAnswer(w, "revoked", "", []any{map[string]any{"type": "function_call", "id": "fc_write", "call_id": "write", "name": "apply_patch", "arguments": `{"patch":"*** Begin Patch\n*** Add File: revoked.txt\n+should not execute\n*** End Patch"}`}})
	})
	config = m.config
	s, e := Load(config)
	if e != nil {
		t.Fatal(e)
	}
	s.MatrixProfile = "local-model"
	if e = s.Save(); e != nil {
		t.Fatal(e)
	}
	h := NewWorkspaceHost(config, "", "")
	defer h.Close()
	cm, e := h.conversationManager()
	if e != nil {
		t.Fatal(e)
	}
	c, _, e := cm.liveContact(builtinContactID("cota"))
	if e != nil {
		t.Fatal(e)
	}
	created, e := cm.newBuiltinSession(context.Background(), c, "revocation")
	if e != nil {
		t.Fatal(e)
	}
	id := created["id"].(string)
	cm.mu.Lock()
	cm.jobs[id].record.Spec.Workdir = dir
	_ = cm.saveLocked(cm.jobs[id])
	cm.mu.Unlock()
	if _, e = cm.Send(cm.owner, id, "run", "write proof"); e != nil {
		t.Fatal(e)
	}
	r, e := cm.Wait(context.Background(), cm.owner, id, 5000)
	if e != nil || r.State != "failed" || !strings.Contains(r.Error, "tool_not_assigned") {
		t.Fatal(r.State, r.Error, e)
	}
	if _, e = os.Stat(filepath.Join(dir, "revoked.txt")); !os.IsNotExist(e) {
		t.Fatal("revoked tool executed")
	}
}

func TestContactToolRevocationDuringResponsePreventsWrite(t *testing.T) {
	var cm *AgentManager
	var id string
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		tools := []string{}
		if _, e := cm.updateContact(contactPatch{ID: id, Tools: &tools}); e != nil {
			t.Error(e)
		}
		fixtureAnswer(w, "revoked", "", []any{map[string]any{"type": "function_call", "id": "fc_write", "call_id": "write", "name": "apply_patch", "arguments": `{"patch":"*** Begin Patch\n*** Add File: revoked.txt\n+should not execute\n*** End Patch"}`}})
	})
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	v, e := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_create", "request_id": "writer", "model_id": "local-model", "name": "writer", "tools": []string{"apply_patch"}, "workdir": dir}))
	if e != nil {
		t.Fatal(e)
	}
	id = v.(map[string]any)["id"].(string)
	cm, e = h.conversationManager()
	if e != nil {
		t.Fatal(e)
	}
	if _, e = cm.Send(cm.owner, id, "run", "write proof"); e != nil {
		t.Fatal(e)
	}
	r, e := cm.Wait(context.Background(), cm.owner, id, 5000)
	if e != nil || r.State != "failed" || !strings.Contains(r.Error, "tool_not_assigned") {
		t.Fatal(r.State, r.Error, e)
	}
	if _, e = os.Stat(filepath.Join(dir, "revoked.txt")); !os.IsNotExist(e) {
		t.Fatal("revoked contact tool wrote a file")
	}
}

func TestBuiltinContactsExistWithoutModelOrSession(t *testing.T) {
	m, _ := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("listing contacts started a request") })
	settings, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	settings.ActiveProfile, settings.MatrixProfile = "", ""
	if err = settings.Save(); err != nil {
		t.Fatal(err)
	}
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	view, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contacts"}))
	if err != nil {
		t.Fatal(err)
	}
	rows := builtinContactViews(view.([]map[string]any))
	if len(rows) != 3 {
		t.Fatal(rows)
	}
	ids := map[string]string{}
	for _, row := range rows {
		name := row["builtin"].(string)
		ids[name] = row["id"].(string)
		if len(row["sessions"].([]map[string]any)) != 0 || row["model_managed"] != true || row["model_error"] == "" {
			t.Fatal(row)
		}
	}
	if len(ids) != 3 {
		t.Fatal(ids)
	}
	cm, _ := h.conversationManager()
	if err = cm.ensureBuiltinContacts(); err != nil {
		t.Fatal(err)
	}
	again, _ := cm.listContacts()
	again = builtinContactViews(again)
	if len(again) != 3 {
		t.Fatal("duplicated builtin contacts")
	}
	for _, row := range again {
		if row["id"] != ids[row["builtin"].(string)] {
			t.Fatal("contact identity changed")
		}
	}
	if err = os.WriteFile(filepath.Join(filepath.Dir(m.config), "companion-profile.json"), rawJSON(map[string]any{"roles": map[string]any{"execution": map[string]any{"name": "工程师", "description": "同一份主体资料", "ring": "wave"}}}), 0600); err != nil {
		t.Fatal(err)
	}
	c, _, err := cm.liveContact(ids["cota"])
	if err != nil {
		t.Fatal(err)
	}
	if row := cm.contactView(c, nil); row["name"] != "工程师" || row["description"] != "同一份主体资料" {
		t.Fatal(row)
	}
	if _, err = h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "session_create", "contact_id": c.ID, "request_id": "unconfigured"})); err == nil {
		t.Fatal("unconfigured builtin started")
	}
}

func TestBuiltinConversationFreezesModelForTurnAndFollowsNextBinding(t *testing.T) {
	var config string
	var mu sync.Mutex
	models := []string{}
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model string `json:"model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		mu.Lock()
		models = append(models, body.Model)
		n := len(models)
		mu.Unlock()
		if n == 1 {
			s, err := Load(config)
			if err != nil {
				t.Error(err)
				return
			}
			s.ExecutionProfile = "other-model"
			s.APIProfiles[0].Model = "changed-mid-turn"
			if err = s.Save(); err != nil {
				t.Error(err)
			}
			fixtureAnswer(w, "plan", "", []any{map[string]any{"type": "function_call", "id": "fc_plan", "call_id": "plan", "name": "update_plan", "arguments": `{"summary":"核对模型绑定","plan":[{"id":"verify","description":"本回合保持原模型","status":"completed"}]}`}})
			return
		}
		fixtureAnswer(w, "done", "完成", nil)
	})
	config = m.config
	s, err := Load(config)
	if err != nil {
		t.Fatal(err)
	}
	s.MatrixProfile = "local-model"
	p := s.APIProfiles[0]
	p.ID, p.Model = "other-model", "next-turn-model"
	s.APIProfiles = append(s.APIProfiles, p)
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	h := NewWorkspaceHost(config, "", "")
	defer h.Close()
	cm, err := h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	c, _, err := cm.liveContact(builtinContactID("cota"))
	if err != nil {
		t.Fatal(err)
	}
	created, err := cm.newBuiltinSession(context.Background(), c, "create-cota")
	if err != nil {
		t.Fatal(err)
	}
	id := created["id"].(string)
	for i, request := range []string{"one", "two"} {
		if _, err = cm.SendGeneration(cm.owner, id, request, "完成本次核对", i); err != nil {
			t.Fatal(err)
		}
		done, err := cm.Wait(context.Background(), cm.owner, id, 10000)
		if err != nil || done.State != "completed" {
			t.Fatal(done.State, done.Error, err)
		}
	}
	mu.Lock()
	got := slices.Clone(models)
	mu.Unlock()
	if !slices.Equal(got, []string{"fixture", "fixture", "next-turn-model"}) {
		t.Fatal("model changed inside a turn or failed to follow next binding", got)
	}
	current, err := cm.Status(cm.owner, id)
	if err != nil || current.Spec.ModelID != "other-model" {
		t.Fatal(current.Spec.ModelID, err)
	}
	settings, err := Load(config)
	if err != nil {
		t.Fatal(err)
	}
	off := false
	settings.ExecutionEnabled = &off
	if err = settings.Save(); err != nil {
		t.Fatal(err)
	}
	if _, err = cm.SendGeneration(cm.owner, id, "disabled", "do not run", 2); err == nil {
		t.Fatal("disabled role accepted")
	}
	mu.Lock()
	defer mu.Unlock()
	if len(models) != 3 {
		t.Fatal("disabled role called provider")
	}
}

func TestGroupCanInviteBuiltinWithoutPrivateSession(t *testing.T) {
	m, _ := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("group creation started a request") })
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	s.MatrixProfile = "local-model"
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	_, err = h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "group_create", "request_id": "builtin-group", "name": "协作", "members": []string{builtinContactID("cota"), builtinContactID("vaya")}}))
	if err != nil {
		t.Fatal(err)
	}
	cm, _ := h.conversationManager()
	for _, name := range []string{"cota", "vaya"} {
		_, sessions, err := cm.liveContact(builtinContactID(name))
		if err != nil || len(sessions) != 0 {
			t.Fatal("group created a private conversation", name, err)
		}
	}
}
