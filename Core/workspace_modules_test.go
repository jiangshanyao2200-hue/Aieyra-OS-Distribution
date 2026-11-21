// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestPackageRPCIsPrimaryHostScoped
// Impact: python -B scripts/code-atlas.py show Core/workspace_modules_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestPackageRPCIsPrimaryHostScoped(t *testing.T) {
	h := NewWorkspaceHost(filepath.Join(t.TempDir(), "config.json"), "", "")
	w := &Workspace{host: h, state: workspaceState{ID: "primary"}}
	if _, err := w.Call(context.Background(), "workspace.packages", json.RawMessage(`{"action":"list"}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Call(context.Background(), "workspace.packages", json.RawMessage(`{"action":"list","task_id":"another"}`)); err == nil {
		t.Fatal("cross-task package access accepted")
	}
	w.split = &workspaceSplit{}
	if _, err := w.Call(context.Background(), "workspace.packages", json.RawMessage(`{"action":"list"}`)); err == nil {
		t.Fatal("child task acquired package authority")
	}
}
