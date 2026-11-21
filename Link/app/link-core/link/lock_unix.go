// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: lockFile; unlockFile
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/lock_unix.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

package link

import (
	"golang.org/x/sys/unix"
	"os"
)

func lockFile(f *os.File) error { return unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB) }
func unlockFile(f *os.File)     { _ = unix.Flock(int(f.Fd()), unix.LOCK_UN) }
