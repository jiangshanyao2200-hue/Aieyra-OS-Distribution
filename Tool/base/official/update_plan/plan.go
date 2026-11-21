package updateplan

// 计划领域不依赖协议和 UI。每次操作只计算候选快照，调用方落盘成功后才采用。
import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"regexp"
	"strings"
	"time"
)

func planError(code, format string, args ...any) error {
	return &PlanError{Code: code, Message: fmt.Sprintf(format, args...)}
}

var planIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

func validEvidence(items []string) bool {
	if len(items) == 0 || len(items) > 16 {
		return false
	}
	for _, s := range items {
		if !planText(s, 2000) {
			return false
		}
	}
	return true
}
func ParsePlanUpdate(args string) (PlanUpdate, error) {
	var u PlanUpdate
	if len(args) > 256<<10 {
		return u, planError("invalid_arguments", "计划参数超过 256 KiB")
	}
	d := json.NewDecoder(strings.NewReader(args))
	d.DisallowUnknownFields()
	if err := d.Decode(&u); err != nil {
		return u, planError("invalid_arguments", "计划参数不完整：%v", err)
	}
	if d.Decode(new(any)) != io.EOF {
		return u, planError("invalid_arguments", "计划参数含额外 JSON")
	}
	var fields map[string]json.RawMessage
	_ = json.Unmarshal([]byte(args), &fields)
	_, u.RevisionSpecified = fields["expected_revision"]
	return u, nil
}
func ValidatePlan(p *PlanState) error {
	if p == nil || !planIDPattern.MatchString(p.ID) || p.Revision < 1 {
		return planError("invalid_arguments", "计划身份或版本无效")
	}
	if !planText(p.Objective, 1000) {
		return planError("invalid_arguments", "objective 需要填写不超过 1000 个字符的任务目标")
	}
	if !validEvidence(p.Acceptance) {
		return planError("invalid_arguments", "acceptance 需要 1–16 条可验证的验收标准，每条不超过 2000 个字符")
	}
	if p.Mode != "plan" && p.Mode != "goal" {
		return planError("invalid_arguments", "mode 只能为 plan 或 goal")
	}
	if len(p.Phases) < 1 || len(p.Phases) > maxPlanPhases || p.Mode == "plan" && len(p.Phases) != 1 {
		return planError("invalid_arguments", "Todo 只有一个 P 阶段；Phase 蓝图最多 %d 阶段", maxPlanPhases)
	}
	switch p.Status {
	case "active", "paused", "blocked", "awaiting_acceptance", "complete", "cancelled":
	default:
		return planError("invalid_transition", "计划状态无效")
	}
	ids := map[string]bool{}
	phases := map[string]bool{}
	count, running := 0, 0
	for _, ph := range p.Phases {
		if phases[ph.ID] || p.Mode == "plan" && ph.ID != "P" || !planIDPattern.MatchString(ph.ID) || !planText(ph.Title, 200) {
			return planError("invalid_arguments", "阶段编号或标题无效")
		}
		phases[ph.ID] = true
		if len(ph.Steps) == 0 {
			return planError("invalid_arguments", "阶段不能为空")
		}
		for _, s := range ph.Steps {
			count++
			if ids[s.ID] || !planIDPattern.MatchString(s.ID) || !planText(s.Text, 500) {
				return planError("invalid_arguments", "步骤 ID 重复或文字无效")
			}
			ids[s.ID] = true
			switch s.Status {
			case PlanRunning:
				running++
			case PlanCompleted:
				if !validEvidence(s.Evidence) {
					return planError("invalid_transition", "完成步骤 %s 需要证据", s.ID)
				}
			case PlanDeferred:
				if s.Resume == nil || s.Resume.StepID == "" && !planText(s.Resume.Detail, 1000) {
					return planError("invalid_transition", "暂缓步骤 %s 需要恢复条件", s.ID)
				}
			case PlanBlocked, PlanCancelled, PlanSuperseded:
				if !planText(s.Reason, 1000) {
					return planError("invalid_transition", "步骤 %s 需要原因", s.ID)
				}
			case PlanPending:
			default:
				return planError("invalid_transition", "步骤状态 %s 无效", s.Status)
			}
		}
	}
	if count > maxPlanSteps || running > 1 {
		return planError("invalid_arguments", "计划最多 %d 项，且同时只能有一个进行中的步骤", maxPlanSteps)
	}
	if err := validateDependencies(p); err != nil {
		return err
	}
	for _, ph := range p.Phases {
		for _, s := range ph.Steps {
			if s.ReplacedBy != "" {
				_, other := p.FindStep(s.ReplacedBy)
				if s.Status != PlanSuperseded || other == nil || other.Replaces != s.ID {
					return planError("dependency_conflict", "替换链不完整")
				}
			}
			if s.Replaces != "" {
				_, old := p.FindStep(s.Replaces)
				if old == nil || old.ReplacedBy != s.ID {
					return planError("dependency_conflict", "旧步骤不存在或替换关系不符")
				}
			}
			visited := map[string]bool{s.ID: true}
			cur := s
			for cur.Resume != nil && cur.Resume.StepID != "" {
				dep := cur.Resume.StepID
				if visited[dep] {
					return planError("dependency_conflict", "恢复依赖形成环")
				}
				visited[dep] = true
				_, next := p.FindStep(dep)
				if next == nil || cur.Resume.Status != PlanCompleted {
					return planError("dependency_conflict", "恢复条件引用无效")
				}
				if (next.Status == PlanCancelled || next.Status == PlanSuperseded) && cur.Status != PlanBlocked {
					return planError("dependency_conflict", "被取消的前置条件不能视作已满足；需替代或标记受阻")
				}
				cur = *next
			}
		}
	}
	if p.Status == "complete" {
		done, total, _ := p.Counts("")
		if done == 0 || done != total {
			return planError("invalid_transition", "仍有未完成工作，不能完成目标")
		}
		if len(p.Completion) != len(p.Acceptance) {
			return planError("invalid_transition", "缺少逐项验收结果")
		}
		for i, a := range p.Acceptance {
			if p.Completion[i].Criterion != a || !validEvidence(p.Completion[i].Evidence) {
				return planError("invalid_transition", "验收标准与证据不符")
			}
		}
	}
	return nil
}

func newPlanID() (string, error) {
	var id [12]byte
	if _, err := rand.Read(id[:]); err != nil {
		return "", err
	}
	return "plan_" + hex.EncodeToString(id[:]), nil
}
func initialSteps(steps []PlanStep) error {
	for _, s := range steps {
		if s.Status != PlanPending && s.Status != PlanRunning || s.Replaces != "" || s.ReplacedBy != "" || len(s.Revisions) > 0 || len(s.Evidence) > 0 || s.Resume != nil {
			return planError("invalid_arguments", "新步骤只能为 pending/in_progress，不得伪造历史")
		}
	}
	return nil
}
func ApplyPlanUpdate(old *PlanState, u PlanUpdate) (*PlanTransition, error) {
	next := ClonePlan(old)
	changes := []PlanChange{}
	if u.Action == "create" {
		if old != nil && old.Status != "complete" && old.Status != "cancelled" {
			return nil, planError("invalid_transition", "当前计划尚未结束，请更新已有计划")
		}
		if u.ExpectedRevision != 0 || u.PlanID != "" || len(u.Changes) > 0 || len(u.Completion) > 0 {
			return nil, planError("invalid_arguments", "创建计划使用 expected_revision=0，不接受已有版本或更新操作")
		}
		id, err := newPlanID()
		if err != nil {
			return nil, err
		}
		next = &PlanState{ID: id, Mode: u.Mode, Objective: u.Objective, Acceptance: u.Acceptance, Revision: 1, Status: "active", Phases: u.Phases}
		for _, ph := range next.Phases {
			if len(ph.Revisions) > 0 {
				return nil, planError("invalid_arguments", "不能伪造阶段修订")
			}
			if err = initialSteps(ph.Steps); err != nil {
				return nil, err
			}
		}
		changes = append(changes, PlanChange{Kind: "create", After: u.Objective})
	} else {
		if old == nil {
			return nil, planError("plan_missing", "当前没有计划，请先使用 action=create")
		}
		if u.PlanID != old.ID {
			return nil, planError("plan_id_mismatch", "plan_id 不匹配，请使用返回快照中的计划 ID")
		}
		if u.ExpectedRevision != old.Revision {
			return nil, planError("revision_conflict", "计划版本不一致，请读取返回的最新快照后更新")
		}
		if old.Status == "complete" || old.Status == "cancelled" {
			return nil, planError("invalid_transition", "已结束计划不可改写，请为新目标建立新计划")
		}
		if u.Mode != "" || u.Objective != "" || len(u.Acceptance) > 0 || len(u.Phases) > 0 {
			return nil, planError("invalid_arguments", "更新执行路径不能改写用户目标与验收标准")
		}
		switch u.Action {
		case "update":
			if len(u.Changes) < 1 || len(u.Changes) > 32 || len(u.Completion) > 0 {
				return nil, planError("invalid_arguments", "更新需要 1–32 项变更")
			}
			for _, op := range u.Changes {
				ch, err := applyOperation(next, op, old.Revision+1)
				if err != nil {
					return nil, err
				}
				changes = append(changes, ch...)
			}
		case "complete":
			if len(u.Changes) > 32 {
				return nil, planError("invalid_arguments", "完成最多合并 32 项状态更新")
			}
			for _, op := range u.Changes {
				if op.Op != "set_status" || op.Status != PlanCompleted {
					return nil, planError("invalid_arguments", "complete 只可合并 set_status completed 与证据；路径改写请先用 update")
				}
				ch, err := applyOperation(next, op, old.Revision+1)
				if err != nil {
					return nil, err
				}
				changes = append(changes, ch...)
			}
			next.Status = "complete"
			next.Completion = u.Completion
			changes = append(changes, PlanChange{Kind: "complete", After: next.Objective})
		default:
			return nil, planError("invalid_arguments", "action 只能为 create/update/complete（收到 %q）；推进步骤用 update+changes，全部完成用 complete+completion", u.Action)
		}
		resumeEligible(next, &changes)
		if reflect.DeepEqual(old, next) {
			return nil, nil
		}
		next.Revision = old.Revision + 1
	}
	if next.Status == "active" || next.Status == "awaiting_acceptance" {
		done, total, _ := next.Counts("")
		if done == total && done > 0 {
			next.Status = "awaiting_acceptance"
		} else if next.Status == "awaiting_acceptance" {
			next.Status = "active"
		}
	}
	if err := ValidatePlan(next); err != nil {
		return nil, err
	}
	return &PlanTransition{Before: ClonePlan(old), State: ClonePlan(next), Changes: changes, At: time.Now().UTC().Format(time.RFC3339Nano)}, nil
}
func phase(p *PlanState, id string) *PlanPhase {
	for i := range p.Phases {
		if p.Phases[i].ID == id {
			return &p.Phases[i]
		}
	}
	return nil
}
func insertPlanStep(ph *PlanPhase, s PlanStep, before, after string) error {
	if before != "" && after != "" {
		return planError("invalid_arguments", "插入位置不能同时 before/after")
	}
	at := len(ph.Steps)
	if before != "" || after != "" {
		at = -1
		for i, x := range ph.Steps {
			if x.ID == before {
				at = i
			}
			if x.ID == after {
				at = i + 1
			}
		}
		if at < 0 {
			return planError("invalid_arguments", "插入锚点不在目标阶段")
		}
	}
	ph.Steps = append(ph.Steps, PlanStep{})
	copy(ph.Steps[at+1:], ph.Steps[at:])
	ph.Steps[at] = s
	return nil
}
func applyOperation(p *PlanState, o PlanOperation, revision int) ([]PlanChange, error) {
	if !planText(o.Reason, 1000) {
		return nil, planError("invalid_arguments", "每次修改需说明原因：可在顶层 reason 统一说明，或为每条 changes（包括 set_status）提供 reason")
	}
	ph, s := p.FindStep(o.StepID)
	ch := PlanChange{Kind: o.Op, StepID: o.StepID, PhaseID: o.PhaseID, Reason: o.Reason}
	switch o.Op {
	case "revise", "replace", "set_status", "set_dependencies", "move":
		if s == nil {
			return nil, planError("invalid_arguments", "步骤 %s 不存在", o.StepID)
		}
		if s.Status == PlanCompleted || s.Status == PlanCancelled || s.Status == PlanSuperseded {
			return nil, planError("invalid_transition", "已结束步骤不可改写，需插入新的后续工作")
		}
		ch.PhaseID = ph.ID
		ch.Before = s.Text
	}
	switch o.Op {
	case "revise":
		if !planText(o.Text, 500) {
			return nil, planError("invalid_arguments", "步骤文字无效")
		}
		if o.Text == s.Text {
			return nil, nil
		}
		s.Revisions = append(s.Revisions, PlanRevision{Before: s.Text, After: o.Text, Reason: o.Reason, Revision: revision})
		s.Text = o.Text
		ch.After = o.Text
	case "insert":
		ph = phase(p, o.PhaseID)
		if ph == nil || o.NewStep == nil {
			return nil, planError("invalid_arguments", "缺少目标阶段或新步骤")
		}
		if err := initialSteps([]PlanStep{*o.NewStep}); err != nil {
			return nil, err
		}
		if err := insertPlanStep(ph, *o.NewStep, o.BeforeID, o.AfterID); err != nil {
			return nil, err
		}
		ch.StepID = o.NewStep.ID
		ch.After = o.NewStep.Text
	case "replace":
		if o.NewStep == nil {
			return nil, planError("invalid_arguments", "缺少替代步骤")
		}
		if _, existing := p.FindStep(o.NewStep.ID); existing != nil {
			return nil, planError("replacement_id_conflict", "replace 的 new_step.id 必须使用新的唯一 ID；旧项仍保留在历史中。只修改文字请使用 revise")
		}
		if err := initialSteps([]PlanStep{*o.NewStep}); err != nil {
			return nil, err
		}
		fresh := *o.NewStep
		if fresh.DependsOn == nil {
			fresh.DependsOn = append([]string(nil), s.DependsOn...)
		}
		fresh.Replaces = s.ID
		s.Status = PlanSuperseded
		s.ReplacedBy = fresh.ID
		s.Reason = o.Reason
		if err := insertPlanStep(ph, fresh, "", s.ID); err != nil {
			return nil, err
		}
		ch.After = fresh.Text
		for i := range p.Phases {
			for j := range p.Phases[i].Steps {
				x := &p.Phases[i].Steps[j]
				for k, dep := range x.DependsOn {
					if dep == o.StepID {
						x.DependsOn[k] = fresh.ID
					}
				}
				if x.Resume != nil && x.Resume.StepID == o.StepID {
					x.Resume.StepID = fresh.ID
				}
			}
		}
	case "set_dependencies":
		if reflect.DeepEqual(s.DependsOn, o.DependsOn) {
			return nil, nil
		}
		ch.Before = strings.Join(s.DependsOn, ",")
		s.DependsOn = append([]string(nil), o.DependsOn...)
		ch.After = strings.Join(s.DependsOn, ",")
	case "set_status":
		if (o.Status == PlanRunning || o.Status == PlanCompleted) && !p.DependenciesComplete(s) {
			return nil, planError("dependency_conflict", "前置条件尚未全部完成")
		}
		// 有明确前置时，不能仅改状态就绕开恢复条件。
		if (o.Status == PlanRunning || o.Status == PlanCompleted || o.Status == PlanPending) && s.Resume != nil && s.Resume.StepID != "" {
			_, dep := p.FindStep(s.Resume.StepID)
			if dep == nil || dep.Status != PlanCompleted {
				return nil, planError("dependency_conflict", "前置条件尚未完成")
			}
		}
		if s.Status == o.Status && s.Reason == o.Reason && reflect.DeepEqual(s.Evidence, o.Evidence) && reflect.DeepEqual(s.Resume, o.Resume) {
			return nil, nil
		}
		if o.Status == PlanSuperseded {
			return nil, planError("invalid_transition", "superseded 只能由 replace 产生")
		}
		s.Status = o.Status
		s.Reason = o.Reason
		s.Evidence = o.Evidence
		s.Resume = o.Resume
		ch.Status = o.Status
		ch.After = s.Text
	case "move":
		target := phase(p, o.PhaseID)
		if target == nil {
			return nil, planError("invalid_arguments", "目标阶段不存在")
		}
		moving := *s
		if len(ph.Steps) == 1 && ph.ID != target.ID {
			return nil, planError("invalid_transition", "移动不能留下空阶段")
		}
		for i := range ph.Steps {
			if ph.Steps[i].ID == s.ID {
				ph.Steps = append(ph.Steps[:i], ph.Steps[i+1:]...)
				break
			}
		}
		if err := insertPlanStep(target, moving, o.BeforeID, o.AfterID); err != nil {
			return nil, err
		}
		ch.PhaseID = o.PhaseID
		ch.After = moving.Text
	case "phase_add":
		if p.Mode != "goal" || len(p.Phases) >= maxPlanPhases || phase(p, o.PhaseID) != nil {
			return nil, planError("invalid_arguments", "Phase 蓝图最多 %d 个不同阶段", maxPlanPhases)
		}
		if err := initialSteps(o.Steps); err != nil {
			return nil, err
		}
		p.Phases = append(p.Phases, PlanPhase{ID: o.PhaseID, Title: o.Title, Steps: o.Steps})
		ch.After = o.Title
	case "phase_revise":
		ph = phase(p, o.PhaseID)
		if ph == nil || !planText(o.Title, 200) {
			return nil, planError("invalid_arguments", "阶段或标题无效")
		}
		if ph.Title == o.Title {
			return nil, nil
		}
		ch.Before = ph.Title
		ch.After = o.Title
		ph.Revisions = append(ph.Revisions, PlanRevision{Before: ph.Title, After: o.Title, Reason: o.Reason, Revision: revision})
		ph.Title = o.Title
	case "set_lifecycle":
		switch o.Status {
		case "active", "paused", "blocked", "cancelled":
		default:
			return nil, planError("invalid_transition", "不支持的生命周期变更")
		}
		p.Status = o.Status
		p.Reason = o.Reason
		ch.Status = o.Status
	default:
		return nil, planError("invalid_arguments", "未知计划操作 %q", o.Op)
	}
	return []PlanChange{ch}, nil
}
func resumeEligible(p *PlanState, changes *[]PlanChange) {
	for i := range p.Phases {
		for j := range p.Phases[i].Steps {
			s := &p.Phases[i].Steps[j]
			if s.Status != PlanDeferred || s.Resume == nil || s.Resume.StepID == "" {
				continue
			}
			_, dep := p.FindStep(s.Resume.StepID)
			if dep != nil && dep.Status == PlanCompleted && p.DependenciesComplete(s) {
				s.Status = PlanPending
				s.Resume = nil
				s.Reason = "前置条件已完成"
				*changes = append(*changes, PlanChange{Kind: "resume", StepID: s.ID, PhaseID: p.Phases[i].ID, After: s.Text, Reason: s.Reason})
			}
		}
	}
}
