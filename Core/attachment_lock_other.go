// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: lockAttachmentUsage; attachmentProcessAbsent
// Impact: python -B scripts/code-atlas.py show Core/attachment_lock_other.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

package CORE

import (
	"errors"
	"golang.org/x/sys/unix"
	"os"
)

func lockAttachmentUsage(path string, exclusive bool) (func(), error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	flags := unix.LOCK_SH
	if exclusive {
		flags = unix.LOCK_EX | unix.LOCK_NB
	}
	if err = unix.Flock(int(f.Fd()), flags); err != nil {
		f.Close()
		return nil, err
	}
	return func() { unix.Flock(int(f.Fd()), unix.LOCK_UN); f.Close() }, nil
}

func attachmentProcessAbsent(pid int) bool {
	return pid > 0 && errors.Is(unix.Kill(pid, 0), unix.ESRCH)
}
