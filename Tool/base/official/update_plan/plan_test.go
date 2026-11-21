package updateplan

import (
	"encoding/json"
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

func TestCreatePlanIdentifiesMissingAcceptance(t *testing.T) {
	u := samplePlanUpdate()
	u.Acceptance = nil
	if result, err := ApplyPlanUpdate(nil, u); result != nil || err == nil || !strings.Contains(err.Error(), "acceptance") {
		t.Fatalf("missing acceptance returned result=%v error=%v", result, err)
	}
	u.Acceptance = []string{"结果可以独立复核"}
	if result, err := ApplyPlanUpdate(nil, u); err != nil || result.State.Revision != 1 {
		t.Fatalf("corrected creation returned result=%v error=%v", result, err)
	}
}
func applyPlan(t *testing.T, p *PlanState, ops ...PlanOperation) *PlanTransition {
	t.Helper()
	tr, err := ApplyPlanUpdate(p, PlanUpdate{Action: "update", PlanID: p.ID, ExpectedRevision: p.Revision, Changes: ops})
	if err != nil {
		t.Fatal(err)
	}
	return tr
}
func TestPlanEditsReplacementAndRollback(t *testing.T) {
	p := initialPlan(t)
	original := ClonePlan(p)
	tr := applyPlan(t, p, PlanOperation{Op: "revise", StepID: "p1", Text: "比较布局与字体", Reason: "聚焦字体差异"})
	_, s := tr.State.FindStep("p1")
	if s.Revisions[0].Before != "比较布局与文字" || s.Revisions[0].After != s.Text || tr.State.Revision != 2 || !reflect.DeepEqual(p, original) {
		t.Fatal("局部修改丢失历史或污染旧版本")
	}
	tr = applyPlan(t, tr.State, PlanOperation{Op: "replace", StepID: "p1", NewStep: &PlanStep{ID: "p3", Text: "按可读性评价两种布局", Status: PlanRunning}, Reason: "原比较方法不足"})
	_, old := tr.State.FindStep("p1")
	_, fresh := tr.State.FindStep("p3")
	if old.Status != PlanSuperseded || old.ReplacedBy != fresh.ID || fresh.Replaces != old.ID {
		t.Fatal("整条替换失去可追溯关系")
	}
	bad := PlanUpdate{Action: "update", PlanID: p.ID, ExpectedRevision: p.Revision, Changes: []PlanOperation{{Op: "revise", StepID: "p1", Text: "不应提交", Reason: "先修改"}, {Op: "replace", StepID: "missing", Reason: "非法目标"}}}
	if _, err := ApplyPlanUpdate(p, bad); err == nil || !reflect.DeepEqual(p, original) {
		t.Fatal("无效批次没有原子回退")
	}
}
func TestPlanDeferralReplacementAndReturn(t *testing.T) {
	p := initialPlan(t)
	tr := applyPlan(t, p, PlanOperation{Op: "insert", PhaseID: "P", BeforeID: "p1", NewStep: &PlanStep{ID: "pre", Text: "确认字号", Status: PlanRunning}, Reason: "先补齐前提"}, PlanOperation{Op: "set_status", StepID: "p1", Status: PlanDeferred, Resume: &ResumeCondition{StepID: "pre", Status: PlanCompleted}, Reason: "等待字号"})
	tr = applyPlan(t, tr.State, PlanOperation{Op: "replace", StepID: "pre", NewStep: &PlanStep{ID: "pre2", Text: "确认实际字号与行高", Status: PlanRunning}, Reason: "需同时考虑行高"})
	_, wait := tr.State.FindStep("p1")
	if wait.Resume.StepID != "pre2" {
		t.Fatal("替换前置后依赖没有跟随")
	}
	tr = applyPlan(t, tr.State, PlanOperation{Op: "set_status", StepID: "pre2", Status: PlanCompleted, Evidence: []string{"用户提供了字号和行高"}, Reason: "信息已齐"})
	_, wait = tr.State.FindStep("p1")
	if wait.Status != PlanPending || wait.Resume != nil {
		t.Fatal("未恢复暂缓项")
	}
}
func TestPlanRejectsCyclesConflictAndFalseCompletion(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*PlanUpdate)
	}{
		{"phase-limit", func(u *PlanUpdate) { u.Mode = "goal"; u.Phases = make([]PlanPhase, maxPlanPhases+1) }},
		{"duplicate-id", func(u *PlanUpdate) { u.Phases[0].Steps[1].ID = "p1" }},
		{"two-active", func(u *PlanUpdate) { u.Phases[0].Steps[1].Status = PlanRunning }},
		{"control-text", func(u *PlanUpdate) { u.Objective = "目标\x1b[2J" }},
		{"fabricated-history", func(u *PlanUpdate) { u.Phases[0].Steps[0].Revisions = []PlanRevision{{Before: "伪造"}} }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			u := samplePlanUpdate()
			tc.mutate(&u)
			if _, err := ApplyPlanUpdate(nil, u); err == nil {
				t.Fatal("无效计划被接受")
			}
		})
	}
	p := initialPlan(t)
	if _, err := ApplyPlanUpdate(p, PlanUpdate{Action: "complete", PlanID: p.ID, ExpectedRevision: p.Revision, Completion: []AcceptanceResult{{Criterion: p.Acceptance[0], Evidence: []string{"自称完成"}}}}); err == nil {
		t.Fatal("未完成任务被错误完成")
	}
	cycle := []PlanOperation{{Op: "set_status", StepID: "p1", Status: PlanDeferred, Resume: &ResumeCondition{StepID: "p2", Status: PlanCompleted}, Reason: "等待"}, {Op: "set_status", StepID: "p2", Status: PlanDeferred, Resume: &ResumeCondition{StepID: "p1", Status: PlanCompleted}, Reason: "等待"}}
	if _, err := ApplyPlanUpdate(p, PlanUpdate{Action: "update", PlanID: p.ID, ExpectedRevision: p.Revision, Changes: cycle}); err == nil {
		t.Fatal("循环依赖被接受")
	}
	if _, err := ApplyPlanUpdate(p, PlanUpdate{Action: "update", PlanID: p.ID, ExpectedRevision: 999, Changes: cycle}); err == nil {
		t.Fatal("旧版本被覆盖")
	}
}
func TestPlanCompletionRequiresExactAcceptanceAndEvidence(t *testing.T) {
	p := initialPlan(t)
	tr := applyPlan(t, p, PlanOperation{Op: "set_status", StepID: "p1", Status: PlanCompleted, Evidence: []string{"已经比较字号与行高"}, Reason: "比较完成"}, PlanOperation{Op: "set_status", StepID: "p2", Status: PlanCompleted, Evidence: []string{"已给出两种方案的结论"}, Reason: "结论完成"})
	p = tr.State
	if p.Status != "awaiting_acceptance" {
		t.Fatal("没有进入验收状态")
	}
	u := PlanUpdate{Action: "complete", PlanID: p.ID, ExpectedRevision: p.Revision, Completion: []AcceptanceResult{{Criterion: "偷偷降低标准", Evidence: []string{"任意"}}}}
	if _, err := ApplyPlanUpdate(p, u); err == nil {
		t.Fatal("验收标准被替换")
	}
	u.Completion[0].Criterion = p.Acceptance[0]
	tr, err := ApplyPlanUpdate(p, u)
	if err != nil || tr.State.Status != "complete" {
		t.Fatal(err)
	}
}

func TestPlanFinalUpdatesAndAcceptanceCommitTogether(t *testing.T) {
	p := initialPlan(t)
	before := ClonePlan(p)
	u := PlanUpdate{Action: "complete", PlanID: p.ID, ExpectedRevision: p.Revision,
		Changes: []PlanOperation{
			{Op: "set_status", StepID: "p1", Status: PlanCompleted, Reason: "核对完成", Evidence: []string{"布局已比较"}},
			{Op: "set_status", StepID: "p2", Status: PlanCompleted, Reason: "结论完成", Evidence: []string{"结论已记录"}},
		}, Completion: []AcceptanceResult{{Criterion: p.Acceptance[0], Evidence: []string{"比较及结论已核实"}}}}
	tr, err := ApplyPlanUpdate(p, u)
	if err != nil || tr.State.Status != "complete" || tr.State.Revision != p.Revision+1 {
		t.Fatalf("%+v %v", tr, err)
	}
	for _, mutation := range []func(*PlanUpdate){
		func(u *PlanUpdate) { u.Changes[1].Evidence = nil },
		func(u *PlanUpdate) { u.Completion[0].Criterion = "降低标准" },
		func(u *PlanUpdate) { u.Changes[1].Op = "revise"; u.Changes[1].Text = "改掉目标" },
		func(u *PlanUpdate) { u.ExpectedRevision-- },
	} {
		b, _ := json.Marshal(u)
		var bad PlanUpdate
		json.Unmarshal(b, &bad)
		mutation(&bad)
		if tr, err := ApplyPlanUpdate(p, bad); err == nil || tr != nil {
			t.Fatalf("invalid final batch accepted: %+v", tr)
		}
		if !reflect.DeepEqual(p, before) {
			t.Fatal("rejected final batch mutated original state")
		}
	}
}
func TestPlanNoopAndUnknownArguments(t *testing.T) {
	p := initialPlan(t)
	tr := applyPlan(t, p, PlanOperation{Op: "revise", StepID: "p1", Text: p.Phases[0].Steps[0].Text, Reason: "没有变化"})
	if tr != nil {
		t.Fatal("无变化也增加版本")
	}
	if _, err := ParsePlanUpdate(`{"action":"create","expected_revision":0,"unknown":true}`); err == nil {
		t.Fatal("未知字段未拒绝")
	}
}

func TestPlanCannotResumeBeforePrerequisite(t *testing.T) {
	p := initialPlan(t)
	tr := applyPlan(t, p, PlanOperation{Op: "set_status", StepID: "p1", Status: PlanDeferred, Resume: &ResumeCondition{StepID: "p2", Status: PlanCompleted}, Reason: "先完成结论前提"})
	for _, status := range []string{PlanRunning, PlanPending, PlanCompleted} {
		_, err := ApplyPlanUpdate(tr.State, PlanUpdate{Action: "update", PlanID: p.ID, ExpectedRevision: tr.State.Revision, Changes: []PlanOperation{{Op: "set_status", StepID: "p1", Status: status, Evidence: []string{"不可冒充满足前置"}, Reason: "试图跳过前置"}}})
		if err == nil {
			t.Fatalf("unsatisfied prerequisite allowed %s", status)
		}
	}
}
func TestPlanMovePhaseAndCancelledDependency(t *testing.T) {
	u := samplePlanUpdate()
	u.Mode = "goal"
	u.Phases[0].ID = "A"
	u.Phases = append(u.Phases, PlanPhase{ID: "B", Title: "结论", Steps: []PlanStep{{ID: "b1", Text: "后续结论", Status: PlanPending}}})
	tr, err := ApplyPlanUpdate(nil, u)
	if err != nil {
		t.Fatal(err)
	}
	tr = applyPlan(t, tr.State, PlanOperation{Op: "move", StepID: "p2", PhaseID: "B", BeforeID: "b1", Reason: "属于结论阶段"}, PlanOperation{Op: "phase_revise", PhaseID: "B", Title: "最终结论", Reason: "说明阶段目标"}, PlanOperation{Op: "phase_add", PhaseID: "C", Title: "复核", Steps: []PlanStep{{ID: "c1", Text: "检查结论", Status: PlanPending}}, Reason: "补充复核"})
	if tr.State.Phases[1].Steps[0].ID != "p2" || len(tr.State.Phases[1].Revisions) != 1 || len(tr.State.Phases) != 3 {
		t.Fatal("move/phase history lost")
	}
	tr = applyPlan(t, tr.State, PlanOperation{Op: "set_status", StepID: "p1", Status: PlanDeferred, Resume: &ResumeCondition{StepID: "p2", Status: PlanCompleted}, Reason: "等待前提"})
	_, err = ApplyPlanUpdate(tr.State, PlanUpdate{Action: "update", PlanID: tr.State.ID, ExpectedRevision: tr.State.Revision, Changes: []PlanOperation{{Op: "set_status", StepID: "p2", Status: PlanCancelled, Reason: "取消前提"}}})
	if err == nil {
		t.Fatal("cancelled prerequisite accepted without blocking dependent")
	}
}

func TestPlanCurrentPrefersRunnableOverDeferred(t *testing.T) {
	p := initialPlan(t)
	tr := applyPlan(t, p, PlanOperation{Op: "set_status", StepID: "p1", Status: PlanDeferred, Resume: &ResumeCondition{StepID: "p2", Status: PlanCompleted}, Reason: "先完成前提"})
	_, step := tr.State.Current()
	if step == nil || step.ID != "p2" {
		t.Fatal("deferred work hides runnable step")
	}
}
