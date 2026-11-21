// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/internal/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: CreateTemporary
// Impact: python -B scripts/code-atlas.py show Core/internal/privatefile/temporary.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package privatefile

import "os"

// CreateTemporary creates an owner-private streaming target. The caller must
// close it, then publish or remove it; it is never a completed private file.
func CreateTemporary(dir string) (*os.File, error) { return createTemp(dir) }
