// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/modules/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestResolveSnapshotRetainsOneRevisionAndStillValidatesObjects
// Impact: python -B scripts/code-atlas.py show Core/modules/snapshot_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package modules

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveSnapshotRetainsOneRevisionAndStillValidatesObjects(t *testing.T) {
	a, b := defaultFixture(t, "aieyra.snapshot-a", "1.0.0"), defaultFixture(t, "aieyra.snapshot-b", "1.0.0")
	m := withDefaults(t.TempDir(), a, b)
	ctx := context.Background()
	before, err := m.Call(ctx, Request{Action: "list"})
	if err != nil {
		t.Fatal(err)
	}
	changed := false
	m.ValidatePackage = func(p *Package) error {
		if !changed {
			changed = true
			_, err := m.Call(ctx, Request{Action: "disable", ID: b.Manifest.ID, ExpectedDigest: b.Digest, ExpectedRevision: &before.Revision, RequestID: "disable-during-snapshot"})
			if err != nil {
				t.Fatal(err)
			}
		}
		return nil
	}
	snapshot, err := m.ResolveSnapshot(ctx, []string{a.Manifest.ID, b.Manifest.ID})
	if err != nil {
		t.Fatal(err)
	}
	for id, r := range snapshot {
		if r.Error != nil || r.Result.Revision != before.Revision || r.Result.Item.Manifest.ID != id {
			t.Fatal("snapshot mixed revisions", id, r)
		}
	}
	if _, err = m.Call(ctx, Request{Action: "resolve", ID: b.Manifest.ID}); err == nil {
		t.Fatal("next admission ignored disable")
	}
	if err = os.WriteFile(filepath.Join(m.directory(a.Digest), "manifest.json"), []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	snapshot, err = m.ResolveSnapshot(ctx, []string{a.Manifest.ID, b.Manifest.ID})
	if err != nil || snapshot[a.Manifest.ID].Error == nil || snapshot[b.Manifest.ID].Error == nil {
		t.Fatal("snapshot trusted unchecked metadata", snapshot, err)
	}
	if _, err = m.ResolveSnapshot(ctx, []string{a.Manifest.ID, a.Manifest.ID}); err == nil {
		t.Fatal("duplicate snapshot identity")
	}
}
