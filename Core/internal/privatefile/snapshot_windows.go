// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/internal/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: OpenSnapshot
// Impact: python -B scripts/code-atlas.py show Core/internal/privatefile/snapshot_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build windows

package privatefile

import (
	"os"

	"golang.org/x/sys/windows"
)

// Registry files are immutable snapshots replaced under the writer lease.
// FILE_SHARE_DELETE lets that atomic replacement coexist with an active
// reader; its handle continues to read the old bytes. No retry or partial
// in-place update is involved.
func OpenSnapshot(path string) (*os.File, error) {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(name, windows.GENERIC_READ, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return nil, &os.PathError{Op: "open registry snapshot", Path: path, Err: err}
	}
	return os.NewFile(uintptr(handle), path), nil
}
