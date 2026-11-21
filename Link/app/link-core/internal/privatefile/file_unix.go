// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: createTemp
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/internal/privatefile/file_unix.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

package privatefile

import "os"

func createTemp(dir string) (*os.File, error) {
	// CreateTemp creates with 0600; no broader permission window is introduced.
	return os.CreateTemp(dir, ".aieyra-private-*.tmp")
}
