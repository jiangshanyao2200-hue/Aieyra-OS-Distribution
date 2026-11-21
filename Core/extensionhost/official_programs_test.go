// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/extensionhost/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestOfficialProgramsUseRegistryAndPreserveUserDisableAndData; TestNativeProgramDeclarationDoesNotGrantHostPrivileges
// Impact: python -B scripts/code-atlas.py show Core/extensionhost/official_programs_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package extensionhost

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/modules"
)

func TestOfficialProgramsUseRegistryAndPreserveUserDisableAndData(t *testing.T) {
	ctx := context.Background()
	m := New(t.TempDir(), Desktop())
	for _, id := range []string{"aieyra.browser", "aieyra.servers", "aieyra.link", "aieyra.together"} {
		current, err := m.Call(ctx, modules.Request{Action: "resolve", ID: id})
		if err != nil || current.Item == nil || current.Item.Origin != "official" || !current.Item.Enabled {
			t.Fatal("native program not admitted by common registry", id, current, err)
		}
		if len(current.Item.Manifest.Files) < 7 {
			t.Fatal("native package omitted actual business code and page", id)
		}
		file := filepath.Join(m.Root, "retained-program-data")
		if err := os.WriteFile(file, []byte("user data"), 0600); err != nil {
			t.Fatal(err)
		}
		disabled, err := m.Call(ctx, modules.Request{Action: "disable", ID: id, ExpectedDigest: current.Item.Digest, ExpectedRevision: &current.Revision, RequestID: "disable-" + id})
		if err != nil {
			t.Fatal(err)
		}
		m = New(m.Root, Desktop())
		if _, err = m.Call(ctx, modules.Request{Action: "resolve", ID: id}); err == nil {
			t.Fatal("native program bypassed explicit disable after reopen")
		}
		if _, err = m.Call(ctx, modules.Request{Action: "remove", ID: id, ExpectedDigest: disabled.Item.Digest, ExpectedRevision: &disabled.Revision, RequestID: "remove-" + id}); err != nil {
			t.Fatal(err)
		}
		m = New(m.Root, Desktop())
		if _, err = m.Call(ctx, modules.Request{Action: "resolve", ID: id}); err == nil {
			t.Fatal("native program reappeared after removal")
		}
		if data, err := os.ReadFile(file); err != nil || string(data) != "user data" {
			t.Fatal("program removal touched unrelated user data", err)
		}
	}
}

func TestNativeProgramDeclarationDoesNotGrantHostPrivileges(t *testing.T) {
	packages, err := OfficialPackages()
	if err != nil {
		t.Fatal(err)
	}
	var source *modules.Package
	for _, pkg := range packages {
		if pkg.Manifest.ID == "aieyra.servers" {
			source = pkg
		}
	}
	if source == nil {
		t.Fatal("missing servers package")
	}
	// An otherwise valid local package copies the native declaration and payload.
	// Local identity, paths and a claim to the official publisher grant no adapter.
	source.Manifest.ID = "example.servers"
	source.Manifest.Publisher = "example"
	source.Files["manifest.json"], err = json.Marshal(source.Manifest)
	if err != nil {
		t.Fatal(err)
	}
	copy, err := modules.FromFiles(source.Files)
	if err != nil {
		t.Fatal(err)
	}
	m := New(t.TempDir(), Desktop())
	if err = m.ValidatePackage(copy); err == nil {
		t.Fatal("local native declaration acquired host privileges")
	}
	inspection, err := m.Inspect(context.Background(), officialCatalogSource(t, copy))
	if err != nil || inspection.Compatibility.Compatible {
		t.Fatal("forged native package must be incompatible", inspection, err)
	}
}
