// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/platform/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestLayoutPreservesExistingPrivateRoots
// Impact: python -B scripts/code-atlas.py show Core/platform/layout_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package platform

import (
	"path/filepath"
	"testing"
)

func TestLayoutPreservesExistingPrivateRoots(t *testing.T) {
	root := t.TempDir()
	for _, c := range []struct{ config, data string }{{filepath.Join(root, "Config", "settings.json"), filepath.Join(root, "Data")}, {filepath.Join(root, "isolated", "config.json"), filepath.Join(root, "isolated")}} {
		l := ResolveLayout(root, c.config, filepath.Join(root, "work"))
		if l.Data != c.data {
			t.Fatalf("moved existing data: %+v", l)
		}
		official, err := l.ModuleRoot("program", "official")
		if err != nil || official != filepath.Join(root, "Program", "official") {
			t.Fatal(official, err)
		}
		local, err := l.ModuleRoot("workbox", "local")
		if err != nil || local != filepath.Join(c.data, "Modules", "Tool", "workbox", "local") {
			t.Fatal(local, err)
		}
		for _, origin := range []string{"official", "third-party", "local"} {
			halo, err := l.ModuleRoot("halo", origin)
			want := filepath.Join(c.data, "Modules", "Halo", origin)
			if origin == "official" {
				want = filepath.Join(root, "Halo", origin)
			}
			if err != nil || halo != want {
				t.Fatalf("halo ownership: %s, want %s: %v", halo, want, err)
			}
		}
		if _, err = l.ModuleRoot("program", "../escape"); err == nil {
			t.Fatal("invalid origin accepted")
		}
	}
}
