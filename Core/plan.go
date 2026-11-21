// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: PlanRevision; ResumeCondition; PlanStep; PlanPhase; AcceptanceResult; PlanState; PlanOperation; PlanUpdate; PlanChange; PlanTransition; PlanError; SnapshotStep; planText; planError; ClonePlan; ValidatePlan; ParsePlanUpdate; ApplyPlanUpdate
// Impact: python -B scripts/code-atlas.py show Core/plan.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// Public aliases preserve existing clients while the official tool owns plan rules.
import (
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	plantool "github.com/aieyra/aieyra-os/tool/base/official/update_plan"
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

func planError(code, format string, args ...any) error {
	return &PlanError{Code: code, Message: fmt.Sprintf(format, args...)}
}
func ClonePlan(p *PlanState) *PlanState               { return contract.ClonePlan(p) }
func ValidatePlan(p *PlanState) error                 { return plantool.ValidatePlan(p) }
func ParsePlanUpdate(args string) (PlanUpdate, error) { return plantool.ParsePlanUpdate(args) }
func ApplyPlanUpdate(old *PlanState, u PlanUpdate) (*PlanTransition, error) {
	return plantool.ApplyPlanUpdate(old, u)
}
