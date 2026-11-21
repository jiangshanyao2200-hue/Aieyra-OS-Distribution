// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestTerminalCatalogProjectionMatchesOS; TestTerminalCatalogReloadsAndRejectsCorruptMetadata
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/terminal_catalog_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package cli

import (
	"os"
	"path/filepath"
	"testing"

	agent "github.com/aieyra/aieyra-os/CORE"
)

func TestTerminalCatalogProjectionMatchesOS(t *testing.T) {
	row, ok := terminalCatalogReference("https://opencode.ai/zen/v1", "gemini-3.1-pro")
	if !ok || row.Protocol != agent.ProtocolGoogle || row.Context != 1048576 || row.Name == "" {
		t.Fatal("CLI lacks the OS Gemini protocol/capacity reference", row)
	}
	if _, ok := terminalCatalogReference("https://unrelated.invalid/v1", "gemini-3.1-pro"); ok {
		t.Fatal("provider reference crossed endpoints")
	}
}

func TestTerminalCatalogReloadsAndRejectsCorruptMetadata(t *testing.T) {
	root := t.TempDir()
	t.Setenv("AIEYRA_RESOURCE_ROOT", root)
	if err := os.Mkdir(filepath.Join(root, "Config"), 0700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "Config", "OpenCode模型.json")
	write := func(text string) {
		t.Helper()
		if err := os.WriteFile(file, []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "Config", "模型资料.json"), []byte(`{}`), 0600); err != nil {
		t.Fatal(err)
	}
	write(`{"providers":{"opencode":{"fixture":{"name":"first","api_protocol":"responses","context_window":100000}}}}`)
	row, ok := terminalCatalogReference("https://opencode.ai/zen/v1", "fixture")
	if !ok || row.Context != 100000 {
		t.Fatal(row, ok)
	}
	write(`{"providers":{"opencode":{"fixture":{"name":"changed-longer","api_protocol":"responses","context_window":200000}}}}`)
	row, ok = terminalCatalogReference("https://opencode.ai/zen/v1", "fixture")
	if !ok || row.Context != 200000 || row.Name != "changed-longer" {
		t.Fatal("stale cached catalog", row, ok)
	}
	write(`broken JSON`)
	if _, ok := terminalCatalogReference("https://opencode.ai/zen/v1", "fixture"); ok {
		t.Fatal("corrupt resource reused stale metadata")
	}
}
