// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/extensionhost/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestAuthorExampleUsesSharedProgramContract; TestAuthorThemeUsesSharedCompatibilityAndRejectsMissingSlots; TestThemeAssetsUseCommonAdmissionAndVersionNegotiation; TestHaloUsesIndependentContractAndSharedPackageLifecycle
// Impact: python -B scripts/code-atlas.py show Core/extensionhost/desktop_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package extensionhost

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/modules"
)

func TestAuthorExampleUsesSharedProgramContract(t *testing.T) {
	source, err := filepath.Abs(filepath.Join("..", "..", "SDK", "examples", "program-notebook"))
	if err != nil {
		t.Fatal(err)
	}
	m := New(t.TempDir(), Desktop())
	p, err := m.Inspect(context.Background(), source)
	if err != nil || !p.Compatibility.Compatible {
		t.Fatalf("example invalid: %+v %v", p, err)
	}
	p, err = m.Call(context.Background(), modules.Request{Action: "install", Source: source, Origin: "local", ExpectedDigest: p.Digest, ExpectedRevision: &p.Revision, RequestID: "example-install"})
	if err != nil {
		t.Fatal(err)
	}
	p, err = m.Call(context.Background(), modules.Request{Action: "enable", ID: p.Item.Manifest.ID, ExpectedDigest: p.Digest, ExpectedRevision: &p.Revision, RequestID: "example-enable"})
	if err != nil {
		t.Fatal(err)
	}
	p, err = m.Call(context.Background(), modules.Request{Action: "resolve", ID: p.Item.Manifest.ID})
	if err != nil || !p.OK {
		t.Fatal(p, err)
	}
	if _, err = os.Stat(filepath.Join(p.Directory, "program.json")); err != nil {
		t.Fatal(err)
	}
	pkg, err := modules.Load(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	pkg.Files["program.json"] = []byte(`{"schema":"aieyra.program/1","mode":"invented","desktop":{"entry":"index.html"},"operations":[]}`)
	if m.ValidatePackage(pkg) == nil {
		t.Fatal("unsupported program contract accepted")
	}
}

func TestAuthorThemeUsesSharedCompatibilityAndRejectsMissingSlots(t *testing.T) {
	source, err := filepath.Abs(filepath.Join("..", "..", "SDK", "examples", "theme-columns"))
	if err != nil {
		t.Fatal(err)
	}
	m := New(t.TempDir(), Desktop())
	p, err := m.Inspect(context.Background(), source)
	if err != nil || !p.Compatibility.Compatible {
		t.Fatalf("theme invalid: %+v %v", p, err)
	}
	old := Desktop()
	old.Contracts["theme"] = "1.1.0"
	older, oldErr := New(t.TempDir(), old).Inspect(context.Background(), source)
	if oldErr != nil || older.Compatibility.Compatible {
		t.Fatalf("old host admitted theme presets: %+v %v", older, oldErr)
	}
	pkg, err := modules.Load(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	pkg.Files["theme.json"] = []byte(`{"schema":"aieyra.theme/1","elements":"1.0.0","layouts":{"message":{"slot":"avatar"}}}`)
	if m.ValidatePackage(pkg) == nil {
		t.Fatal("theme losing message content accepted")
	}
}

func TestThemeAssetsUseCommonAdmissionAndVersionNegotiation(t *testing.T) {
	source, err := filepath.Abs(filepath.Join("..", "..", "SDK", "examples", "theme-assets"))
	if err != nil {
		t.Fatal(err)
	}
	m := New(t.TempDir(), Desktop())
	p, err := m.Inspect(context.Background(), source)
	if err != nil || !p.Compatibility.Compatible {
		t.Fatalf("assets example invalid: %+v %v", p, err)
	}
	old := Desktop()
	old.Contracts["theme"] = "1.0.0"
	p, err = New(t.TempDir(), old).Inspect(context.Background(), source)
	if err != nil || p.Compatibility.Compatible {
		t.Fatalf("old host should report incompatible assets contract: %+v %v", p, err)
	}
	pkg, err := modules.Load(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	delete(pkg.Files, "assets/paper.png")
	if m.ValidatePackage(pkg) == nil {
		t.Fatal("missing asset admitted")
	}
}

func TestHaloUsesIndependentContractAndSharedPackageLifecycle(t *testing.T) {
	source, err := filepath.Abs(filepath.Join("..", "..", "SDK", "examples", "halo-prism"))
	if err != nil {
		t.Fatal(err)
	}
	m := New(t.TempDir(), Desktop())
	p, err := m.Inspect(context.Background(), source)
	if err != nil || !p.Compatibility.Compatible {
		t.Fatalf("halo invalid: %+v %v", p, err)
	}
	old := Desktop()
	delete(old.Contracts, "halo")
	prior, err := New(t.TempDir(), old).Inspect(context.Background(), source)
	if err != nil || prior.Compatibility.Compatible {
		t.Fatalf("old host must reject halo: %+v %v", prior, err)
	}
	p, err = m.Call(context.Background(), modules.Request{Action: "install", Source: source, Origin: "local", ExpectedDigest: p.Digest, ExpectedRevision: &p.Revision, RequestID: "halo-install"})
	if err != nil {
		t.Fatal(err)
	}
	p, err = m.Call(context.Background(), modules.Request{Action: "enable", ID: p.Item.Manifest.ID, ExpectedDigest: p.Digest, ExpectedRevision: &p.Revision, RequestID: "halo-enable"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.Call(context.Background(), modules.Request{Action: "resolve", ID: p.Item.Manifest.ID}); err != nil {
		t.Fatal(err)
	}
	pkg, err := modules.Load(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	pkg.Manifest.Permissions = []modules.Permission{{Capability: "network.https", Scope: "https://example.com", Reason: "invalid halo permission"}}
	if m.ValidatePackage(pkg) == nil {
		t.Fatal("halo execution permission admitted")
	}
	pkg.Manifest.Permissions = nil
	pkg.Files["halo.json"] = []byte(`{"schema":"aieyra.halo/1","preset":"classic","script":"bad"}`)
	if m.ValidatePackage(pkg) == nil {
		t.Fatal("executable halo content admitted")
	}
}
