// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: tokenBudgetReached; requestBudgetError; repairBudgetError
// Impact: python -B scripts/code-atlas.py show Core/agent_budget.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "fmt"

// A zero token cap is reserved for the trusted interactive workspace. Request
// counts are accounting only; deadlines and explicit cancellation still apply.
func (r AgentRecord) tokenBudgetReached(afterResponse bool) bool {
	if r.Spec.MaxTokens <= 0 {
		return false
	}
	used := r.AccountedTokens - r.TurnTokenBase
	if afterResponse {
		return used > r.Spec.MaxTokens
	}
	return used >= r.Spec.MaxTokens
}

func (r AgentRecord) requestBudgetError() error {
	if err := r.repairBudgetError(false); err != nil {
		return err
	}
	if r.tokenBudgetReached(false) {
		return fmt.Errorf("agent cumulative token budget exhausted (%d/%d); task and receipts retained", r.AccountedTokens-r.TurnTokenBase, r.Spec.MaxTokens)
	}
	return nil
}

func (r AgentRecord) repairBudgetError(after bool) error {
	if b := r.RepairRun; b != nil {
		tokens, requests := r.AccountedTokens-b.TokenBase, r.Requests-b.RequestBase
		if (!after && (tokens >= 64000 || requests >= 12)) || tokens > 64000 || requests > 12 {
			return fmt.Errorf("mother repair budget exhausted; original task and receipts retained for explicit user continuation")
		}
	}
	return nil
}
