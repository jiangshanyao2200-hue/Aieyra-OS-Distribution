// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: hideWorkspaceProcess; ownWorkspaceLifetime
// Impact: python -B scripts/code-atlas.py show Core/host/workspace_other.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

package host

import "os/exec"

func hideWorkspaceProcess(command *exec.Cmd) {}

func ownWorkspaceLifetime() (func(), error) { return func() {}, nil }
