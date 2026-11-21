// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/storage/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: profileFixture; TestProfileBindingAndScopeStayIsolated; TestProfileDamageCannotFallBackToLegacy
// Impact: python -B scripts/code-atlas.py show Contracts/storage/profile_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package storage

import (
	"os"
	"path/filepath"
	"testing"
)

func profileFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	config := filepath.Join(root, "Config", "config.json")
	if err := os.MkdirAll(filepath.Dir(config), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(config, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ProfileMarker), []byte(`{"schema":"aieyra.user-data/1","id":"0123456789abcdef0123456789abcdef","state":"ready","config":"Config/config.json"}`), 0600); err != nil {
		t.Fatal(err)
	}
	return config
}

func TestProfileBindingAndScopeStayIsolated(t *testing.T) {
	a, b := profileFixture(t), profileFixture(t)
	p, err := Bind(a)
	if err != nil {
		t.Fatal(err)
	}
	if !p.Unified || Bound(a) != p {
		t.Fatal(p)
	}
	if _, err = Bind(filepath.Join(p.Root, "Config", "wrong.json")); err == nil {
		t.Fatal("accepted different configuration")
	}
	release, err := Use(a)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Use(b); err == nil {
		t.Fatal("concurrent prompt scope switched profiles")
	}
	if err = os.WriteFile(filepath.Join(p.Root, ProfileMarker), []byte("damaged after admission"), 0600); err != nil {
		t.Fatal(err)
	}
	if again, err := Bind(a); err != nil || again != p {
		t.Fatal("active binding moved", again, err)
	}
	release()
	release()
	if _, ok := Active(); ok {
		t.Fatal("scope leaked")
	}
	release, err = Use(b)
	if err != nil {
		t.Fatal(err)
	}
	release()
}

func TestProfileDamageCannotFallBackToLegacy(t *testing.T) {
	for _, raw := range []string{`{}`, `{"schema":"aieyra.user-data/1","id":"0123456789abcdef0123456789abcdef","state":"initializing","config":"Config/config.json"}`, string([]byte{255}), `{"schema":"future"}`} {
		root := t.TempDir()
		if err := os.WriteFile(filepath.Join(root, ProfileMarker), []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := Bind(filepath.Join(root, "Config", "config.json")); err == nil {
			t.Fatal("invalid declaration admitted")
		}
		if entries, _ := os.ReadDir(root); len(entries) != 1 {
			t.Fatal("failure wrote files", entries)
		}
	}
}
