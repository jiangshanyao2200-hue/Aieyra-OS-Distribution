// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Program/official/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: TestCompiledPackagesMatchManifests
// Impact: python -B scripts/code-atlas.py show Program/official/packages_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package official

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"
)

// Validate the bytes actually embedded in a compiled host, rather than only
// the directory on disk. Missing embed patterns must fail before GUI startup.
func TestCompiledPackagesMatchManifests(t *testing.T) {
	for _, folder := range Folders() {
		t.Run(folder, func(t *testing.T) {
			files, err := PackageFiles(folder)
			if err != nil {
				t.Fatal(err)
			}
			var manifest struct {
				Files map[string]struct {
					SHA256 string `json:"sha256"`
					Size   int    `json:"size"`
				} `json:"files"`
			}
			if err := json.Unmarshal(files["manifest.json"], &manifest); err != nil {
				t.Fatal(err)
			}
			if len(files) != len(manifest.Files)+1 {
				t.Errorf("compiled files=%d, manifest files=%d", len(files)-1, len(manifest.Files))
			}
			for name, declared := range manifest.Files {
				data, exists := files[name]
				digest := sha256.Sum256(data)
				if !exists || len(data) != declared.Size || hex.EncodeToString(digest[:]) != declared.SHA256 {
					t.Errorf("compiled payload missing or mismatched: %s", name)
				}
			}
		})
	}
}
