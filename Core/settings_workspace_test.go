// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkspaceSettingsUsesExistingThemeWithCASValidationAndRecovery
// Impact: python -B scripts/code-atlas.py show Core/settings_workspace_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestWorkspaceSettingsUsesExistingThemeWithCASValidationAndRecovery(t *testing.T) {
	w, _ := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("settings called model") })
	ctx := context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{w, WorkspaceMatrix})
	call := func(p map[string]any) map[string]any {
		t.Helper()
		p["scope"] = "workspace"
		data, handled, err := workspaceSettings(ctx, rawJSON(p))
		if !handled || err != nil {
			t.Fatalf("%v %v", handled, err)
		}
		var v map[string]any
		if err = json.Unmarshal(data, &v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	before := w.state.Theme
	view := call(map[string]any{"action": "inspect"})
	patch := map[string]any{"accent": "#abcdef", "reduced_motion": true}
	preview := call(map[string]any{"action": "validate", "expected_version": view["version"], "patch": patch})
	if preview["saved"] != false || w.state.Theme != before {
		t.Fatal("preview changed theme")
	}
	saved := call(map[string]any{"action": "apply", "expected_version": view["version"], "patch": patch})
	if saved["saved"] != true || !w.state.Theme.ReducedMotion {
		t.Fatal(saved)
	}
	conflict := call(map[string]any{"action": "apply", "expected_version": view["version"], "patch": patch})
	if conflict["code"] != "version_conflict" {
		t.Fatal(conflict)
	}
	for _, invalid := range []any{nil, map[string]any{"scale": 9}, map[string]any{"reduced_motion": nil}, map[string]any{"unknown": 1}} {
		if _, _, err := workspaceSettings(ctx, rawJSON(map[string]any{"scope": "workspace", "action": "apply", "expected_version": saved["version"], "patch": invalid})); err == nil {
			t.Fatal("accepted invalid theme", invalid)
		}
	}
	call(map[string]any{"action": "restore", "expected_version": saved["version"], "recovery_id": saved["recovery_id"]})
	if w.state.Theme != before {
		t.Fatal("restore lost theme")
	}
	// A real filesystem failure must not publish the proposed in-memory theme.
	originalDir := w.dir
	bad := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(bad, []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	w.dir = bad
	_, _, err := workspaceSettings(ctx, rawJSON(map[string]any{"scope": "workspace", "action": "apply", "expected_version": view["version"], "patch": patch}))
	w.dir = originalDir
	if err == nil || w.state.Theme != before {
		t.Fatal("failed persistence changed theme", err)
	}
}
