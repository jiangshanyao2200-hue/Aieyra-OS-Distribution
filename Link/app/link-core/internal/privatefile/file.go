// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: Write
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/internal/privatefile/file.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package privatefile writes credentials before they become readable by others.
package privatefile

import (
	"os"
	"path/filepath"
)

// Write atomically replaces only the requested file. Parent permissions stay intact.
func Write(path string, data []byte) error {
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
	return os.Rename(f.Name(), path)
}
