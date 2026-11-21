// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: hideModelWorker
// Impact: python -B scripts/code-atlas.py show Core/matrix_worker_other.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

package CORE

import "os/exec"

func hideModelWorker(c *exec.Cmd) {}
