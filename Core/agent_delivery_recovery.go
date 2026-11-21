// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: pendingDeliveryBoundary
// Impact: python -B scripts/code-atlas.py show Core/agent_delivery_recovery.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
)

// A premature final answer is recoverable only when the assigned tools can
// continue every pending execution. Observations contain identities, never
// command text, private output, or an instruction to launch the work again.
func pendingDeliveryBoundary(ctx context.Context, shell *ShellManager) (string, error) {
	var pending []map[string]any
	var failure error
	canContinue := true
	for _, result := range shell.Snapshots() {
		if !result.Pending() || result.Background {
			continue
		}
		failure = errUnfinishedShell
		resume := map[string]any{"session_id": result.SessionID}
		name := "write_stdin"
		if toolAllowed(ctx, "terminal") {
			name, resume["action"] = "terminal", "wait"
		} else if !toolAllowed(ctx, "write_stdin") {
			canContinue = false
		}
		pending = append(pending, map[string]any{"state": result.State, "generation": result.Generation, "tool": name, "arguments": resume})
	}
	for _, result := range shell.ExecutionSnapshots() {
		if result.State != "running" {
			continue
		}
		if failure == nil {
			failure = errUnfinishedExecution
		}
		canContinue = canContinue && toolAllowed(ctx, "wait")
		pending = append(pending, map[string]any{"state": result.State, "tool": "wait", "arguments": map[string]any{"cell_id": result.CellID}})
	}
	if failure == nil || !canContinue {
		return "", failure
	}
	return formatPromptText(runtimePrompt("Matrix/辅助指令/未完成执行.txt"), string(rawJSON(pending))), failure
}
