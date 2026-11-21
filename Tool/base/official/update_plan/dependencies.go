package updateplan

func validateDependencies(p *PlanState) error {
	steps := map[string]*PlanStep{}
	for i := range p.Phases {
		for j := range p.Phases[i].Steps {
			s := &p.Phases[i].Steps[j]
			steps[s.ID] = s
		}
	}
	colors := map[string]int{}
	var visit func(string) error
	visit = func(id string) error {
		if colors[id] == 1 {
			return planError("dependency_conflict", "计划依赖形成环：%s", id)
		}
		if colors[id] == 2 {
			return nil
		}
		s := steps[id]
		if s == nil {
			return planError("dependency_conflict", "前置步骤不存在：%s", id)
		}
		if len(s.DependsOn) > 64 {
			return planError("dependency_conflict", "单步骤最多 64 个前置条件")
		}
		colors[id] = 1
		edges := append([]string(nil), s.DependsOn...)
		seen := map[string]bool{}
		for _, dep := range edges {
			if seen[dep] {
				return planError("dependency_conflict", "重复前置条件：%s", dep)
			}
			seen[dep] = true
		}
		if s.Resume != nil && s.Resume.StepID != "" && !seen[s.Resume.StepID] {
			edges = append(edges, s.Resume.StepID)
		}
		for _, dep := range edges {
			if err := visit(dep); err != nil {
				return err
			}
		}
		if (s.Status == PlanRunning || s.Status == PlanCompleted) && !p.DependenciesComplete(s) {
			return planError("dependency_conflict", "步骤 %s 的前置条件尚未全部完成", id)
		}
		colors[id] = 2
		return nil
	}
	for id := range steps {
		if err := visit(id); err != nil {
			return err
		}
	}
	return nil
}
