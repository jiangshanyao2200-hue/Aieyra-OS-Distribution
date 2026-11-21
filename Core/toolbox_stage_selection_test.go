// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestSelectiveToolboxCatalogueAndStaleRestoration; TestDesktopSettingsToolIsDiscoverableAndDispatchable
// Impact: python -B scripts/code-atlas.py show Core/toolbox_stage_selection_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSelectiveToolboxCatalogueAndStaleRestoration(t *testing.T) {
	useTestStage(t, ReleaseStage{Toolbox: true})
	file := filepath.Join(ResourceRoot(), "Config", "运行参数.json")
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	_ = json.Unmarshal(data, &config)
	config["toolbox_capabilities"] = []string{"image_gen", "computer"}
	_ = os.WriteFile(file, rawJSON(config), 0600)
	ctx := WithToolPermissions(context.Background(), []string{"image_gen", "computer", "browser", "tool_factory", "settings", "compact", "community"})
	for _, name := range []string{"image_gen", "computer"} {
		if !toolAllowed(ctx, name) {
			t.Fatal("reviewed tool missing", name)
		}
	}
	for _, name := range []string{"browser", "tool_factory", "settings", "compact", "community", "custom:old"} {
		if stageToolAllowed(name) {
			t.Fatal("unreviewed capability reopened", name)
		}
	}
	catalogue := teamToolboxCatalog(ctx)
	if !strings.Contains(catalogue, "image_gen") || !strings.Contains(catalogue, "computer") || strings.Contains(catalogue, "browser") {
		t.Fatal(catalogue)
	}
	restored := RestoreToolbox([]Message{{Role: RoleTool, Name: "toolbox", Content: `{"ok":true,"open":{"browser":true,"image_gen":true},"manuals":{"browser":"UNREVIEWED_BROWSER_SENTINEL"}}`}})
	if restored.Open["browser"] || !restored.Open["image_gen"] || strings.Contains(restored.Details(), "UNREVIEWED_BROWSER_SENTINEL") {
		t.Fatal(restored)
	}
	if !toolboxAvailable(ctx) {
		t.Fatal("selective toolbox unavailable")
	}
	w := &Workspace{host: &WorkspaceHost{mode: HostOS}}
	seen := map[string]bool{}
	for _, name := range w.teamPermissions(WorkspaceMatrix) {
		if seen[name] || !stageToolAllowed(name) {
			t.Fatal("task startup receives duplicate or unavailable capability", name)
		}
		seen[name] = true
	}
	if !seen["image_gen"] || !seen["computer"] {
		t.Fatal("task startup lost reviewed capabilities", seen)
	}
}

func TestDesktopSettingsToolIsDiscoverableAndDispatchable(t *testing.T) {
	useTestStage(t, ReleaseStage{Toolbox: true})
	w := &Workspace{host: &WorkspaceHost{mode: HostOS}}
	ctx := WithToolPermissions(context.Background(), w.permissions(WorkspaceMatrix))
	if !toolAllowed(ctx, "settings") || !strings.Contains(teamToolboxCatalog(ctx), "system") || !strings.Contains(toolboxDiscoveryText(ctx), "Available section values: settings") {
		t.Fatal("desktop settings API missing from actual role permissions or catalogue")
	}
	state := &ToolboxState{}
	result := state.Execute(ctx, "", ToolCall{Function: FunctionCall{Name: "toolbox", Arguments: `{"action":"open","name":"system","section":"settings"}`}})
	if !result.OK || !state.Open["settings"] {
		t.Fatalf("desktop settings open failed: %+v", result)
	}
}
