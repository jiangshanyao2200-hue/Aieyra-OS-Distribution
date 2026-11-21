// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: fixtureReportCall; fixtureReportFile; assertFixtureReport
// Impact: python -B scripts/code-atlas.py show Core/workspace_runtime_fixture_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// The OS mother can publish a durable report without acquiring programming
// permissions. Runtime/compaction tests use that real side effect; CLI/Agent
// and professional-identity tests retain the actual patch execution coverage.
func fixtureReportCall(id, title, content string) map[string]any {
	return map[string]any{"type": "function_call", "id": "fc-" + id, "call_id": id, "name": "report", "arguments": string(rawJSON(map[string]any{"action": "report", "title": title, "format": "md", "content": content}))}
}

func fixtureReportFile(w *Workspace, title string) (string, error) {
	value, err := w.documentState(rawJSON(map[string]any{"action": "reports"}))
	if err != nil {
		return "", err
	}
	var found []WorkspaceDocument
	for _, doc := range value.(map[string]any)["documents"].([]WorkspaceDocument) {
		if doc.Title == title {
			found = append(found, doc)
		}
	}
	if len(found) != 1 {
		return "", fmt.Errorf("report %q: expected one durable effect, got %d", title, len(found))
	}
	return filepath.Join(w.reportDirectory(), "documents", found[0].ID+"."+found[0].Format), nil
}

func assertFixtureReport(t *testing.T, w *Workspace, title, content string) {
	t.Helper()
	file, err := fixtureReportFile(w, title)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(file)
	if err != nil || string(data) != content {
		t.Fatalf("durable report missing/changed: %s content=%q error=%v", title, data, err)
	}
}
