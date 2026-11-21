// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/modules/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: linked; singleFile
// Impact: python -B scripts/code-atlas.py show Core/modules/files_unix.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

package modules

import (
	"fmt"
	"os"
	"syscall"
)

func linked(info os.FileInfo) bool { return info.Mode()&os.ModeSymlink != 0 }

func singleFile(file *os.File) error {
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if data, ok := info.Sys().(*syscall.Stat_t); !ok || data.Nlink != 1 {
		return fmt.Errorf("linked package file")
	}
	return nil
}
