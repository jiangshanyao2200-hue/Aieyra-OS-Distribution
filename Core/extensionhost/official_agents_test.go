// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/extensionhost/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: beforeFloatingPackage; TestOfficialEyraRetainsBeforeFloatingBindings; TestOfficialBrowserUpgradesBeforeFloatingBindings; officialCatalogSource; TestOfficialSpecialistsRetainPre114Bindings; TestOfficialCotaRetainsBeforeReportBindings; officialCatalogSnapshot; TestOfficialAgentCatalogAdmitsExactOwnerPackages; TestOfficialAgentCatalogRejectsForgedIdentityAndUnknownDigest; eyraBeforeRetiredNotesCleanup; TestOfficialEyraRetainsPreRetiredNotesCleanupBindings; eyraBeforeCodingManual; TestOfficialEyraRetainsPreCodingManualBindings; TestOfficialEyraRetainsPreWorkspaceManualBindings; TestOfficialEyraRetainsPrePromptCleanupBindings; assertOfficialEyraRetainsBindings; TestOfficialPackagesReturnIndependentSnapshots; TestOfficialDigestCatalogReturnsIndependentSnapshots
// Impact: python -B scripts/code-atlas.py show Core/extensionhost/official_agents_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package extensionhost

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/modules"
)

// Frozen public payloads were checked file by file against the completed R28
// and R29 build receipts, never copied from a user's installed registry.
func beforeFloatingPackage(t *testing.T, key, digest string) *modules.Package {
	t.Helper()
	raw, err := os.ReadFile("testdata/official-before-floating.json")
	if err != nil {
		t.Fatal(err)
	}
	var snapshots map[string]map[string][]string
	if err = json.Unmarshal(raw, &snapshots); err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{}
	for name, chunks := range snapshots[key] {
		files[name], err = base64.StdEncoding.DecodeString(strings.Join(chunks, ""))
		if err != nil {
			t.Fatal(err)
		}
	}
	pkg, err := modules.FromFiles(files)
	if err != nil || pkg.Digest != digest {
		t.Fatal("historical public package differs from its completed build", key, err)
	}
	return pkg
}

func TestOfficialEyraRetainsBeforeFloatingBindings(t *testing.T) {
	for build, digest := range map[string]string{
		"r28": "090bd68b57e457c7ffba7db261c7b4a01465cb30cd76f620007820b3360b7e1d",
		"r29": "9304911dc9f699985b1eeb12a355ff5cae05edf3ef3feb59aac9203bead256c2",
	} {
		t.Run(build, func(t *testing.T) {
			prior := beforeFloatingPackage(t, build+"/aieyra.eyra", digest)
			assertOfficialEyraRetainsBindings(t, prior)
		})
	}
}

func TestOfficialBrowserUpgradesBeforeFloatingBindings(t *testing.T) {
	for build, digest := range map[string]string{
		"r28": "506c9b9331ee3465af05ecf92e15af4b020bfb1f6d613c8818c78b3d4a4d5d2e",
		"r29": "177de9c7007fdfc8dd82439fcebe89c1b418fcb56f111c998df3d2b9fa57e56f",
	} {
		t.Run(build, func(t *testing.T) {
			prior := beforeFloatingPackage(t, build+"/aieyra.browser", digest)
			verifyOfficialProgramUpgrade(t, prior, "service/browser-runtime.cjs")
		})
	}
}

func officialCatalogSource(t *testing.T, pkg *modules.Package) string {
	t.Helper()
	dir := t.TempDir()
	for name, data := range pkg.Files {
		file := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestOfficialSpecialistsRetainPre114Bindings(t *testing.T) {
	data, err := os.ReadFile("testdata/official-agents-pre114.json")
	if err != nil {
		t.Fatal(err)
	}
	var snapshots map[string]map[string][]byte
	if err := json.Unmarshal(data, &snapshots); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"aieyra.cota", "aieyra.vaya"} {
		t.Run(id, func(t *testing.T) {
			prior, err := modules.FromFiles(snapshots[id])
			if err != nil {
				t.Fatal(err)
			}
			if prior.Manifest.ID != id || prior.Manifest.Version != "1.1.2" {
				t.Fatal("wrong previous package", prior.Manifest)
			}
			expected := map[string]string{"aieyra.cota": "c66908a52bd6d5bb74b40a0250321bcd29e3900bbe261b644f4da7aa8350fc70", "aieyra.vaya": "6a62d5a7c3296a47073f94d4fbd2033d10e099ddac185545e7a63dc1a1781603"}
			if prior.Digest != expected[id] {
				t.Fatal("previous public package no longer matches the verified snapshot", prior.Digest)
			}
			assertOfficialEyraRetainsBindings(t, prior)
		})
	}
}

func TestOfficialCotaRetainsBeforeReportBindings(t *testing.T) {
	data, err := os.ReadFile("testdata/cota-before-report114.json")
	if err != nil {
		t.Fatal(err)
	}
	var files map[string][]byte
	if err = json.Unmarshal(data, &files); err != nil {
		t.Fatal(err)
	}
	prior, err := modules.FromFiles(files)
	if err != nil {
		t.Fatal(err)
	}
	if prior.Manifest.Version != "1.1.3" || prior.Digest != "e41eafc72125e8cd56cbb8acef1f58bfd223dff00897fb5368b9dfc0c0b134a3" {
		t.Fatal("prior Cota differs from actual GUI package", prior.Manifest.Version, prior.Digest)
	}
	assertOfficialEyraRetainsBindings(t, prior)
}

func officialCatalogSnapshot(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestOfficialAgentCatalogAdmitsExactOwnerPackages(t *testing.T) {
	packages, err := OfficialPackages()
	if err != nil {
		t.Fatal(err)
	}
	if len(packages) != 17 {
		t.Fatalf("want Halo, three Agents, six Programs and seven native tools, got %d packages", len(packages))
	}
	byID := map[string]*modules.Package{}
	for _, pkg := range packages {
		if byID[pkg.Manifest.ID] != nil {
			t.Fatal("duplicate official package", pkg.Manifest.ID)
		}
		byID[pkg.Manifest.ID] = pkg
	}
	if byID["aieyra.tool.video_gen"] == nil {
		t.Fatal("official video tool missing from the owner catalog")
	}
	if byID["aieyra.workspace"] == nil {
		t.Fatal("official Workspace missing from the owner catalog")
	}
	if byID["aieyra.center"] == nil {
		t.Fatal("official Center missing from the owner catalog")
	}
	m, ctx := New(t.TempDir(), Desktop()), context.Background()
	// Exercise explicit import independently of product default provisioning.
	m.DefaultPackages = nil
	// Eyra's public team declares both members as required dependencies.
	for _, id := range []string{"aieyra.vaya", "aieyra.cota", "aieyra.eyra"} {
		pkg := byID[id]
		if pkg == nil || !reflect.DeepEqual(pkg, bundledAgent(t, id)) {
			t.Fatal("catalog differs from owner-embedded Agent", id)
		}
		source := officialCatalogSource(t, pkg)
		inspection, err := m.Inspect(ctx, source)
		if err != nil || !inspection.Compatibility.Compatible || inspection.Origin != "official" {
			t.Fatalf("official inspection %s: %+v %v", id, inspection, err)
		}
		out, err := m.Call(ctx, modules.Request{Action: "install", Source: source, Origin: "local", ExpectedDigest: inspection.Digest, ExpectedRevision: &inspection.Revision, RequestID: "catalog-install-" + id})
		if err != nil || !out.OK || out.Item == nil || out.Item.Origin != "official" || out.Item.Enabled {
			t.Fatalf("official installation %s: %+v %v", id, out, err)
		}
	}
}

func TestOfficialAgentCatalogRejectsForgedIdentityAndUnknownDigest(t *testing.T) {
	for _, change := range []string{"identity", "payload"} {
		t.Run(change, func(t *testing.T) {
			pkg := bundledAgent(t, "aieyra.vaya")
			name := "manual.md"
			if change == "identity" {
				pkg.Manifest.ID = "aieyra.unknown-agent"
				name = "definition.json"
				var definition map[string]any
				if err := json.Unmarshal(pkg.Files[name], &definition); err != nil {
					t.Fatal(err)
				}
				definition["id"] = pkg.Manifest.ID
				var err error
				pkg.Files[name], err = json.Marshal(definition)
				if err != nil {
					t.Fatal(err)
				}
			} else {
				pkg.Files[name] = append(pkg.Files[name], []byte("\nUnshipped public manual revision.\n")...)
			}
			sum := sha256.Sum256(pkg.Files[name])
			pkg.Manifest.Files[name] = modules.File{SHA256: hex.EncodeToString(sum[:]), Size: int64(len(pkg.Files[name]))}
			raw, err := json.Marshal(pkg.Manifest)
			if err != nil {
				t.Fatal(err)
			}
			pkg.Files["manifest.json"] = raw
			pkg, err = modules.FromFiles(pkg.Files)
			if err != nil {
				t.Fatal("forged fixture must pass file integrity", err)
			}
			if _, err := Agent(pkg); err != nil {
				t.Fatal("forged fixture must pass the Agent contract", err)
			}
			m, ctx := New(t.TempDir(), Desktop()), context.Background()
			source := officialCatalogSource(t, pkg)
			inspection, err := m.Inspect(ctx, source)
			if err != nil {
				t.Fatal(err)
			}
			identityRejected := false
			for _, issue := range inspection.Compatibility.Issues {
				identityRejected = identityRejected || issue.Code == "official_identity"
			}
			if inspection.Compatibility.Compatible || inspection.Origin == "official" || !identityRejected {
				t.Fatal("unshipped official claim inherited trust", inspection)
			}
			if _, err := m.Call(ctx, modules.Request{Action: "install", Source: source, Origin: "local", ExpectedDigest: inspection.Digest, ExpectedRevision: &inspection.Revision, RequestID: "reject-catalog-" + change}); err == nil {
				t.Fatal("unshipped official bytes were installed")
			}
		})
	}
	m, ctx := New(t.TempDir(), Desktop()), context.Background()
	source := officialCatalogSource(t, bundledAgent(t, "aieyra.vaya"))
	inspection, err := m.Inspect(ctx, source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Call(ctx, modules.Request{Action: "install", Source: source, Origin: "official", ExpectedDigest: inspection.Digest, ExpectedRevision: &inspection.Revision, RequestID: "reject-self-declared-agent-origin"}); err == nil {
		t.Fatal("importer selected its own official authority")
	}
}

func eyraBeforeRetiredNotesCleanup(t *testing.T) *modules.Package {
	t.Helper()
	// Frozen public payload from the verified round-103 source backup. Historical
	// identity must not depend on whichever package happens to be current.
	raw, err := os.ReadFile("testdata/eyra-before-retired-notes-cleanup.json")
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
	if prior.Manifest.ID != "aieyra.eyra" || prior.Manifest.Version != "1.1.4" || prior.Digest != "d5cf1cb6a508c5024434c1f83bebd549740b8f5647832ffa0bd9b39d7dba7750" {
		t.Fatalf("prior public package differs from verified backup: %s %s %s", prior.Manifest.ID, prior.Manifest.Version, prior.Digest)
	}
	return prior
}

func TestOfficialEyraRetainsPreRetiredNotesCleanupBindings(t *testing.T) {
	assertOfficialEyraRetainsBindings(t, eyraBeforeRetiredNotesCleanup(t))
}

// Frozen public package pinned to the verified pre-109 digest below.
// History must not be reconstructed from today's changing prompts.
func eyraBeforeCodingManual(t *testing.T) *modules.Package {
	t.Helper()
	data, err := os.ReadFile("testdata/eyra-before-coding-manual.json")
	if err != nil {
		t.Fatal(err)
	}
	var files map[string][]byte
	if err := json.Unmarshal(data, &files); err != nil {
		t.Fatal(err)
	}
	prior, err := modules.FromFiles(files)
	if err != nil {
		t.Fatal(err)
	}
	return prior
}

func TestOfficialEyraRetainsPreCodingManualBindings(t *testing.T) {
	prior := eyraBeforeCodingManual(t)
	if prior.Digest != "067d40914e7e9d644adc30459c54993644e567e8d9f6343ce75d2856a5c46c66" {
		t.Fatal("previous public package differs from the verified complete build", prior.Digest)
	}
	assertOfficialEyraRetainsBindings(t, prior)
}

func TestOfficialEyraRetainsPreWorkspaceManualBindings(t *testing.T) {
	prior := eyraBeforeCodingManual(t)
	name := "prompts/tools/软件接口.txt"
	data, err := os.ReadFile("../testdata/eyra-software-interface-pre107.txt")
	if err != nil {
		t.Fatal(err)
	}
	prior.Files[name] = data
	sum := sha256.Sum256(data)
	prior.Manifest.Files[name] = modules.File{SHA256: hex.EncodeToString(sum[:]), Size: int64(len(data))}
	prior.Files["manifest.json"], err = json.Marshal(prior.Manifest)
	if err != nil {
		t.Fatal(err)
	}
	prior, err = modules.FromFiles(prior.Files)
	if err != nil {
		t.Fatal(err)
	}
	if prior.Digest != "b189d8fcd519aa40ffd586b06417737abee7617a7eda35018ec991a1912d63db" {
		t.Fatal("previous public package differs from the verified complete build", prior.Digest)
	}
	assertOfficialEyraRetainsBindings(t, prior)
}

func TestOfficialEyraRetainsPrePromptCleanupBindings(t *testing.T) {
	// Reverse only the two public text removals. The pinned digest covers every
	// payload entry and all manifest metadata in the backed-up Eyra 1.1.4 package.
	prior := eyraBeforeRetiredNotesCleanup(t)
	work, usage := "prompts/default/工作.txt", "context/prompts/使用约定.txt"
	prior.Files[work] = append(prior.Files[work], []byte("\n工作过程中简短说明重要发现、判断和下一步；涉及等待或方向变化时让用户知道进展。完成时用正文说明结果、实际验证及未完成项，详细内容可放入文档。\n")...)
	marker := []byte("独立潜意识、自动日记与梦境维护已退役")
	if bytes.Count(prior.Files[usage], marker) != 1 {
		t.Fatal("prior public memory prompt fixture is ambiguous")
	}
	prior.Files[usage] = bytes.Replace(prior.Files[usage], marker, append([]byte("不要把闲聊变成任务。"), marker...), 1)
	for _, name := range []string{work, usage} {
		sum := sha256.Sum256(prior.Files[name])
		prior.Manifest.Files[name] = modules.File{SHA256: hex.EncodeToString(sum[:]), Size: int64(len(prior.Files[name]))}
	}
	var err error
	prior.Files["manifest.json"], err = json.Marshal(prior.Manifest)
	if err != nil {
		t.Fatal(err)
	}
	prior, err = modules.FromFiles(prior.Files)
	if err != nil {
		t.Fatal(err)
	}
	if prior.Manifest.Version != "1.1.4" || prior.Digest != "79f926c986df60a5df61f1b57de532f9dd0286296f4bd1e5433d6b4d035e4309" {
		t.Fatalf("prior public package differs from verified backup: %s %s", prior.Manifest.Version, prior.Digest)
	}
	assertOfficialEyraRetainsBindings(t, prior)
}

func assertOfficialEyraRetainsBindings(t *testing.T, prior *modules.Package) {
	t.Helper()
	packages, err := OfficialPackages()
	if err != nil {
		t.Fatal(err)
	}
	for i, pkg := range packages {
		if pkg.Manifest.ID == prior.Manifest.ID {
			packages[i] = prior
		}
	}
	for _, enabled := range []bool{true, false} {
		name := "enabled"
		if !enabled {
			name = "disabled"
		}
		t.Run(name, func(t *testing.T) {
			ctx, root := context.Background(), t.TempDir()
			old := New(root, Desktop())
			old.OfficialDigests[prior.Manifest.ID] = []string{prior.Digest}
			old.DefaultPackages = func() ([]*modules.Package, error) { return packages, nil }
			before, err := old.Call(ctx, modules.Request{Action: "resolve", ID: prior.Manifest.ID})
			if err != nil {
				t.Fatal(err)
			}
			if !enabled {
				if prior.Manifest.ID != "aieyra.eyra" {
					mother, e := old.Call(ctx, modules.Request{Action: "resolve", ID: "aieyra.eyra"})
					if e != nil {
						t.Fatal(e)
					}
					disabled, e := old.Call(ctx, modules.Request{Action: "disable", ID: "aieyra.eyra", ExpectedDigest: mother.Item.Digest, ExpectedRevision: &mother.Revision, RequestID: "prior-mother-disable"})
					if e != nil {
						t.Fatal(e)
					}
					before.Revision = disabled.Revision
				}
				before, err = old.Call(ctx, modules.Request{Action: "disable", ID: prior.Manifest.ID, ExpectedDigest: prior.Digest, ExpectedRevision: &before.Revision, RequestID: "prior-eyra-disable"})
				if err != nil {
					t.Fatal(err)
				}
			}
			registry, err := os.ReadFile(filepath.Join(root, "installed.json"))
			if err != nil {
				t.Fatal(err)
			}
			next := New(root, Desktop())
			if err := next.ValidatePackage(prior); err != nil {
				t.Fatal("previous exact package lost official trust", err)
			}
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
			if found == nil || found.Digest != prior.Digest || found.Enabled != enabled || found.Directory != before.Item.Directory {
				t.Fatalf("reopening changed the installed binding: %+v", found)
			}
			after, err := os.ReadFile(filepath.Join(root, "installed.json"))
			if err != nil || !bytes.Equal(after, registry) {
				t.Fatal("reopening rewrote existing Agent state", err)
			}
			resolved, err := next.Call(ctx, modules.Request{Action: "resolve", ID: prior.Manifest.ID})
			if enabled && (err != nil || resolved.Item == nil || resolved.Item.Digest != prior.Digest) {
				t.Fatal("enabled prior binding cannot resolve", err)
			}
			if !enabled && err == nil {
				t.Fatal("disabled prior binding was revived")
			}
		})
	}
}

func TestOfficialPackagesReturnIndependentSnapshots(t *testing.T) {
	first, err := OfficialPackages()
	if err != nil {
		t.Fatal(err)
	}
	baseline, err := OfficialPackages()
	if err != nil || !reflect.DeepEqual(first, baseline) {
		t.Fatal("official snapshots differ before mutation", err)
	}
	want := officialCatalogSnapshot(t, baseline)
	for index, pkg := range first {
		if pkg == baseline[index] {
			t.Fatal("official package object is shared")
		}
		for name, data := range pkg.Files {
			if len(data) > 0 {
				data[0] ^= 0xff
			}
			delete(pkg.Files, name)
		}
		pkg.Files["caller-only.txt"] = []byte("caller mutation")
		pkg.Manifest.Name = "caller mutation"
		pkg.Manifest.Contracts["core"] = "9.0.0"
		pkg.Manifest.Entrypoints["caller"] = "caller-only.txt"
		pkg.Manifest.Files["caller-only.txt"] = modules.File{}
		pkg.Manifest.Clients[0] = "mobile"
		pkg.Manifest.Platforms[0] = "android/arm64"
		if len(pkg.Manifest.Dependencies) > 0 {
			pkg.Manifest.Dependencies[0].ID = "caller.dependency"
		}
		if len(pkg.Manifest.Permissions) > 0 {
			pkg.Manifest.Permissions[0].Scope = "caller-only"
		}
		for client, view := range pkg.Manifest.Presentation {
			view.Renderer = "caller-only"
			pkg.Manifest.Presentation[client] = view
		}
		pkg.Digest = "caller mutation"
	}
	first[0] = nil
	if officialCatalogSnapshot(t, baseline) != want {
		t.Fatal("caller mutation polluted an existing official snapshot")
	}
	after, err := OfficialPackages()
	if err != nil || officialCatalogSnapshot(t, after) != want {
		t.Fatal("caller mutation polluted another official snapshot", err)
	}
}

func TestOfficialDigestCatalogReturnsIndependentSnapshots(t *testing.T) {
	first, err := officialDigests()
	if err != nil {
		t.Fatal(err)
	}
	baseline, err := officialDigests()
	if err != nil {
		t.Fatal(err)
	}
	want := officialCatalogSnapshot(t, baseline)
	for id, digests := range first {
		digests[0] = "caller mutation"
		delete(first, id)
	}
	first["caller.package"] = []string{"caller mutation"}
	if officialCatalogSnapshot(t, baseline) != want {
		t.Fatal("caller mutation polluted an existing trust snapshot")
	}
	after, err := officialDigests()
	if err != nil || officialCatalogSnapshot(t, after) != want {
		t.Fatal("caller mutation polluted the compiled trust catalog", err)
	}
}
