// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMotherIdentityRefusesCodingMembers; withLegacyHomeTeam; TestHomeMotherHasNoTeamDispatch; TestRetiredHomeTeamSettlesLeftoverWork
// Impact: python -B scripts/code-atlas.py show Core/workspace_identity_coding_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

// 第109轮（Q8）：Cota 与 Vaya 在 Coding 程序里工作，母体不再切换成他们的身份，
// 拒绝时指向 Coding 委派，且不创建交接、不安排压缩。
func TestMotherIdentityRefusesCodingMembers(t *testing.T) {
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, _ *http.Request) {
		http.Error(rw, "no model call expected", http.StatusTeapot)
	})
	h, w := openCoreLinkHome(t, m.config, dir)
	defer h.Close()
	c := &motherIdentity{w: w, receipts: map[string]*motherIdentityState{}}
	for _, name := range []string{"cota", "vaya"} {
		if _, _, _, _, err := c.target(builtinContactID(name)); err == nil || !strings.Contains(err.Error(), "program_send") {
			t.Fatalf("%s must be refused with the Coding delegation hint, got %v", name, err)
		}
	}
	if c.state != nil || len(c.receipts) != 0 {
		t.Fatal("a refused target must not leave a handoff behind")
	}
}

// 首页团队已退役（第109轮）；这些旧用例仍覆盖保留的团队执行器，直到它随 Coding 完全接管后删除。
func withLegacyHomeTeam(t *testing.T) {
	t.Helper()
	prev := homeTeamRetired
	homeTeamRetired = false
	t.Cleanup(func() { homeTeamRetired = prev })
}

// 首页 Eyra 只做母体：没有 team 工具，workspace 工具不带协同派发动作，协同配置被拒绝并指向 Coding。
func TestHomeMotherHasNoTeamDispatch(t *testing.T) {
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, _ *http.Request) {
		http.Error(rw, "no model call expected", http.StatusTeapot)
	})
	h, w := openCoreLinkHome(t, m.config, dir)
	defer h.Close()
	for _, name := range w.teamPermissions(WorkspaceMatrix) {
		if name == "team" {
			t.Fatal("home mother must not receive the team tool")
		}
	}
	if ready, _ := w.collaborationReady(); ready {
		t.Fatal("home team must stay retired")
	}
	if _, err := w.collaborationCall(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "collaboration_configure", "mode": "natural"})); err == nil || !strings.Contains(err.Error(), "program_send") {
		t.Fatalf("collaboration configure must point to Coding, got %v", err)
	}
	if _, err := w.collaborationCall(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "collaboration_status"})); err != nil {
		t.Fatalf("status stays readable for old records: %v", err)
	}
}

// 首页团队退役后，遗留的 Vaya、Cota 待办在打开时收尾，历史保留，不会被恢复执行。
func TestRetiredHomeTeamSettlesLeftoverWork(t *testing.T) {
	w := collaborationFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("settling called a model") }, nil)
	ids := []string{collaborationArchive(t, w, WorkspaceExecution, "cota leftover"), collaborationArchive(t, w, WorkspaceProject, "vaya leftover")}
	w.manager.mu.Lock()
	for _, id := range ids {
		w.manager.jobs[id].record.State = "waiting_user"
	}
	w.manager.mu.Unlock()
	if err := w.retireFixedExecution(); err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		record, err := w.manager.Status(w.state.ID, id)
		if err != nil || record.State != "interrupted" || !strings.Contains(record.Error, "Coding") {
			t.Fatal("retired home team left work resumable", id, record.State, record.Error, err)
		}
	}
}
