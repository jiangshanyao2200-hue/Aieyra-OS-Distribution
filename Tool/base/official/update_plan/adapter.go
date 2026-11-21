package updateplan

import (
	"fmt"
	"strings"
)

// 容易填写的外层适配为原有严格领域操作；不替用户猜验收标准或完成证据。
func planStatusAlias(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "todo", "not_started":
		return PlanPending
	case "running", "in-progress", "in progress":
		return PlanRunning
	case "done", "complete":
		return PlanCompleted
	case "canceled":
		return PlanCancelled
	default:
		return status
	}
}
func planActionAlias(action string, u PlanUpdate) string {
	switch a := strings.ToLower(strings.TrimSpace(action)); a {
	case "create", "update", "complete":
		return a
	case "new", "start", "init":
		return "create"
	case "edit", "modify", "change", "progress", "set_status", "add", "add_step", "add_steps":
		return "update"
	case "finish", "finished", "done", "completed", "close":
		return "complete"
	case "":
		// 只给了变更或验收结果时，动作是唯一的；快照格式（summary/plan）另行适配。
		if u.Summary == "" && u.SnapshotSteps == nil {
			if len(u.Completion) > 0 {
				return "complete"
			}
			if len(u.Changes) > 0 {
				return "update"
			}
		}
		return ""
	default:
		return action
	}
}
func (e *adapter) adaptUpdate(u PlanUpdate) (PlanUpdate, error) {
	switch u.Mode {
	case "todo":
		u.Mode = "plan"
	case "phase":
		u.Mode = "goal"
	}
	u.Action = planActionAlias(u.Action, u)
	if u.Summary != "" || u.SnapshotSteps != nil {
		var err error
		u, err = e.adaptSnapshot(u)
		if err != nil {
			return u, err
		}
	}
	if u.Action == "create" {
		if u.Mode == "" {
			u.Mode = "plan"
		}
		if len(u.Steps) > 0 {
			if len(u.Phases) > 0 || u.Mode != "plan" {
				return u, planError("invalid_arguments", "简写 steps 只用于单阶段 Plan；Goal 使用 phases")
			}
			u.Phases = []PlanPhase{{ID: "P", Title: "执行计划", Steps: u.Steps}}
			u.Steps = nil
		}
		used := map[string]bool{}
		for _, ph := range u.Phases {
			for _, s := range ph.Steps {
				if s.ID != "" {
					used[s.ID] = true
				}
			}
		}
		for i := range u.Phases {
			ph := &u.Phases[i]
			if u.Mode == "plan" && len(u.Phases) == 1 {
				if ph.ID == "" {
					ph.ID = "P"
				}
				if ph.Title == "" {
					ph.Title = "执行计划"
				}
			}
			for j := range ph.Steps {
				s := &ph.Steps[j]
				if s.ID == "" {
					for n := j + 1; ; n++ {
						id := fmt.Sprintf("%s%d", strings.ToLower(ph.ID), n)
						if !used[id] {
							s.ID = id
							used[id] = true
							break
						}
					}
				}
				if s.Status == "" {
					s.Status = PlanPending
				}
				s.Status = planStatusAlias(s.Status)
			}
		}
	} else {
		if len(u.Steps) > 0 {
			return u, planError("invalid_arguments", "更新请使用 changes，不能用 steps 覆盖现有计划")
		}
		if !u.RevisionSpecified {
			if !e.SnapshotBound {
				return u, planError("revision_required", "缺少请求开始时的计划快照，请显式提供 expected_revision")
			}
			u.ExpectedRevision = 0
			if e.RequestSnapshot != nil {
				u.ExpectedRevision = e.RequestSnapshot.Revision
				if u.PlanID == "" {
					u.PlanID = e.RequestSnapshot.ID
				}
			}
		}
		used := map[string]bool{}
		if e.State != nil {
			for _, ph := range e.State.Phases {
				for _, s := range ph.Steps {
					used[s.ID] = true
				}
			}
		}
		assign := func(s *PlanStep, phase string) {
			if s.ID == "" {
				if phase == "" {
					phase = "p"
				}
				for n := 1; ; n++ {
					id := fmt.Sprintf("%s%d", strings.ToLower(phase), n)
					if !used[id] {
						s.ID = id
						break
					}
				}
			}
			used[s.ID] = true
			if s.Status == "" {
				s.Status = PlanPending
			}
			s.Status = planStatusAlias(s.Status)
		}
		for i := range u.Changes {
			op := &u.Changes[i]
			if op.Reason == "" {
				op.Reason = u.Reason
			}
			op.Status = planStatusAlias(op.Status)
			for _, ref := range []*string{&op.StepID, &op.BeforeID, &op.AfterID} {
				if *ref == "" {
					continue
				}
				id, err := resolvePlanReference(e.State, *ref)
				if err != nil {
					return u, err
				}
				*ref = id
			}
			if op.Resume != nil {
				op.Resume.Status = planStatusAlias(op.Resume.Status)
				if op.Resume.StepID != "" {
					id, err := resolvePlanReference(e.State, op.Resume.StepID)
					if err != nil {
						return u, err
					}
					op.Resume.StepID = id
				}
			}
			if op.NewStep != nil {
				phase := op.PhaseID
				if phase == "" && e.State != nil {
					if ph, _ := e.State.FindStep(op.StepID); ph != nil {
						phase = ph.ID
					}
				}
				assign(op.NewStep, phase)
			}
			for j := range op.Steps {
				assign(&op.Steps[j], op.PhaseID)
			}
		}
	}
	return u, nil
}
func resolvePlanReference(p *PlanState, ref string) (string, error) {
	if p == nil {
		return ref, nil
	}
	if _, step := p.FindStep(ref); step != nil {
		return ref, nil
	}
	var candidates []string
	for _, ph := range p.Phases {
		for _, step := range ph.Steps {
			if step.Text == ref {
				candidates = append(candidates, step.ID)
			}
		}
	}
	if len(candidates) == 1 {
		return candidates[0], nil
	}
	if len(candidates) > 1 {
		return "", planError("ambiguous_step", "步骤文字不唯一，请使用候选 ID：%s", strings.Join(candidates, ", "))
	}
	return ref, nil
}

// AdaptUpdate uses the host-captured request snapshot; it never persists state.
func AdaptUpdate(state, requestSnapshot *PlanState, snapshotBound bool, update PlanUpdate) (PlanUpdate, error) {
	return (&adapter{State: state, RequestSnapshot: requestSnapshot, SnapshotBound: snapshotBound}).adaptUpdate(update)
}

type adapter struct {
	State, RequestSnapshot *PlanState
	SnapshotBound          bool
}
