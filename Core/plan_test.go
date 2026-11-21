// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: samplePlanUpdate; initialPlan; applyPlan; TestPlanToolAtomicPersistenceAndSessionRecovery; TestPlanParallelMutationsRejectStaleRevision; TestPlanCallConflictCannotCorruptArchive
// Impact: python -B scripts/code-atlas.py show Core/plan_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func samplePlanUpdate() PlanUpdate {
	return PlanUpdate{Action: "create", Mode: "plan", Acceptance: []string{"给出完整的分析结论"}, Objective: "分析两种布局的差异", Phases: []PlanPhase{{ID: "P", Title: "分析", Steps: []PlanStep{{ID: "p1", Text: "比较布局与文字", Status: PlanRunning}, {ID: "p2", Text: "整理结论", Status: PlanPending}}}}}
}
func initialPlan(t *testing.T) *PlanState {
	t.Helper()
	tr, err := ApplyPlanUpdate(nil, samplePlanUpdate())
	if err != nil {
		t.Fatal(err)
	}
	return tr.State
}
func applyPlan(t *testing.T, p *PlanState, ops ...PlanOperation) *PlanTransition {
	t.Helper()
	tr, err := ApplyPlanUpdate(p, PlanUpdate{Action: "update", PlanID: p.ID, ExpectedRevision: p.Revision, Changes: ops})
	if err != nil {
		t.Fatal(err)
	}
	return tr
}
func TestPlanToolAtomicPersistenceAndSessionRecovery(t *testing.T) {
	engine := &PlanEngine{}
	args, _ := json.Marshal(samplePlanUpdate())
	reply := Message{Role: RoleAssistant, ResponseID: "response1", ToolCalls: []ToolCall{{ID: "call1", Function: FunctionCall{Name: "update_plan", Arguments: string(args)}}}}
	if _, err := ExecutePlanTools(engine, reply, "response1", func(ToolTurn) error { return errors.New("disk full") }); err == nil || engine.State != nil || len(engine.Receipts) != 0 {
		t.Fatal("写盘失败却应用了计划")
	}
	a, err := NewSessionArchive(filepath.Join(t.TempDir(), "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = a.Start(ModelFlash); err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	persist := func(turn ToolTurn) error { return a.Append("tool_turn", turn) }
	turn, err := ExecutePlanTools(engine, reply, "response1", persist)
	if err != nil {
		t.Fatal(err)
	}
	again, err := ExecutePlanTools(engine, reply, "response1", persist)
	if err != nil || len(again.Receipts) != 0 || again.Messages[1].Content != turn.Messages[1].Content || engine.State.Revision != 1 {
		t.Fatal("重放调用重复执行", err)
	}
	restored, err := a.read()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(restored.Plan.State, engine.State) || len(restored.Plan.Receipts) != 1 || len(restored.PlanHistory) != 1 {
		t.Fatal("会话恢复没有保留精确计划和修订历史")
	}
	cp := &Checkpoint{Summary: CompactSummary{Goals: []string{"摘要"}}, Plan: ClonePlan(engine.State)}
	if !strings.Contains(cp.Message().Content, engine.State.ID) {
		t.Fatal("Compact 工作记忆未保留精确计划")
	}
}
func TestPlanParallelMutationsRejectStaleRevision(t *testing.T) {
	e := &PlanEngine{State: initialPlan(t)}
	u := PlanUpdate{Action: "update", PlanID: e.State.ID, ExpectedRevision: 1, Changes: []PlanOperation{{Op: "revise", StepID: "p1", Text: "改写后的步骤", Reason: "新证据"}}}
	args, _ := json.Marshal(u)
	reply := Message{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: "c1", Function: FunctionCall{Name: "update_plan", Arguments: string(args)}}, {ID: "c2", Function: FunctionCall{Name: "update_plan", Arguments: string(args)}}}}
	turn, err := ExecutePlanTools(e, reply, "resp", func(ToolTurn) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if e.State.Revision != 2 || !strings.Contains(turn.Messages[2].Content, "revision_conflict") {
		t.Fatal("并发旧版本没有被拒绝")
	}
}
func TestPlanCallConflictCannotCorruptArchive(t *testing.T) {
	e := &PlanEngine{}
	args, _ := json.Marshal(samplePlanUpdate())
	reply := Message{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: "same", Function: FunctionCall{Name: "update_plan", Arguments: string(args)}}}}
	writes := 0
	persist := func(ToolTurn) error { writes++; return nil }
	if _, err := ExecutePlanTools(e, reply, "r1", persist); err != nil {
		t.Fatal(err)
	}
	again, err := ExecutePlanTools(e, reply, "r1", persist)
	if err != nil || !again.Replayed || writes != 1 {
		t.Fatal("replayed turn duplicated archive")
	}
	reply.ToolCalls[0].Function.Arguments = `{"action":"complete","expected_revision":1}`
	if _, err = ExecutePlanTools(e, reply, "r1", persist); err == nil || writes != 1 || e.State.Revision != 1 {
		t.Fatal("conflict mutated archive")
	}
}
