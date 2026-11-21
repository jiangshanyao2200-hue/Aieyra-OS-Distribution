// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/extensionhost/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestOfficialProgramReworkPreviousPackages
// Impact: python -B scripts/code-atlas.py show Core/extensionhost/official_program_rework_upgrade_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package extensionhost

import (
	"encoding/json"
	"github.com/aieyra/aieyra-os/CORE/modules"
	"os"
	"path/filepath"
	"testing"
)

// The release rehearsal consumes exact prior public bytes from the external
// evidence directory. It never opens a user's registry or conversations.
func TestOfficialProgramReworkPreviousPackages(t *testing.T) {
	root := os.Getenv("AIEYRA_PREVIOUS_PROGRAM_PACKAGES")
	if root == "" {
		t.Skip("exact prior packages supplied by the release rehearsal")
	}
	for _, name := range []string{"coding", "workspace", "browser"} {
		t.Run(name, func(t *testing.T) {
			dir := filepath.Join(root, name)
			raw, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
			if err != nil {
				t.Fatal(err)
			}
			var manifest struct {
				Files map[string]json.RawMessage `json:"files"`
			}
			if err = json.Unmarshal(raw, &manifest); err != nil {
				t.Fatal(err)
			}
			files := map[string][]byte{"manifest.json": raw}
			for file := range manifest.Files {
				files[file], err = os.ReadFile(filepath.Join(dir, filepath.FromSlash(file)))
				if err != nil {
					t.Fatal(err)
				}
			}
			prior, err := modules.FromFiles(files)
			if err != nil {
				t.Fatal(err)
			}
			if prior.Manifest.ID != "aieyra."+name {
				t.Fatal("unexpected prior identity")
			}
			entry := "service.cjs"
			if name == "browser" {
				entry = "service/browser-runtime.cjs"
			}
			verifyOfficialProgramUpgrade(t, prior, entry)
		})
	}
}
