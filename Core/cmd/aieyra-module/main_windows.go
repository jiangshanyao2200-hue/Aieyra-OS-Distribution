// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/cmd/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: fail
// Impact: python -B scripts/code-atlas.py show Core/cmd/aieyra-module/main_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package main

import (
	"os"
	"syscall"
	"unsafe"
)

func fail(err error) {
	message, _ := syscall.UTF16PtrFromString(err.Error())
	title, _ := syscall.UTF16PtrFromString("Aieyra")
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(message)), uintptr(unsafe.Pointer(title)), 0x10)
	os.Exit(1)
}
