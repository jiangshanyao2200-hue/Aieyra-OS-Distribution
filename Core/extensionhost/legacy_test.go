// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/extensionhost/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: legacySource; TestLegacyProgramUsesCommonLifecycleAndOriginalReceipts; TestLegacyProgramRejectsIntegrityPathsAndBroadAuthority; TestLegacyNetworkIsExplicitAndRequiresCommonGrants
// Impact: python -B scripts/code-atlas.py show Core/extensionhost/legacy_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package extensionhost

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/modules"
)

func legacySource(t *testing.T, version, html string, change func(map[string]any, map[string]any)) string {
	t.Helper()
	b := map[string]any{"schema": "aieyra-bundle/1", "kind": "program", "entry": "index.html", "files": map[string]string{"index.html": html}}
	m := map[string]any{"schema": "aieyra-resource/1", "id": "legacy.notebook", "kind": "program", "name": "Legacy notebook", "version": version, "permissions": []string{}}
	if change != nil {
		change(m, b)
	}
	raw, err := json.Marshal(b)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	m["artifact"] = map[string]any{"name": "notebook.aieyra", "size": len(raw), "sha256": hex.EncodeToString(digest[:])}
	meta, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(t.TempDir(), "notebook.aieyra")
	if err = os.WriteFile(source, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(source+".manifest.json", meta, 0600); err != nil {
		t.Fatal(err)
	}
	return source
}

func TestLegacyProgramUsesCommonLifecycleAndOriginalReceipts(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	m := New(root, Desktop())
	source := legacySource(t, "1.0.0", "<p>original</p>", nil)
	inspection, err := m.Inspect(ctx, source)
	if err != nil || !inspection.Compatibility.Compatible {
		t.Fatal(inspection, err)
	}
	request := modules.Request{Action: "install", Source: source, Origin: "third-party", ExpectedDigest: inspection.Digest, ExpectedRevision: &inspection.Revision, RequestID: "legacy-reject-unsigned"}
	if _, err = m.Call(ctx, request); err == nil || !strings.Contains(err.Error(), "signature") {
		t.Fatal("legacy signature was invented", err)
	}
	request.Origin = "local"
	request.RequestID = "legacy-install"
	one, err := m.Call(ctx, request)
	if err != nil || one.Item.Enabled || one.Item.Origin != "local" {
		t.Fatal(one, err)
	}
	if _, err = m.Call(ctx, modules.Request{Action: "resolve", ID: one.Item.Manifest.ID}); err == nil {
		t.Fatal("install silently enabled legacy program")
	}
	mutate := func(action string, current modules.Result, id string) modules.Result {
		t.Helper()
		out, e := m.Call(ctx, modules.Request{Action: action, ID: current.Item.Manifest.ID, ExpectedDigest: current.Item.Digest, ExpectedRevision: &current.Revision, RequestID: id})
		if e != nil || !out.OK {
			t.Fatal(out, e)
		}
		return out
	}
	enabled := mutate("enable", one, "legacy-enable")
	newSource := legacySource(t, "1.1.0", "<p>upgraded</p>", nil)
	next, err := m.Inspect(ctx, newSource)
	if err != nil {
		t.Fatal(err)
	}
	two, err := m.Call(ctx, modules.Request{Action: "install", Source: newSource, Origin: "local", ExpectedDigest: next.Digest, ExpectedRevision: &next.Revision, RequestID: "legacy-upgrade"})
	if err != nil || !two.Item.Enabled || two.Item.Previous.Digest != enabled.Item.Digest {
		t.Fatal(two, err)
	}
	back := mutate("rollback", two, "legacy-rollback")
	if back.Item.Digest != one.Item.Digest {
		t.Fatal("rollback lost original", back)
	}
	disabled := mutate("disable", back, "legacy-disable")
	m = New(root, Desktop())
	if _, err = m.Call(ctx, modules.Request{Action: "resolve", ID: one.Item.Manifest.ID}); err == nil {
		t.Fatal("restart revived disabled program")
	}
	mutate("remove", disabled, "legacy-remove")
	replayed, err := m.Call(ctx, request)
	if err != nil || !replayed.Replayed || replayed.Item.Digest != one.Item.Digest {
		t.Fatal("lost original install receipt", replayed, err)
	}
	if _, err = m.Call(ctx, modules.Request{Action: "resolve", ID: one.Item.Manifest.ID}); err == nil {
		t.Fatal("replaying receipt reinstalled program")
	}
	if _, err = modules.Load(ctx, one.Item.Directory); err != nil {
		t.Fatal("removed immutable object missing", err)
	}
}

func TestLegacyProgramRejectsIntegrityPathsAndBroadAuthority(t *testing.T) {
	cases := map[string]func(map[string]any, map[string]any){
		"traversal":          func(m, b map[string]any) { b["files"] = map[string]string{"index.html": "ok", "../escape.js": "bad"} },
		"case collision":     func(m, b map[string]any) { b["files"] = map[string]string{"index.html": "ok", "INDEX.html": "bad"} },
		"manifest collision": func(m, b map[string]any) { b["files"] = map[string]string{"index.html": "ok", "manifest.json": "bad"} },
		"broad network":      func(m, b map[string]any) { m["permissions"] = []string{"network"} },
		"shell permission":   func(m, b map[string]any) { m["permissions"] = []string{"terminal"} },
		"wildcard": func(m, b map[string]any) {
			m["permissions"] = []string{"network"}
			m["network_origins"] = []string{"https://*.example.com"}
		},
		"official impersonation": func(m, b map[string]any) { m["id"] = "aieyra.notes" },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			m := New(t.TempDir(), Desktop())
			source := legacySource(t, "1.0.0", "ok", change)
			inspection, err := m.Inspect(context.Background(), source)
			if err == nil && inspection.Compatibility.Compatible {
				t.Fatal("bad source accepted", inspection)
			}
		})
	}
	source := legacySource(t, "1.0.0", "ok", nil)
	if err := os.WriteFile(source, []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(t.TempDir(), Desktop()).Inspect(context.Background(), source); err == nil {
		t.Fatal("changed artifact accepted")
	}
}

func TestLegacyNetworkIsExplicitAndRequiresCommonGrants(t *testing.T) {
	ctx := context.Background()
	m := New(t.TempDir(), Desktop())
	source := legacySource(t, "1.0.0", "ok", func(m, b map[string]any) {
		m["permissions"] = []string{"network"}
		m["network_origins"] = []string{"https://example.com"}
	})
	i, err := m.Inspect(ctx, source)
	if err != nil || !i.Compatibility.Compatible {
		t.Fatal(i, err)
	}
	r, err := m.Call(ctx, modules.Request{Action: "install", Source: source, Origin: "local", ExpectedDigest: i.Digest, ExpectedRevision: &i.Revision, RequestID: "network-import"})
	if err != nil {
		t.Fatal(err)
	}
	p := modules.Request{Action: "enable", ID: r.Item.Manifest.ID, ExpectedDigest: r.Item.Digest, ExpectedRevision: &r.Revision, RequestID: "network-grant"}
	if _, err = m.Call(ctx, p); err == nil {
		t.Fatal("network silently granted")
	}
	p.Grants = r.Item.Manifest.Permissions
	enabled, err := m.Call(ctx, p)
	if err != nil || len(enabled.Item.Grants) != 1 || enabled.Item.Grants[0].Scope != "https://example.com" {
		t.Fatal(enabled, err)
	}
}
