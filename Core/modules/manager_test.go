// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/modules/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: testHost; fixture; checked; install; mutate; TestLifecyclePersistsReplayAndRollback; TestDependencySnapshotsAndAtomicRejection; TestRevisionDigestAndPermissionGuards; TestPublisherSignatureAndContinuity; TestUntrustedPathsIntegrityAndInterruptedImport; TestOptionalDisabledDependencyAndCorruptRollback
// Impact: python -B scripts/code-atlas.py show Core/modules/manager_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package modules

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func testHost() Host {
	return Host{Client: "desktop", Platform: "windows/amd64", Contracts: map[string]string{"core": "1.0.0"}, Kinds: []string{"program"}}
}

func fixture(t *testing.T, id, version string, change func(*Manifest)) string {
	t.Helper()
	data := []byte("<h1>" + id + " " + version + "</h1>")
	m := Manifest{Schema: Schema, ID: id, Kind: "program", Name: id, Summary: "Isolated test program", Version: version, Publisher: "test", License: "MIT", Contracts: map[string]string{"core": "^1.0.0"}, Clients: []string{"desktop"}, Platforms: []string{"any"}, Entrypoints: map[string]string{"program": "index.html"}, Data: DataContract{Schema: 1, Uninstall: "retain"}, Files: map[string]File{"index.html": {SHA256: sum(data), Size: int64(len(data))}}}
	if change != nil {
		change(&m)
	}
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err = os.WriteFile(filepath.Join(dir, "manifest.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, "index.html"), data, 0600); err != nil {
		t.Fatal(err)
	}
	return dir
}

func checked(t *testing.T, manager *Manager, p Request) Result {
	t.Helper()
	out, err := manager.Call(context.Background(), p)
	if err != nil || !out.OK {
		t.Fatalf("%s: %+v %v", p.Action, out, err)
	}
	return out
}

func install(t *testing.T, m *Manager, source string) Result {
	t.Helper()
	p := checked(t, m, Request{Action: "inspect", Source: source})
	return checked(t, m, Request{Action: "install", Source: source, Origin: "local", ExpectedDigest: p.Digest, ExpectedRevision: &p.Revision, RequestID: "install-" + p.Digest})
}

func mutate(t *testing.T, m *Manager, action string, item Installed) Result {
	t.Helper()
	s := checked(t, m, Request{Action: "list"})
	return checked(t, m, Request{Action: action, ID: item.Manifest.ID, ExpectedDigest: item.Digest, ExpectedRevision: &s.Revision, RequestID: action + "-" + item.Digest})
}

func TestLifecyclePersistsReplayAndRollback(t *testing.T) {
	m := New(t.TempDir(), testHost())
	source := fixture(t, "test.app", "1.0.0", nil)
	p := checked(t, m, Request{Action: "inspect", Source: source})
	req := Request{Action: "install", Source: source, Origin: "local", ExpectedDigest: p.Digest, ExpectedRevision: &p.Revision, RequestID: "install-request-one"}
	one := checked(t, m, req)
	if one.Item.Enabled {
		t.Fatal("import executed or enabled a package")
	}
	enabled := mutate(t, m, "enable", *one.Item)
	opened := checked(t, m, Request{Action: "resolve", ID: "test.app"})
	if opened.Directory != enabled.Item.Directory {
		t.Fatal("wrong active object")
	}
	two := install(t, m, fixture(t, "test.app", "1.1.0", nil))
	if !two.Item.Enabled || two.Item.Previous.Digest != one.Digest {
		t.Fatal("update lost activation or rollback")
	}
	// A restarted manager returns the original result for an old request.
	m = New(m.Root, testHost())
	replay := checked(t, m, req)
	if !replay.Replayed || replay.Revision != one.Revision || replay.Item.Digest != one.Digest || replay.Item.Enabled {
		t.Fatal("replay substituted current state for historical result")
	}
	rolled := mutate(t, m, "rollback", *two.Item)
	if rolled.Digest != one.Digest {
		t.Fatal("rollback did not restore bytes")
	}
	disabled := mutate(t, m, "disable", *rolled.Item)
	if _, err := m.Call(context.Background(), Request{Action: "resolve", ID: "test.app"}); err == nil {
		t.Fatal("disabled package opened")
	}
	mutate(t, m, "remove", *disabled.Item)
	if _, err := os.Stat(one.Item.Directory); err != nil {
		t.Fatal("uninstall destroyed retained data or payload")
	}
}

func TestDependencySnapshotsAndAtomicRejection(t *testing.T) {
	m := New(t.TempDir(), testHost())
	dep := install(t, m, fixture(t, "test.dep", "1.0.0", nil))
	mutate(t, m, "enable", *dep.Item)
	app := install(t, m, fixture(t, "test.app", "1.0.0", func(m *Manifest) { m.Dependencies = []Dependency{{ID: "test.dep", Version: "^1.0.0"}} }))
	mutate(t, m, "enable", *app.Item)
	before := checked(t, m, Request{Action: "resolve", ID: "test.app"})
	updated := install(t, m, fixture(t, "test.dep", "1.1.0", nil))
	after := checked(t, m, Request{Action: "resolve", ID: "test.app"})
	if before.Dependencies[0].Digest != dep.Digest || after.Dependencies[0].Digest != updated.Digest || after.Item.Resolved["test.dep"] != updated.Digest {
		t.Fatal("dependency snapshots were not locked to immutable bytes")
	}
	p := checked(t, m, Request{Action: "inspect", Source: fixture(t, "test.dep", "2.0.0", nil)})
	if _, err := m.Call(context.Background(), Request{Action: "disable", ID: "test.dep", ExpectedDigest: updated.Digest, ExpectedRevision: &p.Revision, RequestID: "disable-rejected"}); err == nil {
		t.Fatal("disabled required dependency")
	}
	unchanged := checked(t, m, Request{Action: "list"})
	if unchanged.Revision != p.Revision {
		t.Fatal("rejected operation committed")
	}
	if err := os.WriteFile(filepath.Join(after.Dependencies[0].Directory, "index.html"), []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Call(context.Background(), Request{Action: "resolve", ID: "test.app"}); err == nil {
		t.Fatal("dependency tampering was not detected")
	}
}

func TestRevisionDigestAndPermissionGuards(t *testing.T) {
	host := testHost()
	host.Capabilities = []string{"network.https"}
	m := New(t.TempDir(), host)
	p := install(t, m, fixture(t, "test.app", "1.0.0", func(m *Manifest) {
		m.Permissions = []Permission{{Capability: "network.https", Scope: "https://example.com", Reason: "Read documentation"}}
	}))
	r := Request{Action: "enable", ID: p.Item.Manifest.ID, ExpectedRevision: &p.Revision, ExpectedDigest: p.Digest, RequestID: "enable-no-grant"}
	if _, err := m.Call(context.Background(), r); err == nil {
		t.Fatal("permissions silently granted")
	}
	r.Grants = p.Item.Manifest.Permissions
	checked(t, m, r)
	r.RequestID = "stale-revision"
	if _, err := m.Call(context.Background(), r); err == nil {
		t.Fatal("stale mutation accepted")
	}
	p = checked(t, m, Request{Action: "list"})
	r.ExpectedRevision = &p.Revision
	r.ExpectedDigest = "wrong"
	if _, err := m.Call(context.Background(), r); err == nil {
		t.Fatal("uninspected payload accepted")
	}
}

func TestPublisherSignatureAndContinuity(t *testing.T) {
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	sign := func(m *Manifest) {
		m.Signature = &Signature{PublicKey: base64.StdEncoding.EncodeToString(pub), Value: base64.StdEncoding.EncodeToString(ed25519.Sign(key, m.signingBytes()))}
	}
	m := New(t.TempDir(), testHost())
	source := fixture(t, "test.app", "1.0.0", sign)
	p := checked(t, m, Request{Action: "inspect", Source: source})
	checked(t, m, Request{Action: "install", Source: source, Origin: "third-party", ExpectedDigest: p.Digest, ExpectedRevision: &p.Revision, RequestID: "signed-install"})
	other := fixture(t, "test.app", "1.1.0", nil)
	p = checked(t, m, Request{Action: "inspect", Source: other})
	if _, err = m.Call(context.Background(), Request{Action: "install", Source: other, Origin: "local", ExpectedDigest: p.Digest, ExpectedRevision: &p.Revision, RequestID: "switch-publisher"}); err == nil {
		t.Fatal("publisher continuity bypassed")
	}
	bad := fixture(t, "test.app", "1.1.0", func(m *Manifest) { sign(m); m.Name = "changed after signing" })
	if _, err = Load(context.Background(), bad); err == nil {
		t.Fatal("invalid signature accepted")
	}
}

func TestUntrustedPathsIntegrityAndInterruptedImport(t *testing.T) {
	for _, name := range []string{"../escape", "a/../../escape", "C:/example/file", "\\host\\file", "a/CON.txt", "file.", "a//b"} {
		if FileName(name) == nil {
			t.Errorf("accepted path %q", name)
		}
	}
	source := fixture(t, "test.app", "1.0.0", nil)
	if err := os.WriteFile(filepath.Join(source, "extra.txt"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(context.Background(), source); err == nil {
		t.Fatal("undeclared file accepted")
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, err := zw.Create("../escape")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = w.Write([]byte("no"))
	_ = zw.Close()
	archive := filepath.Join(t.TempDir(), "bad.zip")
	if err = os.WriteFile(archive, buf.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = Load(context.Background(), archive); err == nil {
		t.Fatal("zip traversal accepted")
	}
	m := New(t.TempDir(), testHost())
	if err = os.Mkdir(filepath.Join(m.Root, ".import-interrupted"), 0700); err != nil {
		t.Fatal(err)
	}
	install(t, m, fixture(t, "test.app", "1.0.0", nil))
	if len(checked(t, m, Request{Action: "list"}).Items) != 1 {
		t.Fatal("orphan stage entered registry")
	}
}

func TestOptionalDisabledDependencyAndCorruptRollback(t *testing.T) {
	m := New(t.TempDir(), testHost())
	install(t, m, fixture(t, "test.dep", "2.0.0", nil))
	app := install(t, m, fixture(t, "test.app", "1.0.0", func(m *Manifest) { m.Dependencies = []Dependency{{ID: "test.dep", Version: "^1.0.0", Optional: true}} }))
	mutate(t, m, "enable", *app.Item)
	if len(checked(t, m, Request{Action: "resolve", ID: "test.app"}).Dependencies) != 0 {
		t.Fatal("disabled optional dependency was activated")
	}
	install(t, m, fixture(t, "test.app", "1.1.0", nil))
	s, err := m.read()
	if err != nil {
		t.Fatal(err)
	}
	item := s.Items["test.app"]
	item.Previous.Manifest.Name = "corrupt"
	s.Items["test.app"] = item
	if err = m.write(s); err != nil {
		t.Fatal(err)
	}
	if _, err = m.Call(context.Background(), Request{Action: "list"}); err == nil {
		t.Fatal("corrupt rollback metadata accepted")
	}
}
