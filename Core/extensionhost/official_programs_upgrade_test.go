// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/extensionhost/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestOfficialServersUpgradePreLifecycleFixBindings; TestOfficialServersUpgradeSharedShellBindings; TestOfficialWorkspaceUpgradeStorageReadyBindings; verifyOfficialProgramUpgrade; TestOfficialWorkspacePreviousInstalledPayloadUpgrade
// Impact: python -B scripts/code-atlas.py show Core/extensionhost/official_programs_upgrade_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package extensionhost

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/modules"
)

func TestOfficialServersUpgradePreLifecycleFixBindings(t *testing.T) {
	raw, err := os.ReadFile("testdata/servers-before-lifecycle-cleanup.json")
	if err != nil {
		t.Fatal(err)
	}
	var files map[string][]byte
	if err := json.Unmarshal(raw, &files); err != nil {
		t.Fatal(err)
	}
	prior, err := modules.FromFiles(files)
	if err != nil {
		t.Fatal(err)
	}
	if prior.Manifest.ID != "aieyra.servers" || prior.Manifest.Version != "1.0.1" || prior.Digest != "f5e1b928238eeee8c906c163277c589c33f36da38bc144da61db8ab17503702d" {
		t.Fatal("historical server fixture differs from the verified source backup")
	}
	verifyOfficialProgramUpgrade(t, prior, "service.cjs")
}

func TestOfficialServersUpgradeSharedShellBindings(t *testing.T) {
	raw, err := os.ReadFile("testdata/servers-before-shared-shell114.json")
	if err != nil {
		t.Fatal(err)
	}
	var files map[string][]byte
	if err = json.Unmarshal(raw, &files); err != nil {
		t.Fatal(err)
	}
	prior, err := modules.FromFiles(files)
	if err != nil {
		t.Fatal(err)
	}
	if prior.Manifest.ID != "aieyra.servers" || prior.Manifest.Version != "1.0.3" || prior.Digest != "9b4a78232e695cdca25876ca524dc9107d228fea7fc6927a64b9fdf8c2b97eff" {
		t.Fatal("prior server payload changed", prior.Digest)
	}
	verifyOfficialProgramUpgrade(t, prior, "ui/app-servers.mjs")
}

func TestOfficialWorkspaceUpgradeStorageReadyBindings(t *testing.T) {
	raw, err := os.ReadFile("testdata/workspace-1.0.0.json")
	if err != nil {
		t.Fatal(err)
	}
	// Bounded base64 rows retain the exact public package without giant tokens
	// that make source privacy scanning unnecessarily expensive.
	var encoded map[string][]string
	if err := json.Unmarshal(raw, &encoded); err != nil {
		t.Fatal(err)
	}
	files := make(map[string][]byte, len(encoded))
	for name, chunks := range encoded {
		files[name], err = base64.StdEncoding.DecodeString(strings.Join(chunks, ""))
		if err != nil {
			t.Fatal(err)
		}
	}
	prior, err := modules.FromFiles(files)
	if err != nil {
		t.Fatal(err)
	}
	if prior.Manifest.ID != "aieyra.workspace" || prior.Manifest.Version != "1.0.0" || prior.Digest != "7d37038fe419d6d4c42b205073ed2fccce5da3cbc4dc594d6a2436e0d5b828eb" {
		t.Fatal("historical Workspace fixture differs from the verified build-51f2b9fa package")
	}
	verifyOfficialProgramUpgrade(t, prior, "desktop/canvas-storage.cjs")
}

func verifyOfficialProgramUpgrade(t *testing.T, prior *modules.Package, entry string) {
	t.Helper()
	packages, err := OfficialPackages()
	if err != nil {
		t.Fatal(err)
	}
	var current *modules.Package
	for i, pkg := range packages {
		if pkg.Manifest.ID == prior.Manifest.ID {
			current, packages[i] = pkg, prior
		}
	}
	if current == nil || current.Digest == prior.Digest {
		t.Fatal("lifecycle fixes must ship a new program package")
	}
	for _, state := range []string{"enabled", "disabled", "removed"} {
		t.Run(state, func(t *testing.T) {
			ctx, root := context.Background(), t.TempDir()
			old := New(filepath.Join(root, "modules"), Desktop())
			old.OfficialDigests[prior.Manifest.ID] = []string{prior.Digest}
			if prior.Manifest.Kind == "tool" || prior.Manifest.Kind == "toolbox" {
				validate := old.ValidatePackage
				old.ValidatePackage = func(p *modules.Package) error {
					// Model the old executable's compiled native adapter, never a
					// runtime grant to execute imported native source.
					if p.Digest == prior.Digest {
						return nil
					}
					return validate(p)
				}
			}
			old.DefaultPackages = func() ([]*modules.Package, error) { return packages, nil }
			before, err := old.Call(ctx, modules.Request{Action: "resolve", ID: prior.Manifest.ID})
			if err != nil || before.Item == nil || before.Item.Digest != prior.Digest {
				t.Fatal("cannot provision the actual pre-fix program package", err)
			}
			oldDirectory, grants := before.Item.Directory, before.Item.Grants
			if state != "enabled" {
				before, err = old.Call(ctx, modules.Request{Action: "disable", ID: prior.Manifest.ID, ExpectedDigest: prior.Digest, ExpectedRevision: &before.Revision, RequestID: "disable-program"})
				if err != nil {
					t.Fatal(err)
				}
			}
			if state == "removed" {
				before, err = old.Call(ctx, modules.Request{Action: "remove", ID: prior.Manifest.ID, ExpectedDigest: prior.Digest, ExpectedRevision: &before.Revision, RequestID: "remove-program"})
				if err != nil {
					t.Fatal(err)
				}
			}
			userFile := filepath.Join(root, "program-user-data")
			userBytes := []byte("original profiles and program state\x00\xff\r\n")
			if err := os.WriteFile(userFile, userBytes, 0600); err != nil {
				t.Fatal(err)
			}
			next := New(old.Root, Desktop())
			listed, err := next.Call(ctx, modules.Request{Action: "list"})
			if err != nil {
				t.Fatal(err)
			}
			var found *modules.Installed
			for i := range listed.Items {
				if listed.Items[i].Manifest.ID == prior.Manifest.ID {
					found = &listed.Items[i]
				}
			}
			if state == "removed" {
				if found != nil || listed.Revision != before.Revision {
					t.Fatal("upgrade revived an explicitly removed program")
				}
			} else if found == nil || found.Digest != current.Digest || found.Enabled != (state == "enabled") ||
				found.Previous == nil || found.Previous.Digest != prior.Digest || found.Previous.Directory != oldDirectory ||
				!reflect.DeepEqual(found.Grants, grants) || listed.Revision != before.Revision+1 {
				t.Fatalf("existing %s installation did not adopt the repaired package while preserving user state: %+v", state, found)
			}
			resolved, resolveErr := next.Call(ctx, modules.Request{Action: "resolve", ID: prior.Manifest.ID})
			if state == "enabled" && (resolveErr != nil || resolved.Item == nil || resolved.Item.Digest != current.Digest) {
				t.Fatal("updated program cannot execute", resolveErr)
			}
			if state != "enabled" && resolveErr == nil {
				t.Fatal("disabled or removed program regained execution")
			}
			retained, err := modules.Load(ctx, oldDirectory)
			if err != nil || retained.Digest != prior.Digest || !bytes.Equal(retained.Files[entry], prior.Files[entry]) {
				t.Fatal("update changed the previous immutable object", err)
			}
			if data, err := os.ReadFile(userFile); err != nil || !bytes.Equal(data, userBytes) {
				t.Fatal("update changed user data", err)
			}
			registry, err := os.ReadFile(filepath.Join(old.Root, "installed.json"))
			if err != nil {
				t.Fatal(err)
			}
			if _, err := New(old.Root, Desktop()).Call(ctx, modules.Request{Action: "list"}); err != nil {
				t.Fatal(err)
			}
			if after, err := os.ReadFile(filepath.Join(old.Root, "installed.json")); err != nil || !bytes.Equal(after, registry) {
				t.Fatal("reopening repeated the package update", err)
			}
		})
	}
}

func TestOfficialWorkspacePreviousInstalledPayloadUpgrade(t *testing.T) {
	dir := os.Getenv("AIEYRA_PREVIOUS_WORKSPACE_PACKAGE")
	if dir == "" {
		t.Skip("previous public Workspace package supplied by acceptance")
	}
	prior, err := modules.Load(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if prior.Manifest.ID != "aieyra.workspace" || prior.Manifest.Version != "1.0.5" {
		t.Fatal("unexpected previous Workspace payload")
	}
	verifyOfficialProgramUpgrade(t, prior, "src/main.tsx")
}
