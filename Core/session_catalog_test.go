// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestContextCatalogExternalChangeCannotBeOverwritten; TestContextCatalogSharedArchiveRejectsStartupAndReleasesLease
// Impact: python -B scripts/code-atlas.py show Core/session_catalog_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestContextCatalogExternalChangeCannotBeOverwritten(t *testing.T) {
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { fixtureAnswer(w, "catalog", "done", nil) })
	w := modeWorkspace(t, m.config, dir, HostOS)
	contextTestAction(t, w, "new", map[string]any{"title": "preserve"})
	before := contextTestView(t, w)
	file := filepath.Join(w.contextDirectory(), "sessions.json")
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	// An external replacement can keep the same JSON revision. Its exact bytes
	// must still fence a stale host, even while that host owns the normal lease.
	changed := append(data, '\n')
	if err = os.WriteFile(file, changed, 0600); err != nil {
		t.Fatal(err)
	}
	_, err = w.contextCall(context.Background(), rawJSON(map[string]any{"action": "reset", "source": before["source"]}))
	if err == nil {
		t.Fatal("externally replaced session catalogue was overwritten")
	}
	got, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(got, changed) {
		t.Fatal("external catalogue bytes lost", err)
	}
	if after := contextTestView(t, w); before["session_id"] != after["session_id"] || before["text"] != after["text"] {
		t.Fatal("rejected commit changed current session")
	}
	// Restore only this fixture so normal shutdown can save its private state.
	if err = os.WriteFile(file, data, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestContextCatalogSharedArchiveRejectsStartupAndReleasesLease(t *testing.T) {
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { fixtureAnswer(w, "catalog", "done", nil) })
	w := modeWorkspace(t, m.config, dir, HostOS)
	contextTestAction(t, w, "new", map[string]any{"title": "second"})
	file := filepath.Join(w.contextDirectory(), "sessions.json")
	w.Close()
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var book eyraContextBook
	if err = json.Unmarshal(data, &book); err != nil {
		t.Fatal(err)
	}
	book.Sessions[1].Archive = book.Sessions[0].Archive
	corrupt := rawJSON(book)
	if err = os.WriteFile(file, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	h := NewWorkspaceHost(m.config, "", "")
	if err = h.SetMode(HostOS); err != nil {
		t.Fatal(err)
	}
	opened, err := newWorkspace(m.config, "", dir, "", nil, h)
	if err == nil {
		opened.Close()
		t.Fatal("shared archive accepted at startup")
	}
	got, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(got, corrupt) {
		t.Fatal("invalid catalogue changed", err)
	}
	if err = os.WriteFile(file, data, 0600); err != nil {
		t.Fatal(err)
	}
	// A rejected startup must release the owner lease, allowing recovery.
	recovered, err := newWorkspace(m.config, "", dir, "", nil, h)
	if err != nil {
		t.Fatal("failed startup retained the catalogue lease", err)
	}
	recovered.Close()
}
