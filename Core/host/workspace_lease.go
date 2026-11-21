// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workspaceParentLease
// Impact: python -B scripts/code-atlas.py show Core/host/workspace_lease.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package host

import "github.com/aieyra/aieyra-os/CORE/internal/osowner"

func workspaceParentLease() (int, string, func(), error) { return osowner.Open() }
