// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/internal/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: createTemp
// Impact: python -B scripts/code-atlas.py show Core/internal/privatefile/file_unix.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

package privatefile

import "os"

func createTemp(dir string) (*os.File, error) {
	// CreateTemp creates with 0600; no broader permission window is introduced.
	return os.CreateTemp(dir, ".aieyra-private-*.tmp")
}
