// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/platform/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: profileProcesses
// Impact: python -B scripts/code-atlas.py show Core/platform/profile_processes_other.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows && !linux

package platform

import "fmt"

func profileProcesses() ([]profileProcess, error) {
	return nil, fmt.Errorf("legacy profile process inspection is unavailable on this platform")
}
