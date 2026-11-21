package updateplan

import (
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"github.com/aieyra/aieyra-os/tool/base/official/update_plan/contract"
)

type PlanRevision = contract.PlanRevision
type ResumeCondition = contract.ResumeCondition
type PlanStep = contract.PlanStep
type PlanPhase = contract.PlanPhase
type AcceptanceResult = contract.AcceptanceResult
type PlanState = contract.PlanState
type PlanOperation = contract.PlanOperation
type PlanUpdate = contract.PlanUpdate
type PlanChange = contract.PlanChange
type PlanTransition = contract.PlanTransition
type PlanError = contract.PlanError
type SnapshotStep = contract.SnapshotStep

const (
	PlanPending    = contract.PlanPending
	PlanRunning    = contract.PlanRunning
	PlanCompleted  = contract.PlanCompleted
	PlanDeferred   = contract.PlanDeferred
	PlanBlocked    = contract.PlanBlocked
	PlanCancelled  = contract.PlanCancelled
	PlanSuperseded = contract.PlanSuperseded
	maxPlanPhases  = contract.MaxPlanPhases
	maxPlanSteps   = contract.MaxPlanSteps
)

var planText = protocol.ValidSingleLineText

func ClonePlan(p *PlanState) *PlanState { return contract.ClonePlan(p) }
