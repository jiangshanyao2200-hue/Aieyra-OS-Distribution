// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestCanvasImageReceiptUsesSharedPixelTransportAndPermissions; TestProgramImageConfigurationTracksConnectionWithoutPublishingCredentials
// Impact: python -B scripts/code-atlas.py show Core/program_image_view_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestCanvasImageReceiptUsesSharedPixelTransportAndPermissions(t *testing.T) {
	m := shellTestManager(t)
	file := imageFixture(t, m)
	call := ToolCall{ID: "canvas-view", Function: FunctionCall{Name: "toolbox", Arguments: `{"action":"call","name":"software_api","arguments":{"action":"program","operation":"invoke","arguments":{"id":"aieyra.workspace","operation":"images.view_many"}}}`}}
	result := func() ToolboxResult {
		return ToolboxResult{OK: true, Data: rawJSON(map[string]any{"ok": true, "model_image": map[string]any{"path": file, "detail": "high"}})}
	}
	ctx := WithToolPermissions(WithToolImages(context.Background(), true), []string{"software_api", "view_image"})
	r := result()
	images := programToolImages(ctx, m, call, &r)
	if !r.OK || len(images) != 1 {
		t.Fatalf("pixels missing: %+v", r)
	}
	wire, _ := json.Marshal(BuildResponsesRequest(Defaults(), []Message{{Role: RoleTool, ToolCallID: call.ID, Content: r.Output, Images: images}}, false, nil))
	if !strings.Contains(string(wire), "data:image/png;base64,") {
		t.Fatal("model did not receive canvas pixels")
	}
	r = result()
	if len(programToolImages(WithToolPermissions(ctx, []string{"software_api"}), m, call, &r)) != 0 || r.OK {
		t.Fatal("disabled image permission accepted")
	}
	call.Function.Arguments = strings.Replace(call.Function.Arguments, "aieyra.workspace", "foreign.program", 1)
	r = result()
	if len(programToolImages(ctx, m, call, &r)) != 0 {
		t.Fatal("foreign program injected image")
	}
}

func TestProgramImageConfigurationTracksConnectionWithoutPublishingCredentials(t *testing.T) {
	choice := imageGenChoice{ProfileID: "fixture", Model: "image", baseURL: "https://fixture.invalid", apiKey: "private-fixture-key"}
	before := programImageConfiguration(choice)
	choice.apiKey = "changed-fixture-key"
	if len(before) != 64 || strings.Contains(before, "fixture") || before == programImageConfiguration(choice) {
		t.Fatal("configuration identity failed")
	}
}
