// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/modules/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWithdrawnPackageCannotBeDiscoveredOrExecutedAndRetainsData
// Impact: python -B scripts/code-atlas.py show Core/modules/retired_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package modules

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestWithdrawnPackageCannotBeDiscoveredOrExecutedAndRetainsData(t *testing.T) {
	m := New(t.TempDir(), testHost())
	source := fixture(t, "test.withdrawn", "1.0.0", nil)
	installed := install(t, m, source)
	if installed.Item == nil {
		t.Fatal("installation missing")
	}
	data := filepath.Join(m.Root, "user-document.txt")
	if err := os.WriteFile(data, []byte("retained"), 0600); err != nil {
		t.Fatal(err)
	}
	registryFile := filepath.Join(m.Root, "installed.json")
	before, _ := os.ReadFile(registryFile)
	m.RetiredPackages = map[string]bool{"test.withdrawn": true}
	listed := checked(t, m, Request{Action: "list"})
	if len(listed.Items) != 0 {
		t.Fatal("withdrawn program still discoverable", listed.Items)
	}
	if _, err := m.Call(context.Background(), Request{Action: "resolve", ID: "test.withdrawn"}); err == nil {
		t.Fatal("withdrawn program can execute")
	}
	inspection := checked(t, m, Request{Action: "inspect", Source: source})
	if inspection.Compatibility.Compatible {
		t.Fatal("withdrawn package can be reimported")
	}
	after, _ := os.ReadFile(registryFile)
	if string(before) != string(after) {
		t.Fatal("withdrawal rewrote existing registration")
	}
	if content, err := os.ReadFile(data); err != nil || string(content) != "retained" {
		t.Fatal("user document was changed", err)
	}
}
