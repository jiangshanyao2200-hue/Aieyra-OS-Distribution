// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestPlanPhaseBlueprintCapacityAndAliases; TestPlanMultiplePrerequisitesBlockedWorkAndReplacement; TestPlanDependencyEditsAreAtomicAndDetectMixedCycles
// Impact: python -B scripts/code-atlas.py show Core/plan_dependencies_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"fmt"
	"strings"
	"testing"
)

func TestPlanPhaseBlueprintCapacityAndAliases(t *testing.T) {
	u := samplePlanUpdate()
	u.Mode = "phase"
	u.Phases = nil
	for i := 0; i < maxPlanPhases; i++ {
		u.Phases = append(u.Phases, PlanPhase{ID: fmt.Sprintf("milestone_%d", i), Title: "阶段", Steps: []PlanStep{{ID: fmt.Sprintf("s%d", i), Text: "验收"}}})
	}
	u, err := (&PlanEngine{}).adaptUpdate(u)
	if err != nil || u.Mode != "goal" {
		t.Fatalf("%+v %v", u, err)
	}
	tr, err := ApplyPlanUpdate(nil, u)
	if err != nil {
		t.Fatal(err)
	}
	if len(tr.State.Phases) != 32 {
		t.Fatal("blueprint truncated")
	}
	u.Phases = append(u.Phases, PlanPhase{ID: "extra", Title: "额外", Steps: []PlanStep{{ID: "extra", Text: "任务", Status: PlanPending}}})
	if _, err := ApplyPlanUpdate(nil, u); err == nil {
		t.Fatal("unbounded phases")
	}
}

func TestPlanMultiplePrerequisitesBlockedWorkAndReplacement(t *testing.T) {
	u := samplePlanUpdate()
	u.Mode = "goal"
	u.Phases[0].ID = "build"
	u.Phases[0].Steps = []PlanStep{
		{ID: "deliver", Text: "交付", Status: PlanPending, DependsOn: []string{"a", "b"}},
		{ID: "a", Text: "任务 A", Status: PlanPending},
		{ID: "b", Text: "任务 B", Status: PlanPending},
	}
	tr, err := ApplyPlanUpdate(nil, u)
	if err != nil {
		t.Fatal(err)
	}
	p := tr.State
	_, current := p.Current()
	if current.ID != "a" {
		t.Fatal("dependent work chosen first")
	}
	tr = applyPlan(t, p, PlanOperation{Op: "set_status", StepID: "a", Status: PlanBlocked, Reason: "外部等待"}, PlanOperation{Op: "set_lifecycle", Status: "blocked", Reason: "外部等待"})
	p = tr.State
	if goalCompletionBoundary(&PlanEngine{State: p}) == "" {
		t.Fatal("independent work discarded")
	}
	_, current = p.Current()
	if current.ID != "b" {
		t.Fatal("blocked task prevents independent task")
	}
	tr = applyPlan(t, p, PlanOperation{Op: "replace", StepID: "a", NewStep: &PlanStep{ID: "a2", Text: "替代方案", Status: PlanPending}, Reason: "可执行替代"})
	p = tr.State
	_, deliver := p.FindStep("deliver")
	if deliver.DependsOn[0] != "a2" {
		t.Fatal("dependency not redirected")
	}
	if _, err := ApplyPlanUpdate(p, PlanUpdate{Action: "update", PlanID: p.ID, ExpectedRevision: p.Revision, Changes: []PlanOperation{{Op: "set_status", StepID: "deliver", Status: PlanCompleted, Reason: "跳步", Evidence: []string{"伪证据"}}}}); err == nil {
		t.Fatal("prerequisites bypassed")
	}
	for _, id := range []string{"a2", "b"} {
		p = applyPlan(t, p, PlanOperation{Op: "set_status", StepID: id, Status: PlanCompleted, Reason: "完成", Evidence: []string{"独立验证通过"}}).State
	}
	_, current = p.Current()
	if current == nil || current.ID != "deliver" {
		t.Fatal("dependent work never becomes eligible")
	}
	p.Status = "paused"
	if goalCompletionBoundary(&PlanEngine{State: p}) != "" {
		t.Fatal("explicit pause ignored")
	}
}

func TestPlanDependencyEditsAreAtomicAndDetectMixedCycles(t *testing.T) {
	p := initialPlan(t)
	p = applyPlan(t, p, PlanOperation{Op: "set_status", StepID: "p1", Status: PlanPending, Reason: "调整顺序"}).State
	for _, deps := range [][]string{{"missing"}, {"p2", "p2"}, {"p1"}} {
		_, err := ApplyPlanUpdate(p, PlanUpdate{Action: "update", PlanID: p.ID, ExpectedRevision: p.Revision, Changes: []PlanOperation{{Op: "set_dependencies", StepID: "p1", DependsOn: deps, Reason: "依赖"}}})
		if err == nil {
			t.Fatalf("accepted invalid edges %v", deps)
		}
	}
	p = applyPlan(t, p, PlanOperation{Op: "set_dependencies", StepID: "p1", DependsOn: []string{"p2"}, Reason: "依赖"}).State
	_, err := ApplyPlanUpdate(p, PlanUpdate{Action: "update", PlanID: p.ID, ExpectedRevision: p.Revision, Changes: []PlanOperation{{Op: "set_status", StepID: "p2", Status: PlanDeferred, Resume: &ResumeCondition{StepID: "p1", Status: PlanCompleted}, Reason: "循环"}}})
	if err == nil || !strings.Contains(err.Error(), "环") {
		t.Fatalf("mixed cycle accepted: %v", err)
	}
	_, s := p.FindStep("p2")
	if s.Status != PlanPending {
		t.Fatal("rejected change mutated state")
	}
}
