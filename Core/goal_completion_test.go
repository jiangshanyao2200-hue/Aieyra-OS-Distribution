// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestGoalCompletionBoundaryPreservesPriorTaskAndOrdinaryPlan
// Impact: python -B scripts/code-atlas.py show Core/goal_completion_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "testing"

func TestGoalCompletionBoundaryPreservesPriorTaskAndOrdinaryPlan(t *testing.T) {
	e := &PlanEngine{State: initialPlan(t)}
	if boundary := goalCompletionBoundary(e); boundary != "" {
		t.Fatal("ordinary plan acquired a completion gate", boundary)
	}
	e.State.Mode = "goal"
	if boundary := goalCompletionBoundary(e); boundary == "" {
		t.Fatal("current explicit active goal can complete without acceptance")
	}
	e.PriorTaskID = e.State.ID
	if boundary := goalCompletionBoundary(e); boundary != "" {
		t.Fatal("an untouched prior task blocked a new user request", boundary)
	}
}
