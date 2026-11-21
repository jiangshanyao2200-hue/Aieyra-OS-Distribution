// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/storage/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ProcessAbsent
// Impact: python -B scripts/code-atlas.py show Contracts/storage/process_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build windows

package storage

import "syscall"

func ProcessAbsent(pid int) bool {
	if pid <= 0 {
		return false
	}
	h, err := syscall.OpenProcess(0x1000, false, uint32(pid))
	if err != nil {
		return err == syscall.Errno(87)
	}
	defer syscall.CloseHandle(h)
	var status uint32
	return syscall.GetExitCodeProcess(h, &status) == nil && status != 259
}
