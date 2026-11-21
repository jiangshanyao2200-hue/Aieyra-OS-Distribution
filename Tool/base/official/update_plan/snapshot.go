package updateplan

// 一些模型连接使用完整步骤快照；适配后仍走同一CAS、历史和验收领域。
func (e *adapter) adaptSnapshot(u PlanUpdate) (PlanUpdate, error) {
	if !planText(u.Summary, 1000) || len(u.SnapshotSteps) < 1 || len(u.SnapshotSteps) > 16 || u.Action != "" || u.PlanID != "" || u.Mode != "" || u.Objective != "" || len(u.Acceptance)+len(u.Steps)+len(u.Phases)+len(u.Changes)+len(u.Completion) != 0 || u.Reason != "" {
		return u, planError("invalid_arguments", "快照格式仅使用 summary、plan、可选expected_revision；plan为1–16项{id?,description,status,result?}。不能混用action/changes。")
	}
	v := PlanUpdate{NewTask: u.NewTask, Reason: u.Summary, ExpectedRevision: u.ExpectedRevision, RevisionSpecified: u.RevisionSpecified}
	for _, step := range u.SnapshotSteps {
		if !planText(step.Description, 500) || step.Result != "" && !planText(step.Result, 2000) {
			return u, planError("invalid_arguments", "步骤说明或结果无效")
		}
	}
	if u.NewTask || e.State == nil || e.State.Status == "complete" || e.State.Status == "cancelled" {
		v.Action, v.Objective, v.Reason = "create", u.Summary, ""
		for _, step := range u.SnapshotSteps {
			// 初始步骤文字本身就是调用者声明的验收项，不另造标准。
			if step.Result != "" {
				return u, planError("invalid_arguments", "新计划不得带历史结果；完成证据须在创建后提交")
			}
			v.Acceptance = append(v.Acceptance, step.Description)
			v.Steps = append(v.Steps, PlanStep{ID: step.ID, Text: step.Description, Status: planStatusAlias(step.Status)})
		}
		return v, nil
	}
	if !u.RevisionSpecified && (!e.SnapshotBound || e.RequestSnapshot == nil || e.RequestSnapshot.ID != e.State.ID) {
		return u, planError("revision_required", "快照更新需要请求开始时的计划快照或expected_revision")
	}
	if !u.RevisionSpecified {
		v.ExpectedRevision = e.RequestSnapshot.Revision
	}
	if v.ExpectedRevision != e.State.Revision {
		return u, planError("revision_conflict", "计划版本不一致，请读取返回的最新快照后更新")
	}
	if e.State.Mode != "plan" || len(e.State.Phases) != 1 || len(e.State.Phases[0].Steps) != len(u.SnapshotSteps) {
		return u, planError("invalid_arguments", "快照不能丢弃或覆盖既有步骤；结构调整请用action=update及changes")
	}
	v.Action, v.PlanID, v.RevisionSpecified = "update", e.State.ID, true
	allComplete := true
	completed := make([]AcceptanceResult, 0, len(u.SnapshotSteps))
	for i, step := range u.SnapshotSteps {
		old := e.State.Phases[0].Steps[i]
		if step.ID != "" && step.ID != old.ID || step.Description != old.Text {
			return u, planError("invalid_arguments", "%s", "快照步骤ID、顺序和原文必须保持；文字修改请用revise，不能改写验收标准")
		}
		status := planStatusAlias(step.Status)
		if status == "" {
			status = PlanPending
		}
		allComplete = allComplete && status == PlanCompleted
		evidence := old.Evidence
		if old.Status == PlanCompleted && step.Result != "" && (len(old.Evidence) != 1 || old.Evidence[0] != step.Result) {
			return u, planError("invalid_transition", "已完成步骤的证据不能通过快照改写；请保留原结果并添加后续验证")
		}
		if status == PlanCompleted && old.Status != PlanCompleted {
			if !planText(step.Result, 2000) {
				return u, planError("invalid_transition", "完成步骤需要result中的实际观察证据，不能只有完成标签")
			}
			evidence = []string{step.Result}
		}
		if old.Status != status {
			reason := u.Summary
			if step.Result != "" {
				reason = step.Result
			}
			v.Changes = append(v.Changes, PlanOperation{Op: "set_status", StepID: old.ID, Status: status, Reason: reason, Evidence: evidence})
		}
		completed = append(completed, AcceptanceResult{Criterion: old.Text, Evidence: evidence})
	}
	if allComplete {
		if len(e.State.Acceptance) != len(completed) {
			return u, planError("invalid_transition", "原计划有独立验收条件，请用action=complete逐项提交completion")
		}
		for i, c := range completed {
			if e.State.Acceptance[i] != c.Criterion {
				return u, planError("invalid_transition", "不能用步骤结果替换原验收标准，请用action=complete逐项提交completion")
			}
		}
		v.Action, v.Completion = "complete", completed
	} else if len(v.Changes) == 0 {
		return u, planError("no_change", "快照没有状态变化，无需重复更新")
	}
	return v, nil
}
