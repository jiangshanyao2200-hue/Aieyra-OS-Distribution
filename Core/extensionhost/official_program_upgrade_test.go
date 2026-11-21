// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/extensionhost/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestBundledNativeProgramsUpgradeWithoutRevivingRemovedOrDisabled
// Impact: python -B scripts/code-atlas.py show Core/extensionhost/official_program_upgrade_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package extensionhost

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/modules"
)

// Install through the prior host's public registry API, then reopen with the
// current host. The old bytes are deliberately absent from its trust catalog.
func TestBundledNativeProgramsUpgradeWithoutRevivingRemovedOrDisabled(t *testing.T) {
	packages, err := OfficialPackages()
	if err != nil {
		t.Fatal(err)
	}
	for _, current := range packages {
		switch current.Manifest.ID {
		case "aieyra.browser", "aieyra.link", "aieyra.center", "aieyra.tool.image_gen", "aieyra.tool.terminal", "aieyra.tool.update_plan":
		default:
			continue
		}
		for _, state := range []string{"enabled", "disabled", "removed", "corrupt", "new-permission", "new-schema"} {
			t.Run(current.Manifest.ID+"/"+state, func(t *testing.T) {
				ctx := context.Background()
				files := map[string][]byte{}
				for name, data := range current.Files {
					files[name] = append([]byte(nil), data...)
				}
				var manifest modules.Manifest
				if err := json.Unmarshal(files["manifest.json"], &manifest); err != nil {
					t.Fatal(err)
				}
				manifest.Version = "1.0.0"
				name := "README.md"
				files[name] = []byte("Prior host public payload\n")
				hash := sha256.Sum256(files[name])
				manifest.Files[name] = modules.File{SHA256: hex.EncodeToString(hash[:]), Size: int64(len(files[name]))}
				files["manifest.json"], _ = json.Marshal(manifest)
				prior, err := modules.FromFiles(files)
				if err != nil {
					t.Fatal(err)
				}
				root := t.TempDir()
				old := New(root, Desktop())
				old.OfficialDigests[manifest.ID] = []string{prior.Digest}
				if manifest.Kind == "tool" || manifest.Kind == "toolbox" {
					// Model the prior executable's exact native trust catalogue. The current
					// native tool decoder deliberately cannot execute the old payload.
					old.ValidatePackage = func(p *modules.Package) error {
						if p.Digest != prior.Digest {
							return fmt.Errorf("not compiled by prior host")
						}
						return nil
					}
				}
				old.DefaultPackages = func() ([]*modules.Package, error) { return []*modules.Package{prior}, nil }
				before, err := old.Call(ctx, modules.Request{Action: "resolve", ID: manifest.ID})
				if err != nil {
					t.Fatal(err)
				}
				mutate := func(action string) {
					t.Helper()
					before, err = old.Call(ctx, modules.Request{Action: action, ID: manifest.ID, ExpectedRevision: &before.Revision, ExpectedDigest: prior.Digest, RequestID: "prior-host-" + action})
					if err != nil {
						t.Fatal(err)
					}
				}
				if state == "disabled" || state == "removed" {
					mutate("disable")
				}
				if state == "removed" {
					mutate("remove")
				}
				retained := filepath.Join(root, "private-state.txt")
				if err := os.WriteFile(retained, []byte("untouched"), 0600); err != nil {
					t.Fatal(err)
				}
				if state == "corrupt" {
					if err := os.WriteFile(filepath.Join(before.Item.Directory, name), []byte("tampered"), 0600); err != nil {
						t.Fatal(err)
					}
				}
				next := New(root, Desktop())
				if state == "new-permission" || state == "new-schema" {
					var changed modules.Manifest
					if err := json.Unmarshal(current.Files["manifest.json"], &changed); err != nil {
						t.Fatal(err)
					}
					if state == "new-permission" {
						changed.Permissions = []modules.Permission{{Capability: "network.https", Scope: "https://example.com", Reason: "Migration permission regression"}}
					} else {
						changed.Data.Schema++
					}
					updated := map[string][]byte{}
					for name, data := range current.Files {
						updated[name] = append([]byte(nil), data...)
					}
					updated["manifest.json"], _ = json.Marshal(changed)
					destination, err := modules.FromFiles(updated)
					if err != nil {
						t.Fatal(err)
					}
					next.OfficialDigests[manifest.ID] = []string{destination.Digest}
					next.DefaultPackages = func() ([]*modules.Package, error) { return []*modules.Package{destination}, nil }
				}
				if err := next.ValidatePackage(prior); err == nil {
					t.Fatal("old native bytes acquired current execution trust")
				}
				registryBefore, err := os.ReadFile(filepath.Join(root, "installed.json"))
				if err != nil {
					t.Fatal(err)
				}
				result, err := next.Call(ctx, modules.Request{Action: "list"})
				if state == "corrupt" || state == "new-permission" || state == "new-schema" {
					if err == nil {
						t.Fatal("invalid migration silently committed")
					}
					after, e := os.ReadFile(filepath.Join(root, "installed.json"))
					if e != nil || string(after) != string(registryBefore) {
						t.Fatal("failed migration changed registry", e)
					}
					return
				}
				if err != nil {
					t.Fatal(err)
				}
				var found *modules.Installed
				for i := range result.Items {
					if result.Items[i].Manifest.ID == manifest.ID {
						found = &result.Items[i]
					}
				}
				if state == "removed" {
					if found != nil {
						t.Fatal("removed program resurrected")
					}
				} else {
					if found == nil || found.Digest != current.Digest || found.Enabled != (state == "enabled") || found.Previous == nil || found.Previous.Digest != prior.Digest {
						t.Fatalf("upgrade state lost: %+v", found)
					}
					if _, err := modules.Load(ctx, found.Previous.Directory); err != nil {
						t.Fatal("old immutable object lost", err)
					}
				}
				bytes, err := os.ReadFile(retained)
				if err != nil || string(bytes) != "untouched" {
					t.Fatal("private data changed", err)
				}
				again, err := New(root, Desktop()).Call(ctx, modules.Request{Action: "list"})
				if err != nil || again.Revision != result.Revision {
					t.Fatal("restart repeated migration", err)
				}
			})
		}
	}
}
