// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: lockImageBatch
// Impact: python -B scripts/code-atlas.py show Core/image_batch_lock_unix.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

package CORE

import (
	"golang.org/x/sys/unix"
	"os"
)

func lockImageBatch(file *os.File) error {
	return unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB)
}
