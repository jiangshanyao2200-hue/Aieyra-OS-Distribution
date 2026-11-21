package contract

import "encoding/json"

const (
	PlanPending    = "pending"
	PlanRunning    = "in_progress"
	PlanCompleted  = "completed"
	PlanDeferred   = "deferred"
	PlanBlocked    = "blocked"
	PlanCancelled  = "cancelled"
	PlanSuperseded = "superseded"
	MaxPlanPhases  = 32
	MaxPlanSteps   = 512
)

type PlanRevision struct {
	Before   string `json:"before"`
	After    string `json:"after"`
	Reason   string `json:"reason"`
	Revision int    `json:"revision"`
}
type ResumeCondition struct {
	StepID string `json:"step_id,omitempty"`
	Status string `json:"status,omitempty"`
	Detail string `json:"detail,omitempty"`
}
type PlanStep struct {
	DependsOn  []string         `json:"depends_on,omitempty"`
	ID         string           `json:"id"`
	Text       string           `json:"text"`
	Status     string           `json:"status"`
	Reason     string           `json:"reason,omitempty"`
	Evidence   []string         `json:"evidence,omitempty"`
	Resume     *ResumeCondition `json:"resume_condition,omitempty"`
	Replaces   string           `json:"replaces,omitempty"`
	ReplacedBy string           `json:"replaced_by,omitempty"`
	Revisions  []PlanRevision   `json:"revisions,omitempty"`
}
type PlanPhase struct {
	ID        string         `json:"id"`
	Title     string         `json:"title"`
	Steps     []PlanStep     `json:"steps"`
	Revisions []PlanRevision `json:"revisions,omitempty"`
}
type AcceptanceResult struct {
	Criterion string   `json:"criterion"`
	Evidence  []string `json:"evidence"`
}
type PlanState struct {
	ID         string             `json:"id"`
	Mode       string             `json:"mode"`
	Objective  string             `json:"objective"`
	Acceptance []string           `json:"acceptance"`
	Revision   int                `json:"revision"`
	Status     string             `json:"status"`
	Reason     string             `json:"reason,omitempty"`
	Phases     []PlanPhase        `json:"phases"`
	Completion []AcceptanceResult `json:"completion,omitempty"`
}
type PlanOperation struct {
	DependsOn []string         `json:"depends_on,omitempty"`
	Op        string           `json:"op"`
	StepID    string           `json:"step_id,omitempty"`
	PhaseID   string           `json:"phase_id,omitempty"`
	BeforeID  string           `json:"before_id,omitempty"`
	AfterID   string           `json:"after_id,omitempty"`
	Text      string           `json:"text,omitempty"`
	Title     string           `json:"title,omitempty"`
	Status    string           `json:"status,omitempty"`
	Reason    string           `json:"reason,omitempty"`
	NewStep   *PlanStep        `json:"new_step,omitempty"`
	Steps     []PlanStep       `json:"steps,omitempty"`
	Evidence  []string         `json:"evidence,omitempty"`
	Resume    *ResumeCondition `json:"resume_condition,omitempty"`
}
type PlanUpdate struct {
	NewTask           bool               `json:"new_task,omitempty"`
	Summary           string             `json:"summary,omitempty"`
	SnapshotSteps     []SnapshotStep     `json:"plan,omitempty"`
	Steps             []PlanStep         `json:"steps,omitempty"`
	Reason            string             `json:"reason,omitempty"`
	RevisionSpecified bool               `json:"-"`
	Action            string             `json:"action"`
	PlanID            string             `json:"plan_id,omitempty"`
	ExpectedRevision  int                `json:"expected_revision"`
	Mode              string             `json:"mode,omitempty"`
	Objective         string             `json:"objective,omitempty"`
	Acceptance        []string           `json:"acceptance,omitempty"`
	Phases            []PlanPhase        `json:"phases,omitempty"`
	Changes           []PlanOperation    `json:"changes,omitempty"`
	Completion        []AcceptanceResult `json:"completion,omitempty"`
}
type PlanChange struct {
	Kind    string `json:"kind"`
	StepID  string `json:"step_id,omitempty"`
	PhaseID string `json:"phase_id,omitempty"`
	Before  string `json:"before,omitempty"`
	After   string `json:"after,omitempty"`
	Status  string `json:"status,omitempty"`
	Reason  string `json:"reason,omitempty"`
}
type PlanTransition struct {
	TaskBoundary bool         `json:"task_boundary,omitempty"`
	Before       *PlanState   `json:"before,omitempty"`
	State        *PlanState   `json:"state"`
	Changes      []PlanChange `json:"changes"`
	At           string       `json:"at"`
}
type PlanError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type SnapshotStep struct {
	ID          string `json:"id,omitempty"`
	Description string `json:"description"`
	Status      string `json:"status"`
	Result      string `json:"result,omitempty"`
}

func (e *PlanError) Error() string { return e.Message }
func ClonePlan(p *PlanState) *PlanState {
	if p == nil {
		return nil
	}
	b, _ := json.Marshal(p)
	var out PlanState
	_ = json.Unmarshal(b, &out)
	return &out
}

func (p *PlanState) FindStep(id string) (*PlanPhase, *PlanStep) {
	if p == nil {
		return nil, nil
	}
	for i := range p.Phases {
		for j := range p.Phases[i].Steps {
			if p.Phases[i].Steps[j].ID == id {
				return &p.Phases[i], &p.Phases[i].Steps[j]
			}
		}
	}
	return nil, nil
}
func (p *PlanState) Current() (*PlanPhase, *PlanStep) {
	if p == nil {
		return nil, nil
	}
	// 优先显示真正执行或可以推进的步骤，暂缓项不能挡住后面的待办。
	for _, status := range []string{PlanRunning, PlanPending, PlanBlocked, PlanDeferred} {
		for i := range p.Phases {
			for j := range p.Phases[i].Steps {
				s := &p.Phases[i].Steps[j]
				if s.Status == status && (status != PlanPending || p.DependenciesComplete(s)) {
					return &p.Phases[i], &p.Phases[i].Steps[j]
				}
			}
		}
	}
	return nil, nil
}
func (p *PlanState) Counts(phaseID string) (done, total, deferred int) {
	if p == nil {
		return
	}
	for _, ph := range p.Phases {
		for _, s := range ph.Steps {
			if s.Status == PlanDeferred {
				deferred++
			}
			if phaseID != "" && phaseID != ph.ID {
				continue
			}
			if s.Status != PlanCancelled && s.Status != PlanSuperseded {
				total++
				if s.Status == PlanCompleted {
					done++
				}
			}
		}
	}
	return
}

func (p *PlanState) DependenciesComplete(s *PlanStep) bool {
	for _, id := range s.DependsOn {
		_, dep := p.FindStep(id)
		if dep == nil || dep.Status != PlanCompleted {
			return false
		}
	}
	if s.Resume != nil && s.Resume.StepID != "" {
		_, dep := p.FindStep(s.Resume.StepID)
		return dep != nil && dep.Status == PlanCompleted
	}
	return true
}

func (p *PlanState) HasRunnableWork() bool {
	for _, ph := range p.Phases {
		for _, s := range ph.Steps {
			if (s.Status == PlanPending || s.Status == PlanRunning) && p.DependenciesComplete(&s) {
				return true
			}
		}
	}
	return false
}
