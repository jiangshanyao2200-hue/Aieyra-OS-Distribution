// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: changeOfficialPackage; TestOfficialFixedRolesRespectRegistryWithoutChangingSessions
// Impact: python -B scripts/code-atlas.py show Core/official_roles_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"net/http"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/modules"
	"github.com/aieyra/aieyra-os/agent/official"
)

func changeOfficialPackage(t *testing.T, m *AgentManager, action, id, request string) {
	t.Helper()
	manager := m.toolPackages()
	list, err := manager.Call(context.Background(), modules.Request{Action: "list"})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range list.Items {
		if item.Manifest.ID != id {
			continue
		}
		out, err := manager.Call(context.Background(), modules.Request{Action: action, ID: id, ExpectedRevision: &list.Revision, ExpectedDigest: item.Digest, Grants: item.Manifest.Permissions, RequestID: request})
		if err != nil || !out.OK {
			t.Fatal(action, id, out, err)
		}
		return
	}
	t.Fatal("official package missing", id)
}

func TestOfficialFixedRolesRespectRegistryWithoutChangingSessions(t *testing.T) {
	withLegacyHomeTeam(t)
	var calls atomic.Int32
	w := collaborationFixture(t, func(rw http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		fixtureAnswer(rw, "fixed-role", "retained fixed role reply", nil)
	}, nil)
	ctx := context.Background()
	if _, err := w.collaborationCall(ctx, WorkspaceMatrix, rawJSON(map[string]any{"action": "configure", "mode": "natural"})); err != nil {
		t.Fatal(err)
	}
	roles := []string{WorkspaceMatrix, WorkspaceProject, WorkspaceExecution}
	before := map[string]AgentRecord{}
	for _, role := range roles {
		w.mu.Lock()
		r, err := w.dispatchLocked(role, "official-initial-"+role, "initial fixed role")
		w.mu.Unlock()
		if err != nil {
			t.Fatal(role, err)
		}
		r, err = w.manager.Wait(ctx, w.state.ID, r.ID, 10000)
		if err != nil || r.State != "completed" {
			t.Fatal(role, r.State, err)
		}
		before[role] = r
	}
	priorCalls := calls.Load()
	for _, role := range roles { // Disable Eyra before its required team packages.
		definition, _ := official.Role(role)
		changeOfficialPackage(t, w.manager, "disable", definition.ID, "official-disable-"+role)
	}
	for _, role := range roles {
		r := before[role]
		replayed, err := w.manager.SendGeneration(w.state.ID, r.ID, "official-initial-"+role, "initial fixed role", r.Generation)
		if err != nil || replayed.ID != r.ID || replayed.Generation != r.Generation {
			t.Fatal("disabled fixed role lost its accepted send receipt", role, err)
		}
		if _, err := w.enqueue("user", role, "official-blocked-queue-"+role, "new work"); err == nil || !strings.Contains(err.Error(), "not enabled") {
			t.Fatal("disabled fixed role accepted queued input", role, err)
		}
		if _, err := w.manager.SendGeneration(w.state.ID, r.ID, "official-blocked-turn-"+role, "new work", r.Generation); err == nil || !strings.Contains(err.Error(), "not enabled") {
			t.Fatal("disabled fixed role accepted existing session", role, err)
		}
		trusted := context.WithValue(ctx, workspaceTrustedKey{}, true)
		newSpec := r.Spec
		if replayed, err := w.manager.Create(trusted, w.state.ID, newSpec); err != nil || replayed.ID != r.ID {
			t.Fatal("disabled fixed role lost its accepted creation receipt", role, err)
		}
		newSpec.RequestID = "official-blocked-create-" + role
		if _, err := w.manager.Create(trusted, w.state.ID, newSpec); err == nil || !strings.Contains(err.Error(), "not enabled") {
			t.Fatal("disabled fixed role created another task", role, err)
		}
		w.mu.Lock()
		_, err = w.dispatchLocked(role, "official-blocked-dispatch-"+role, "new work")
		w.mu.Unlock()
		if err == nil || !strings.Contains(err.Error(), "not enabled") {
			t.Fatal("disabled fixed role dispatched", role, err)
		}
		if _, err := w.manager.run(ctx, &agentJob{record: r}, "recovery", true); err == nil || !strings.Contains(err.Error(), "not enabled") {
			t.Fatal("recovery bypassed disabled fixed role", role, err)
		}
		after, err := w.manager.Status(w.state.ID, r.ID)
		if err != nil || !reflect.DeepEqual(r, after) {
			t.Fatal("disabled admission modified retained session", role, err)
		}
	}
	if _, err := w.greet(rawJSON(map[string]any{"retry": true})); err == nil || !strings.Contains(err.Error(), "not enabled") {
		t.Fatal("greeting bypassed disabled Eyra", err)
	}
	w.mu.Lock()
	_, err := w.startContextCleaningLocked("", "clean retained history")
	w.mu.Unlock()
	if err == nil || !strings.Contains(err.Error(), "not enabled") || calls.Load() != priorCalls {
		t.Fatal("maintenance bypassed disabled Eyra", err, priorCalls, calls.Load())
	}
	for _, role := range []string{WorkspaceProject, WorkspaceExecution, WorkspaceMatrix} {
		definition, _ := official.Role(role)
		changeOfficialPackage(t, w.manager, "enable", definition.ID, "official-enable-"+role)
	}
	r := before[WorkspaceMatrix]
	if _, err := w.manager.SendGeneration(w.state.ID, r.ID, "official-resume-fixed", "continue retained session", r.Generation); err != nil {
		t.Fatal(err)
	}
	after, err := w.manager.Wait(ctx, w.state.ID, r.ID, 10000)
	if err != nil || after.State != "completed" || after.ID != r.ID || calls.Load() != priorCalls+1 {
		t.Fatal("explicit enable did not resume retained fixed session", after.State, err, calls.Load())
	}
}
