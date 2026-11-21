// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/internal/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Write; write
// Impact: python -B scripts/code-atlas.py show Core/internal/privatefile/file.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package privatefile writes credentials before they become readable by others.
package privatefile

import (
	"os"
	"path/filepath"
)

// Write atomically replaces only the requested file. Parent permissions stay intact.
func Write(path string, data []byte) error { return write(path, data, os.Rename) }

func write(path string, data []byte, replace func(string, string) error) error {
	f, err := createTemp(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	_, err = f.Write(data)
	if err == nil {
		err = f.Sync()
	}
	if closed := f.Close(); err == nil {
		err = closed
	}
	if err != nil {
		return err
	}
	return replace(f.Name(), path)
}
