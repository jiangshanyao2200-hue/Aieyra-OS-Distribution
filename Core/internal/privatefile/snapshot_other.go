// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/internal/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: OpenSnapshot
// Impact: python -B scripts/code-atlas.py show Core/internal/privatefile/snapshot_other.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

package privatefile

import "os"

// A reader retains the previous complete snapshot across atomic replacement.
func OpenSnapshot(path string) (*os.File, error) { return os.Open(path) }
