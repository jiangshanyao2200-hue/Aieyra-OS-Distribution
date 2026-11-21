// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/sessionservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: InUse; Lock; OpenLocked
// Impact: python -B scripts/code-atlas.py show Core/sessionservice/lock_other.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

package sessionservice

import (
	"errors"
	"golang.org/x/sys/unix"
	"os"
)

func InUse(err error) bool {
	return errors.Is(err, unix.EWOULDBLOCK) || errors.Is(err, unix.EAGAIN)
}

func Lock(path string) (func(), error) {
	f, err := OpenLocked(path)
	if err != nil {
		return nil, err
	}
	return func() { _ = f.Close() }, nil
}

// OpenLocked returns the exclusive owner and a readable snapshot handle.
func OpenLocked(path string) (*os.File, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}
