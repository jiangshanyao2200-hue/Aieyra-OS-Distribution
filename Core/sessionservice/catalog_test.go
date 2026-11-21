// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/sessionservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: catalogFixture; SessionIdentity; TestCatalogCommitReopenAndStaleWriterPreservePayload; TestCatalogRejectsCrossSessionArchiveAndBrokenPointers; TestCatalogDoesNotReplaceBlockedPointer
// Impact: python -B scripts/code-atlas.py show Core/sessionservice/catalog_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package sessionservice

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type catalogFixture struct {
	ID       string   `json:"id"`
	Archive  string   `json:"archive"`
	Versions []string `json:"versions,omitempty"`
	Payload  string   `json:"payload"`
}

func (s catalogFixture) SessionIdentity() Identity {
	return Identity{ID: s.ID, Archive: s.Archive, Versions: s.Versions}
}

func TestCatalogCommitReopenAndStaleWriterPreservePayload(t *testing.T) {
	dir := t.TempDir()
	id, archive := strings.Repeat("1", 32), strings.Repeat("2", 32)
	c := &Catalog[catalogFixture]{Version: 1, Revision: 1, Active: id, Sessions: []catalogFixture{{ID: id, Archive: archive, Payload: "原文🪶\n不改写"}}}
	digest, err := CommitCatalog(dir, c, "")
	if err != nil {
		t.Fatal(err)
	}
	read, loaded, err := LoadCatalog[catalogFixture](dir)
	if err != nil || loaded != digest || read.Sessions[0].Payload != c.Sessions[0].Payload {
		t.Fatal(read, loaded, err)
	}
	if _, err = CommitCatalog(dir, c, ""); err == nil {
		t.Fatal("create replaced existing owner")
	}
	read.Revision++
	updated, err := CommitCatalog(dir, read, digest)
	if err != nil || updated == digest {
		t.Fatal("update did not advance bytes", err)
	}
	prior, _ := os.ReadFile(filepath.Join(dir, catalogFile))
	if _, err = CommitCatalog(dir, c, digest); err == nil {
		t.Fatal("stale writer overwrote catalog")
	}
	got, _ := os.ReadFile(filepath.Join(dir, catalogFile))
	if !bytes.Equal(prior, got) {
		t.Fatal("stale write altered bytes")
	}
	// Unknown schemas must remain intact for a compatible reader.
	future := []byte(`{"version":2,"revision":1,"active":"` + id + `","sessions":[]}`)
	if err = os.WriteFile(filepath.Join(dir, catalogFile), future, 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err = LoadCatalog[catalogFixture](dir); err == nil {
		t.Fatal("unknown version accepted")
	}
	got, _ = os.ReadFile(filepath.Join(dir, catalogFile))
	if !bytes.Equal(got, future) {
		t.Fatal("unknown version was changed")
	}
}

func TestCatalogRejectsCrossSessionArchiveAndBrokenPointers(t *testing.T) {
	id, second, archive := strings.Repeat("a", 32), strings.Repeat("b", 32), strings.Repeat("c", 32)
	for _, test := range []struct {
		name    string
		active  string
		entries []catalogFixture
	}{
		{"shared archive", id, []catalogFixture{{ID: id, Archive: archive}, {ID: second, Archive: archive}}},
		{"shared version", id, []catalogFixture{{ID: id, Archive: id, Versions: []string{archive}}, {ID: second, Archive: archive}}},
		{"missing active", second, []catalogFixture{{ID: id, Archive: archive}}},
		{"duplicate identity", id, []catalogFixture{{ID: id, Archive: archive}, {ID: id, Archive: second}}},
		{"escaping version", id, []catalogFixture{{ID: id, Archive: archive, Versions: []string{"../other"}}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			dir := t.TempDir()
			c := &Catalog[catalogFixture]{Version: 1, Revision: 1, Active: test.active, Sessions: test.entries}
			if _, err := CommitCatalog(dir, c, ""); err == nil {
				t.Fatal("invalid ownership committed")
			}
			if _, err := os.Stat(filepath.Join(dir, catalogFile)); !os.IsNotExist(err) {
				t.Fatal("invalid catalog was created", err)
			}
		})
	}
}

func TestCatalogDoesNotReplaceBlockedPointer(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, catalogFile)
	if err := os.Mkdir(file, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(file, "keep"), []byte("owned fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	id := strings.Repeat("d", 32)
	c := &Catalog[catalogFixture]{Version: 1, Revision: 1, Active: id, Sessions: []catalogFixture{{ID: id, Archive: id}}}
	if _, err := CommitCatalog(dir, c, ""); err == nil {
		t.Fatal("blocked pointer replaced")
	}
	if data, err := os.ReadFile(filepath.Join(file, "keep")); err != nil || string(data) != "owned fixture" {
		t.Fatal("obstruction changed", err)
	}
}
