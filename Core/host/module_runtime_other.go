// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: lockModuleRuntime
// Impact: python -B scripts/code-atlas.py show Core/host/module_runtime_other.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

package host

import (
	"golang.org/x/sys/unix"
	"os"
)

func lockModuleRuntime(f *os.File) error { return unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB) }
