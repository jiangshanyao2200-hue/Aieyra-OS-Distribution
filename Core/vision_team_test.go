// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestLegacyExecutionSettlesOnlyWhenTeamClosed; TestCotaTakesScopedWorkWithBriefs
// Impact: python -B scripts/code-atlas.py show Core/vision_team_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"testing"
)

// Cota 接管 execution。团队开着时旧的等待记录留给 Cota；团队关掉时才收尾，不占位。
func TestLegacyExecutionSettlesOnlyWhenTeamClosed(t *testing.T) {
	withLegacyHomeTeam(t)
	w := collaborationFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("migration called a model") }, nil)
	id := collaborationArchive(t, w, WorkspaceExecution, "retained waiting transcript")
	w.manager.mu.Lock()
	w.manager.jobs[id].record.State = "waiting_user"
	w.manager.mu.Unlock()
	if err := w.retireFixedExecution(); err != nil {
		t.Fatal(err)
	}
	if record, _ := w.manager.Status(w.state.ID, id); record.State != "waiting_user" {
		t.Fatal("open team settled Cota's work", record.State)
	}
	closed := t.TempDir()
	if err := stageTestResources(os.Getenv("AIEYRA_RESOURCE_ROOT"), closed, ReleaseStage{Toolbox: true}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AIEYRA_RESOURCE_ROOT", closed)
	if err := w.retireFixedExecution(); err != nil {
		t.Fatal(err)
	}
	record, err := w.manager.Status(w.state.ID, id)
	if err != nil || record.State != "interrupted" || record.Generation != 1 {
		t.Fatal("closed team did not settle waiting history", record.State, err)
	}
	receipt, err := w.Call(context.Background(), "workspace.receipt", rawJSON(map[string]any{"task_id": w.state.ID, "agent_id": id, "id": "turn:call"}))
	if err != nil || !strings.Contains(string(rawJSON(receipt)), "retained waiting transcript") {
		t.Fatal("settling lost original history", err)
	}
}

// Cota 接 Eyra 派的活，聊天里只留 brief；Cota 不能派活、不能 review，Eyra 自己核对。
func TestCotaTakesScopedWorkWithBriefs(t *testing.T) {
	withLegacyHomeTeam(t)
	var cotaCalls atomic.Int32
	w := collaborationFixture(t, func(rw http.ResponseWriter, r *http.Request) {
		body := make([]byte, 1<<20)
		n, _ := r.Body.Read(body)
		if strings.Contains(string(body[:n]), "Workspace role: execution.") {
			cotaCalls.Add(1)
		}
		fixtureAnswer(rw, "cota", "简报：改好了两处，测试通过\nFiles: a.go", nil)
	}, nil)
	if _, err := w.collaborationCall(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "configure", "mode": "custom", "roles": []string{WorkspaceExecution}})); err != nil {
		t.Fatal(err)
	}
	planned := context.WithValue(context.Background(), workflowContextKey{}, workflowContext{Plan: &PlanEngine{State: &PlanState{ID: "p", Status: "active"}}})
	result, err := w.team(planned, WorkspaceMatrix, rawJSON(map[string]any{"action": "dispatch", "role": WorkspaceExecution, "request_id": "cota-1", "message": "private work card: edit a.go and run tests", "brief": "Cota，帮我把 a.go 改掉再跑测试", "wait": true}))
	if err != nil || cotaCalls.Load() == 0 {
		t.Fatal("Cota did not run", err, cotaCalls.Load())
	}
	if !strings.Contains(string(rawJSON(result)), "改好了两处") {
		t.Fatal("Eyra did not receive Cota's receipt", string(rawJSON(result)))
	}
	snapshot, err := w.Snapshot(0)
	if err != nil {
		t.Fatal(err)
	}
	value := snapshot.(map[string]any)
	talk := value["team_talk"].([]workspaceTalk)
	var lines []string
	for _, t := range talk {
		lines = append(lines, t.From+">"+t.To+":"+t.Kind+":"+t.Brief)
	}
	want := []string{"matrix>execution:dispatch:Cota，帮我把 a.go 改掉再跑测试", "execution>matrix:ack:收到！", "execution>matrix:result:改好了两处，测试通过"}
	if strings.Join(lines, "|") != strings.Join(want, "|") {
		t.Fatal("chat briefs", lines)
	}
	if strings.Contains(string(rawJSON(talk)), "private work card") {
		t.Fatal("raw work card leaked into the chat")
	}
	if _, err := w.team(planned, WorkspaceMatrix, rawJSON(map[string]any{"action": "status", "role": WorkspaceExecution})); err != nil {
		t.Fatal(err)
	}
	if got := len(w.teamTalkLocked(100)); got != 3 {
		t.Fatal("result brief recorded twice", got)
	}
	found := false
	for _, row := range value["roles"].([]any) {
		found = found || row.(map[string]any)["role"] == WorkspaceExecution
	}
	if !found {
		t.Fatal("Cota missing from the role rows")
	}
	if _, err := w.team(planned, WorkspaceExecution, rawJSON(map[string]any{"action": "dispatch", "role": WorkspaceProject, "request_id": "cota-leads", "message": "x"})); err == nil {
		t.Fatal("Cota dispatched work")
	}
	if _, err := w.team(planned, WorkspaceMatrix, rawJSON(map[string]any{"action": "review", "role": WorkspaceExecution, "request_id": "review", "verdict": "accepted", "evidence": "x", "generation": 1})); err == nil {
		t.Fatal("review loop reopened")
	}
	if _, err := w.team(planned, WorkspaceExecution, rawJSON(map[string]any{"action": "message", "role": WorkspaceMatrix, "request_id": "cota-note", "message": "progress details", "brief": "测试跑到一半，等你定一下"})); err != nil {
		t.Fatal("Cota could not report to Eyra", err)
	}
	w.mu.Lock()
	last := w.state.TeamTalk[len(w.state.TeamTalk)-1]
	w.mu.Unlock()
	if last.From != WorkspaceExecution || last.Brief != "测试跑到一半，等你定一下" {
		t.Fatal("Cota's brief missing", last)
	}
}
