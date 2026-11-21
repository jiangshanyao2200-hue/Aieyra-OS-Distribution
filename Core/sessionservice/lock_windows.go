// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/sessionservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: InUse; Lock; OpenLocked
// Impact: python -B scripts/code-atlas.py show Core/sessionservice/lock_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build windows

package sessionservice

import (
	"errors"
	"golang.org/x/sys/windows"
	"os"
)

func InUse(err error) bool {
	return errors.Is(err, windows.ERROR_SHARING_VIOLATION) || errors.Is(err, windows.ERROR_LOCK_VIOLATION)
}

func Lock(path string) (func(), error) {
	f, err := OpenLocked(path)
	if err != nil {
		return nil, err
	}
	return func() { _ = f.Close() }, nil
}

// OpenLocked keeps a readable handle while excluding other owners. Offline
// migration uses the handle to preserve nonempty historical lock records.
func OpenLocked(path string) (*os.File, error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	h, err := windows.CreateFile(p, windows.GENERIC_READ|windows.GENERIC_WRITE, 0, nil, windows.OPEN_ALWAYS, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(h), path), nil
}
