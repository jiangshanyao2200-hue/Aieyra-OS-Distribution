// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/internal/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: WriteSnapshot
// Impact: python -B scripts/code-atlas.py show Core/internal/privatefile/snapshot.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package privatefile

import (
	"os"
	"path/filepath"
)

// WriteSnapshot publishes a complete immutable file while OpenSnapshot readers
// keep the preceding version. Root.Rename uses Windows replacement semantics
// that permit shared-delete readers; ordinary os.Rename does not. Unsupported
// filesystems return the actual error and retain the previous snapshot.
// The same private temporary-file permissions and sync rules as Write apply.
func WriteSnapshot(path string, data []byte) error {
	return write(path, data, func(from, to string) error {
		root, err := os.OpenRoot(filepath.Dir(to))
		if err != nil {
			return err
		}
		defer root.Close()
		return root.Rename(filepath.Base(from), filepath.Base(to))
	})
}
