// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkspaceReportReadPinRecallPreservesOriginal
// Impact: python -B scripts/code-atlas.py show Core/workspace_reports_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestWorkspaceReportReadPinRecallPreservesOriginal(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("metadata made model request") })
	result, err := w.report(rawJSON(map[string]any{"title": "完整报告", "format": "md", "content": "# 报告\n\n原始内容不会重新生成。"}))
	if err != nil {
		t.Fatal(err)
	}
	doc := result.(map[string]any)["document"].(WorkspaceDocument)
	file := filepath.Join(w.dir, "documents", doc.ID+".md")
	before, _ := os.ReadFile(file)
	call := func(action string, pinned bool, revision uint64) WorkspaceDocument {
		t.Helper()
		r, e := w.documentState(rawJSON(map[string]any{"action": action, "id": doc.ID, "pinned": pinned, "expected_revision": revision}))
		if e != nil {
			t.Fatal(e)
		}
		return r.(map[string]any)["document"].(WorkspaceDocument)
	}
	doc = call("dismiss", false, 0)
	if !doc.Dismissed {
		t.Fatal("report stayed visible")
	}
	doc = call("recall_report", false, doc.Revision)
	if doc.Dismissed {
		t.Fatal("recall hidden")
	}
	doc = call("pin", true, doc.Revision)
	doc = call("dismiss", false, doc.Revision)
	if !doc.Pinned || doc.Dismissed {
		t.Fatal("pinned report dismissed")
	}
	doc = call("close", false, doc.Revision)
	if doc.Pinned || !doc.Dismissed {
		t.Fatal("explicit close did not unpin and dismiss")
	}
	if _, e := w.documentState(rawJSON(map[string]any{"action": "pin", "id": doc.ID, "pinned": false, "expected_revision": 0})); e == nil {
		t.Fatal("stale metadata write accepted")
	}
	if _, e := w.documentState(rawJSON(map[string]any{"action": "recall_report", "id": "../../config"})); e == nil {
		t.Fatal("foreign path accepted")
	}
	listing, e := w.documentState(rawJSON(map[string]any{"action": "reports"}))
	if e != nil || len(listing.(map[string]any)["documents"].([]WorkspaceDocument)) != 1 {
		t.Fatal("listing lost original")
	}
	after, _ := os.ReadFile(file)
	if string(after) != string(before) {
		t.Fatal("original report rewritten")
	}
	saved, _ := os.ReadFile(filepath.Join(w.dir, "workspace.json"))
	if len(saved) == 0 {
		t.Fatal("state not persisted")
	}
}
