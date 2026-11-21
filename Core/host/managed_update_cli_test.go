// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestManagedUpdateDualEntryAllowlist
// Impact: python -B scripts/code-atlas.py show Core/host/managed_update_cli_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package host

import "testing"

func TestManagedUpdateDualEntryAllowlist(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"Aieyra OS.exe", "Aieyra CLI.exe", "LICENSE", "scripts/create-launchers.ps1", "scripts/CLI-README.md"} {
		if _, err := updatePath(root, name); err != nil {
			t.Fatal(name, err)
		}
	}
	for _, name := range []string{"scripts/arbitrary.ps1", "Aieyra Other.exe", "scripts/../config.json", "scripts/Prompt/key.txt", "Client/Desktop/config.json"} {
		if _, err := updatePath(root, name); err == nil {
			t.Fatal("unsafe addition", name)
		}
	}
}
