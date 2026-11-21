// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/cmd/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: main
// Impact: python -B scripts/code-atlas.py show Core/cmd/aieyra-mac/main.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build darwin

// Finder entrypoint; the editable product tree lives inside Resources.
package main

import (
	"os"
	"path/filepath"
	"syscall"
)

func main() {
	exe, err := os.Executable()
	if err != nil {
		os.Exit(1)
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(exe), "../Resources/product"))
	_ = os.Setenv("AIEYRA_ROOT", root)
	if home, err := os.UserHomeDir(); err == nil {
		_ = os.Chdir(home)
	}
	binary := filepath.Join(root, "Aieyra OS")
	if err := syscall.Exec(binary, append([]string{binary}, os.Args[1:]...), os.Environ()); err != nil {
		os.Exit(1)
	}
}
