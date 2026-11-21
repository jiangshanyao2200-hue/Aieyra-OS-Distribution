// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/storage/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ProcessAbsent
// Impact: python -B scripts/code-atlas.py show Contracts/storage/process_other.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

package storage

import (
	"errors"
	"syscall"
)

func ProcessAbsent(pid int) bool { return pid > 0 && errors.Is(syscall.Kill(pid, 0), syscall.ESRCH) }
