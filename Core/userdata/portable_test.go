// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/userdata/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestPortableProfilesAreLocalAndRetainUserBytes; TestPortableLegacyAndUnknownDataAreNotMigratedImplicitly; TestPortableReadonlyFallbackIsStableAndPerInstallation; TestPortableResumesOwnInitializationAndRefusesDamagedMarker
// Impact: python -B scripts/code-atlas.py show Core/userdata/portable_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package userdata

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/aieyra/aieyra-os/contracts/storage"
)

func TestPortableProfilesAreLocalAndRetainUserBytes(t *testing.T) {
	base := t.TempDir()
	user := func() (string, error) { return filepath.Join(base, "user"), nil }
	var first storage.Profile
	for _, name := range []string{"development", "user-installation"} {
		root := filepath.Join(base, name)
		p, err := preparePortable(root, user, writablePortable)
		if err != nil || !p.Unified || p.Root != filepath.Join(root, "Data") {
			t.Fatal(p, err)
		}
		if first.ID != "" && (first.ID == p.ID || first.Config == p.Config) {
			t.Fatal("shared installation profile")
		}
		first = p
		original := []byte("{\"language\":\"en-US\"}\n")
		if err = os.WriteFile(p.Config, original, 0600); err != nil {
			t.Fatal(err)
		}
		again, err := preparePortable(root, user, writablePortable)
		bytes, _ := os.ReadFile(p.Config)
		if err != nil || again.ID != p.ID || string(bytes) != string(original) {
			t.Fatal("reopen replaced user data", err)
		}
		if err = os.Remove(p.Config); err != nil {
			t.Fatal(err)
		}
		if _, err = preparePortable(root, user, writablePortable); err == nil {
			t.Fatal("missing config became a fresh profile")
		}
		if _, err = os.Stat(p.Config); !os.IsNotExist(err) {
			t.Fatal("recreated lost configuration", err)
		}
	}
}

func TestPortableLegacyAndUnknownDataAreNotMigratedImplicitly(t *testing.T) {
	base := t.TempDir()
	file := filepath.Join(base, "Config", "config.json")
	_ = os.MkdirAll(filepath.Dir(file), 0700)
	_ = os.WriteFile(file, []byte("{}"), 0600)
	p, err := PreparePortable(base)
	if err != nil || p.Config != file || p.Unified {
		t.Fatal(p, err)
	}
	_ = os.Remove(file)
	_ = os.MkdirAll(filepath.Join(base, "Data"), 0700)
	old := filepath.Join(base, "Data", "precious-memory.txt")
	_ = os.WriteFile(old, []byte("original memory"), 0600)
	if _, err = PreparePortable(base); err == nil {
		t.Fatal("unknown data admitted")
	}
	b, _ := os.ReadFile(old)
	if string(b) != "original memory" {
		t.Fatal("old data changed")
	}
}

func TestPortableReadonlyFallbackIsStableAndPerInstallation(t *testing.T) {
	base := t.TempDir()
	user := func() (string, error) { return filepath.Join(base, "roaming"), nil }
	denied := func(string) error { return os.ErrPermission }
	a, err := preparePortable(filepath.Join(base, "a"), user, denied)
	if err != nil {
		t.Fatal(err)
	}
	b, err := preparePortable(filepath.Join(base, "b"), user, denied)
	if err != nil || a.Root == b.Root || a.ID == b.ID {
		t.Fatal(b, err)
	}
	again, err := preparePortable(filepath.Join(base, "a"), user, func(string) error { t.Fatal("switched away from fallback"); return nil })
	if err != nil || again.Config != a.Config {
		t.Fatal(again, err)
	}
	if err = os.Remove(a.Config); err != nil {
		t.Fatal(err)
	}
	if _, err = preparePortable(filepath.Join(base, "a"), user, denied); err == nil {
		t.Fatal("missing fallback config became a fresh profile")
	}
	if _, err = preparePortable(filepath.Join(base, "c"), user, func(string) error { return errors.New("disk failed") }); err == nil {
		t.Fatal("disk error silently selected different data")
	}
}

func TestPortableResumesOwnInitializationAndRefusesDamagedMarker(t *testing.T) {
	root := t.TempDir()
	_, err := initialize(filepath.Join(root, "Data"), func(stage string) error {
		if stage == "configured" {
			return errors.New("interrupted")
		}
		return nil
	})
	if err == nil {
		t.Fatal("not interrupted")
	}
	p, err := PreparePortable(root)
	if err != nil || !p.Unified {
		t.Fatal(p, err)
	}
	_ = os.WriteFile(filepath.Join(root, "Data", storage.ProfileMarker), []byte("{"), 0600)
	if _, err = PreparePortable(root); err == nil {
		t.Fatal("damaged marker accepted")
	}
}
