// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/contract/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: AgentRunInterval; AgentRunTime
// Impact: python -B scripts/code-atlas.py show Agent/contract/time.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

// Intervals only cover time observed in a live process. A recovered task never
// infers the gap between the last durable checkpoint and the next process.
type AgentRunInterval struct {
	StartedAt  int64 `json:"started_at"`
	FinishedAt int64 `json:"finished_at"`
}

type AgentRunTime struct {
	Intervals  []AgentRunInterval `json:"intervals"`
	ElapsedMS  int64              `json:"elapsed_ms"`
	Incomplete bool               `json:"incomplete,omitempty"`
}
