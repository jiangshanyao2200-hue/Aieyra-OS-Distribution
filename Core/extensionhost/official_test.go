// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/extensionhost/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestOfficialHaloUsesSharedRegistryWithoutTrustingImportClaims
// Impact: python -B scripts/code-atlas.py show Core/extensionhost/official_test.go
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

func TestOfficialHaloUsesSharedRegistryWithoutTrustingImportClaims(t *testing.T) {
	ctx := context.Background()
	source, err := filepath.Abs(filepath.Join("..", "..", "Halo", "official", "classic"))
	if err != nil {
		t.Fatal(err)
	}
	m := New(t.TempDir(), Desktop())
	// This test exercises explicit import, separately from shipped defaults.
	m.DefaultPackages = nil
	p, err := m.Inspect(ctx, source)
	if err != nil || !p.Compatibility.Compatible || p.Origin != "official" {
		t.Fatalf("official inspection: %+v %v", p, err)
	}
	initialRevision := p.Revision
	request := modules.Request{Action: "install", Source: source, Origin: "local", ExpectedDigest: p.Digest, ExpectedRevision: &initialRevision, RequestID: "official-halo-import"}
	one, err := m.Call(ctx, request)
	if err != nil || !one.OK {
		t.Fatalf("official import: %+v %v", one, err)
	}
	if one.Item.Origin != "official" || one.Item.Enabled {
		t.Fatal("host must identify official bytes without auto-enabling")
	}
	p, err = m.Call(ctx, modules.Request{Action: "enable", ID: one.Item.Manifest.ID, ExpectedDigest: one.Digest, ExpectedRevision: &one.Revision, RequestID: "official-halo-enable"})
	if err != nil || !p.OK {
		t.Fatal(p, err)
	}
	m = New(m.Root, Desktop())
	m.DefaultPackages = nil
	resolved, err := m.Call(ctx, modules.Request{Action: "resolve", ID: one.Item.Manifest.ID})
	if err != nil || resolved.Item == nil || resolved.Item.Digest != one.Digest {
		t.Fatal(resolved, err)
	}
	if _, err := modules.New(m.Root, Desktop()).Call(ctx, modules.Request{Action: "resolve", ID: one.Item.Manifest.ID}); err == nil {
		t.Fatal("untrusted host resolved an official package using registry metadata alone")
	}
	replay, err := m.Call(ctx, request)
	if err != nil || !replay.Replayed || replay.Item.Enabled {
		t.Fatal("import replay lost its original receipt", replay, err)
	}
	// A claimed official origin is never an authorization, even for known bytes.
	request.Origin, request.RequestID, request.ExpectedRevision = "official", "self-declared-official", &p.Revision
	if _, err = m.Call(ctx, request); err == nil {
		t.Fatal("importer selected its own trust")
	}
	// Recompute an otherwise valid manifest: unknown versions and changed identity
	// metadata must not inherit trust from the publisher name or source directory.
	pkg, err := modules.Load(ctx, source)
	if err != nil {
		t.Fatal(err)
	}
	for _, change := range []string{"version", "name", "identity"} {
		t.Run(change, func(t *testing.T) {
			copyDir := t.TempDir()
			manifest := pkg.Manifest
			switch change {
			case "version":
				manifest.Version = "9.0.0"
			case "name":
				manifest.Name = "Impersonated official halo"
			case "identity":
				manifest.ID = "aieyra.unknown-halo"
			}
			raw, e := json.Marshal(manifest)
			if e != nil {
				t.Fatal(e)
			}
			for name, data := range pkg.Files {
				if name == "manifest.json" {
					data = raw
				}
				if e = os.WriteFile(filepath.Join(copyDir, name), data, 0600); e != nil {
					t.Fatal(e)
				}
			}
			bad, e := m.Inspect(ctx, copyDir)
			if e != nil {
				t.Fatal(e)
			}
			if bad.Compatibility.Compatible {
				t.Fatal("untrusted official package appeared compatible")
			}
			if _, e = m.Call(ctx, modules.Request{Action: "install", Source: copyDir, Origin: "local", ExpectedDigest: bad.Digest, ExpectedRevision: &bad.Revision, RequestID: "reject-official-" + change}); e == nil {
				t.Fatal("untrusted official bytes imported")
			}
		})
	}
	p, err = m.Call(ctx, modules.Request{Action: "disable", ID: one.Item.Manifest.ID, ExpectedDigest: one.Digest, ExpectedRevision: &p.Revision, RequestID: "official-halo-disable"})
	if err != nil || !p.OK {
		t.Fatal(p, err)
	}
	if _, err = m.Call(ctx, modules.Request{Action: "resolve", ID: one.Item.Manifest.ID}); err == nil {
		t.Fatal("official bypassed disable")
	}
	if _, err = m.Call(ctx, modules.Request{Action: "remove", ID: one.Item.Manifest.ID, ExpectedDigest: one.Digest, ExpectedRevision: &p.Revision, RequestID: "official-halo-remove"}); err != nil {
		t.Fatal(err)
	}
}
