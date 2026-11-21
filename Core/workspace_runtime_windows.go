// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ordinaryRuntimeDirectory
// Impact: python -B scripts/code-atlas.py show Core/workspace_runtime_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"syscall"
)

// Never traverse junctions, mount points or other Windows reparse points.
func ordinaryRuntimeDirectory(path string) bool {
	p, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return false
	}
	attributes, err := syscall.GetFileAttributes(p)
	return err == nil && attributes&syscall.FILE_ATTRIBUTE_DIRECTORY != 0 && attributes&syscall.FILE_ATTRIBUTE_REPARSE_POINT == 0
}
