// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/userdata/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestProfileInitAndRecovery; TestProfileRejectsUnknownFilesDamageAndActiveInitialization; TestProfileRejectsRedirectedDestination
// Impact: python -B scripts/code-atlas.py show Core/userdata/init_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package userdata

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/sessionservice"
	"github.com/aieyra/aieyra-os/contracts/storage"
)

func TestProfileInitAndRecovery(t *testing.T) {
	for _, phase := range []string{"declared", "configured", "none"} {
		t.Run(phase, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "UserData")
			_, err := initialize(root, func(stage string) error {
				if stage == phase {
					return errors.New("interrupted")
				}
				return nil
			})
			if phase != "none" {
				if err == nil {
					t.Fatal("checkpoint did not interrupt")
				}
				if _, e := storage.Bind(filepath.Join(root, "Config", "config.json")); e == nil {
					t.Fatal("partial profile admitted")
				}
			}
			p, err := Init(root)
			if err != nil {
				t.Fatal(err)
			}
			if !p.Unified || p.Root != root || p.Overrides != filepath.Join(root, "Overrides") {
				t.Fatal(p)
			}
			if err := os.WriteFile(p.Config, []byte("{\"language\":\"en-US\"}\n"), 0600); err != nil {
				t.Fatal(err)
			}
			again, err := Init(root)
			if err != nil || again.ID != p.ID {
				t.Fatal(again, err)
			}
			data, _ := os.ReadFile(p.Config)
			if string(data) != "{\"language\":\"en-US\"}\n" {
				t.Fatal("reinitialization changed settings")
			}
			paths := storage.Resolve(root)
			if paths.Memory != filepath.Join(root, "Memory") || paths.Attachments != filepath.Join(root, "Assets", "attachments") || paths.Sessions != filepath.Join(root, "Sessions", "standalone") {
				t.Fatal(paths)
			}
			if _, err := os.Stat(filepath.Join(root, "Data")); !os.IsNotExist(err) {
				t.Fatal("created legacy Data layout", err)
			}
		})
	}
}

func TestProfileRejectsUnknownFilesDamageAndActiveInitialization(t *testing.T) {
	root := t.TempDir()
	original := filepath.Join(root, "unknown.bin")
	if err := os.WriteFile(original, []byte("preserve"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Init(root); err == nil {
		t.Fatal("accepted nonempty legacy root")
	}
	data, _ := os.ReadFile(original)
	if string(data) != "preserve" {
		t.Fatal("modified unknown file")
	}
	if _, err := os.Stat(filepath.Join(root, storage.ProfileMarker)); !os.IsNotExist(err) {
		t.Fatal("declared a nonempty legacy root")
	}
	root = t.TempDir()
	unlock, err := sessionservice.Lock(filepath.Join(root, lockName))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Init(root); err == nil {
		t.Fatal("concurrent initializer admitted")
	}
	unlock()
	if err = os.WriteFile(filepath.Join(root, storage.ProfileMarker), []byte("{"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = Init(root); err == nil {
		t.Fatal("overwrote damaged declaration")
	}
}

func TestProfileRejectsRedirectedDestination(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "alias")); err != nil {
		t.Skip(err)
	}
	if _, err := Init(filepath.Join(root, "alias", "new")); err == nil {
		t.Fatal("followed redirected destination")
	}
	if entries, err := os.ReadDir(outside); err != nil || len(entries) != 0 {
		t.Fatal("modified target", entries, err)
	}
}
