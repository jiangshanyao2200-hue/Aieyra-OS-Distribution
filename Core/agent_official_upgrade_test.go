// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestFixedRoleRetainsPreviousOfficialPromptPackage
// Impact: python -B scripts/code-atlas.py show Core/agent_official_upgrade_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/extensionhost"
	"github.com/aieyra/aieyra-os/CORE/modules"
)

func TestFixedRoleRetainsPreviousOfficialPromptPackage(t *testing.T) {
	for _, tc := range []struct{ id, version, role, digest string }{
		{"aieyra.eyra", "1.0.0", WorkspaceMatrix, "23f1f4b3da2f2a23b53b08f3e9d68207d922bc41d3a4f22008645bbeb5351338"},
		{"aieyra.eyra", "1.0.1", WorkspaceMatrix, "32ae07a68a17edb45ee3f8dba82f45960089b702475431f1a83ff878b748129f"},
		{"aieyra.cota", "1.0.0", WorkspaceExecution, "9c2ef6da12fa4827f345211c8e3bd9b8148adb80b413917c459f778610c41cbb"},
		{"aieyra.vaya", "1.0.0", WorkspaceProject, "0516016734ebe09c98db08f78f6c482f74af093bce44dbbd7657bbca9ff358a2"},
	} {
		t.Run(tc.id+"@"+tc.version, func(t *testing.T) {
			m, _ := matrixTestManager(t, nil)
			t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
			h := NewWorkspaceHost(m.config, "", "")
			h.mode = HostOS
			m.workspace = &Workspace{host: h}
			packages, err := extensionhost.OfficialPackages()
			if err != nil {
				t.Fatal(err)
			}
			fixture, err := os.ReadFile("testdata/official-agents-pre87.json")
			if err != nil {
				t.Fatal(err)
			}
			var historical map[string]map[string]string
			if err = json.Unmarshal(fixture, &historical); err != nil {
				t.Fatal(err)
			}
			var previous *modules.Package
			for i, pkg := range packages {
				if pkg.Manifest.ID != tc.id {
					continue
				}
				// Historical bytes must not be reconstructed from today's prompts.
				files := map[string][]byte{}
				for name, text := range historical[tc.id+"@"+tc.version] {
					files[name] = []byte(text)
				}
				previous, err = modules.FromFiles(files)
				if err != nil {
					t.Fatal("previous public payload no longer matches its recorded manifest", err)
				}
				packages[i] = previous
			}
			if previous == nil || previous.Digest != tc.digest {
				t.Fatal("unexpected previous package", previous)
			}
			service := m.toolPackages()
			service.DefaultPackages = func() ([]*modules.Package, error) { return packages, nil }
			ctx := context.Background()
			before, err := service.Call(ctx, modules.Request{Action: "resolve", ID: tc.id})
			if err != nil || before.Item == nil || before.Item.Digest != previous.Digest {
				t.Fatal(before, err)
			}
			registry := filepath.Join(service.Root, "installed.json")
			bytesBefore, err := os.ReadFile(registry)
			if err != nil {
				t.Fatal(err)
			}
			// A fresh manager now sees the new compiled package. Existing installation
			// and fixed-role admission must remain on the exact trusted old binding.
			if err = m.admitFixedRole(ctx, tc.role); err != nil {
				t.Fatal(err)
			}
			exported, err := m.exportAgentTemplate(ctx, m.owner, agentPackageCommand{Package: "mod:" + tc.id + "@" + previous.Digest})
			if err != nil {
				t.Fatal("previous installed public template is unavailable", err)
			}
			archive := filepath.Join(t.TempDir(), "previous.zip")
			if err = os.WriteFile(archive, exported.Archive, 0600); err != nil {
				t.Fatal(err)
			}
			loaded, err := modules.Load(ctx, archive)
			if err != nil || loaded.Digest != previous.Digest {
				t.Fatal("export substituted the newer public template", err)
			}
			bytesAfter, err := os.ReadFile(registry)
			if err != nil || !bytes.Equal(bytesBefore, bytesAfter) {
				t.Fatal("new host changed an existing package binding", err)
			}
			if tc.id != "aieyra.eyra" {
				// Disable the dependant first; dependency enforcement is part of
				// the retained contract, not something an upgrade may bypass.
				changeOfficialPackage(t, m, "disable", "aieyra.eyra", "previous-controller-disable")
			}
			changeOfficialPackage(t, m, "disable", tc.id, "previous-eyra-disable")
			if err = m.admitFixedRole(ctx, tc.role); err == nil {
				t.Fatal("new host revived the disabled previous package")
			}
			changeOfficialPackage(t, m, "enable", tc.id, "previous-eyra-enable")
			if err = m.admitFixedRole(ctx, tc.role); err != nil {
				t.Fatal("explicit re-enable lost old package compatibility", err)
			}
		})
	}
}
