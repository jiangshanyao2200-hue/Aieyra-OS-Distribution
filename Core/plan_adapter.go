// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: adaptUpdate
// Impact: python -B scripts/code-atlas.py show Core/plan_adapter.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import plantool "github.com/aieyra/aieyra-os/tool/base/official/update_plan"

func (e *PlanEngine) adaptUpdate(u PlanUpdate) (PlanUpdate, error) {
	return plantool.AdaptUpdate(e.State, e.RequestSnapshot, e.SnapshotBound, u)
}
