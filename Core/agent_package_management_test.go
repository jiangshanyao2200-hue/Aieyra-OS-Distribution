// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestAgentPackagePrimaryManagementIsScopedAndCannotReenable; TestAgentPackageManagedChildCannotManageSiblingOrDisabledFixedRole; TestAgentPackageManagedRoleAdmissionIsAtomic; TestAgentPackageSendCannotBypassSupervisorsCurrentTools
// Impact: python -B scripts/code-atlas.py show Core/agent_package_management_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"net/http"
	"reflect"
	"sync"
	"testing"
)

func TestAgentPackagePrimaryManagementIsScopedAndCannotReenable(t *testing.T) {
	m, w, service, dir, identity := packageAgentFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("idle management requested a model") })
	private := newPackageAgent(t, service, identity, "private", dir)
	primary := "11111111111111111111111111111111"
	m.jobs[primary] = &agentJob{record: AgentRecord{ID: primary, Parent: m.owner, Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix}}}
	w.state.Roles[WorkspaceMatrix] = primary
	ctx := WithToolPermissions(context.Background(), []string{"agents", "apply_patch"})
	call := func(p agentPackageCommand) (any, error) { return m.packageAgentTool(ctx, primary, rawJSON(p)) }
	p := agentPackageCommand{Action: "create", Package: identity, RequestID: "managed", ModelID: "local-model", Workdir: dir, Title: "Scoped reviewer", TeamRole: "review"}
	if _, err := m.packageAgentTool(WithToolPermissions(context.Background(), []string{}), primary, rawJSON(p)); err == nil {
		t.Fatal("unassigned management capability accepted")
	}
	out, err := call(p)
	if err != nil {
		t.Fatal(err)
	}
	r := out.(AgentRecord)
	if r.State != "idle" || r.Generation != 0 || r.Instance.Supervisor != "primary" || r.Instance.TeamRole != "review" || !reflect.DeepEqual(r.Spec.Tools, []string{"agents", "apply_patch"}) {
		t.Fatal("incorrect idle or capability binding", r)
	}
	if _, err := call(agentPackageCommand{Action: "status", ID: private.ID}); err == nil {
		t.Fatal("unrelated private instance exposed")
	}
	prompt := "Instance-only update"
	out, err = call(agentPackageCommand{Action: "configure", ID: r.ID, RequestID: "edit", ExpectedRevision: &r.Instance.Revision, Prompt: &prompt})
	if err != nil {
		t.Fatal(err)
	}
	r = out.(AgentRecord)
	if r.Spec.Prompt != prompt {
		t.Fatal("managed prompt unchanged")
	}
	retry, err := call(p)
	if err != nil || retry.(AgentRecord).ID != r.ID || len(service.List(service.owner)) != 2 {
		t.Fatal("creation retry lost receipt", retry, err)
	}
	widen := []string{"agents", "exec_command"}
	for _, change := range []agentPackageCommand{{Action: "configure", Tools: &widen}, {Action: "configure", RestoreTools: true}, {Action: "team", Supervisor: private.ID, TeamRole: "steal"}} {
		change.ID, change.RequestID, change.ExpectedRevision = r.ID, "denied-"+change.Action, &r.Instance.Revision
		if _, err := call(change); err == nil {
			t.Fatal("supervisor exceeded grant", change)
		}
	}
	unchanged, _ := service.Status(service.owner, r.ID)
	if unchanged.Instance.Revision != r.Instance.Revision || !reflect.DeepEqual(unchanged.Spec.Tools, r.Spec.Tools) {
		t.Fatal("rejected management mutated instance")
	}
	duplicate := p
	duplicate.RequestID = "other-request"
	if _, err := call(duplicate); err == nil {
		t.Fatal("duplicate role admitted")
	}
	conflict := p
	conflict.TeamRole = "different"
	if _, err := call(conflict); err == nil {
		t.Fatal("different creation reused original receipt")
	}
	disabled := false
	r = changePackageAgent(t, service, r, agentPackageCommand{Action: "configure", Enabled: &disabled})
	enabled := true
	if _, err := call(agentPackageCommand{Action: "configure", ID: r.ID, RequestID: "reenable", ExpectedRevision: &r.Instance.Revision, Enabled: &enabled}); err == nil {
		t.Fatal("model reopened user-disabled instance")
	}
	r = changePackageAgent(t, service, r, agentPackageCommand{Action: "team"})
	if _, err := call(p); err == nil {
		t.Fatal("creation retry recovered revoked supervision")
	}
	if _, err := call(agentPackageCommand{Action: "status", ID: r.ID}); err == nil {
		t.Fatal("detached instance visible")
	}
}

func TestAgentPackageManagedChildCannotManageSiblingOrDisabledFixedRole(t *testing.T) {
	_, w, m, dir, identity := packageAgentFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("management requested model") })
	parent := newPackageAgent(t, m, identity, "parent", dir)
	sibling := newPackageAgent(t, m, identity, "sibling", dir)
	ctx := WithToolPermissions(context.Background(), []string{"agents", "apply_patch"})
	m.mu.Lock()
	m.jobs[parent.ID].record.State = "running"
	m.mu.Unlock()
	defer func() { m.mu.Lock(); m.jobs[parent.ID].record.State = "idle"; m.mu.Unlock() }()
	out, err := m.packageAgentTool(ctx, parent.ID, rawJSON(agentPackageCommand{Action: "create", Package: identity, RequestID: "child", ModelID: "local-model", Workdir: dir, TeamRole: "review"}))
	if err != nil {
		t.Fatal(err)
	}
	child := out.(AgentRecord)
	if child.Instance.Supervisor != parent.ID {
		t.Fatal("wrong supervisor", child)
	}
	if _, err = m.packageAgentTool(ctx, parent.ID, rawJSON(agentPackageCommand{Action: "configure", ID: sibling.ID, RequestID: "steal", ExpectedRevision: &sibling.Instance.Revision, Title: "changed"})); err == nil {
		t.Fatal("sibling management admitted")
	}
	s, err := Load(w.config)
	if err != nil {
		t.Fatal(err)
	}
	off := false
	s.CollaborationEnabled = &off
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	compiled, err := compiledAgentPackages()
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"aieyra.vaya", "aieyra.cota"} {
		_, err = m.packageAgentTool(ctx, parent.ID, rawJSON(agentPackageCommand{Action: "create", Package: "mod:" + id + "@" + compiled[id].Digest, RequestID: id, ModelID: "local-model", Workdir: dir, TeamRole: id}))
		if err == nil {
			t.Fatal("disabled fixed role cloned", id)
		}
	}
	if len(m.List(m.owner)) != 3 {
		t.Fatal("rejection persisted an instance")
	}
}

func TestAgentPackageManagedRoleAdmissionIsAtomic(t *testing.T) {
	m, w, service, dir, identity := packageAgentFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("idle creation requested a model") })
	primary := "11111111111111111111111111111111"
	m.jobs[primary] = &agentJob{record: AgentRecord{ID: primary, Parent: m.owner, Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix}}}
	w.state.Roles[WorkspaceMatrix] = primary
	ctx := WithToolPermissions(context.Background(), []string{"agents", "apply_patch"})
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, request := range []string{"first", "second"} {
		wg.Add(1)
		go func(request string) {
			defer wg.Done()
			<-start
			_, err := m.packageAgentTool(ctx, primary, rawJSON(agentPackageCommand{Action: "create", Package: identity, RequestID: request, ModelID: "local-model", Workdir: dir, TeamRole: "review"}))
			results <- err
		}(request)
	}
	close(start)
	wg.Wait()
	close(results)
	accepted := 0
	for err := range results {
		if err == nil {
			accepted++
		}
	}
	if accepted != 1 || len(service.List(service.owner)) != 1 {
		t.Fatal("role admission was not atomic", accepted, len(service.List(service.owner)))
	}
}

func TestAgentPackageSendCannotBypassSupervisorsCurrentTools(t *testing.T) {
	m, w, service, dir, identity := packageAgentFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("denied send reached model") })
	primary := "11111111111111111111111111111111"
	m.jobs[primary] = &agentJob{record: AgentRecord{ID: primary, Parent: m.owner, Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix}}}
	w.state.Roles[WorkspaceMatrix] = primary
	ctx := WithToolPermissions(context.Background(), []string{"agents"})
	for _, route := range []string{"package", "legacy"} {
		r := newPackageAgent(t, service, identity, route, dir)
		r = changePackageAgent(t, service, r, agentPackageCommand{Action: "team", Supervisor: "primary", TeamRole: route})
		var err error
		if route == "package" {
			_, err = m.packageAgentTool(ctx, primary, rawJSON(agentPackageCommand{Action: "send", ID: r.ID, RequestID: "deny", Message: "run", Generation: 0}))
		} else {
			_, err = m.Call(ctx, primary, rawJSON(map[string]any{"action": "send", "id": r.ID, "request_id": "deny", "message": "run", "generation": 0}))
		}
		if err == nil {
			t.Errorf("%s send widened supervisor grant", route)
		}
		saved, _ := service.Status(service.owner, r.ID)
		if saved.Generation != 0 || saved.State != "idle" || len(saved.Turns) != 0 {
			t.Errorf("%s rejected send consumed a turn", route)
		}
	}
}
