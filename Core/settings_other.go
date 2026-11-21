// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: hideSettingsProcess
// Impact: python -B scripts/code-atlas.py show Core/settings_other.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

package CORE

import "os/exec"

func hideSettingsProcess(cmd *exec.Cmd) {}
