// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: goalCompletionBoundary
// Impact: python -B scripts/code-atlas.py show Core/goal_completion.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// Only an explicit goal owned by the current user task gates final delivery.
// Ordinary plans and preserved goals from a prior user task keep their existing
// contract. A paused/blocked/cancelled goal can report that boundary normally.
func goalCompletionBoundary(plan *PlanEngine) string {
	if plan == nil || plan.State == nil || plan.State.Mode != "goal" || plan.State.ID == plan.PriorTaskID {
		return ""
	}
	p := plan.State
	if p.Status == "blocked" && p.HasRunnableWork() {
		return formatPromptText(runtimePrompt("Matrix/辅助指令/目标独立步骤.txt"), p.ID)
	}
	if p.Status != "active" && p.Status != "awaiting_acceptance" {
		return ""
	}
	return formatPromptText(runtimePrompt("Matrix/辅助指令/目标验收状态.txt"), p.ID, p.Revision, p.Status)
}
