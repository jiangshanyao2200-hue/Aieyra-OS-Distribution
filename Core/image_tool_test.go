// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: imageFixture; TestImageToolWireSnapshotAndBudget; TestImageToolExecRequiresImageEmission; TestImageInterpreterReturnsObservationAndHonestCancellation
// Impact: python -B scripts/code-atlas.py show Core/image_tool_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func imageFixture(t *testing.T, m *ShellManager) string {
	t.Helper()
	path := filepath.Join(m.root, "fixture.png")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	img := image.NewRGBA(image.Rect(0, 0, 32, 24))
	img.Set(1, 1, color.RGBA{R: 240, A: 255})
	err = png.Encode(f, img)
	f.Close()
	if err != nil {
		t.Fatal(err)
	}
	return path
}

func TestImageToolWireSnapshotAndBudget(t *testing.T) {
	m := shellTestManager(t)
	path := imageFixture(t, m)
	r, attachments := m.viewImage(WithToolImages(context.Background(), true), executionCall("view_image", ImageRequest{Path: path}))
	if !r.OK || len(attachments) != 1 || r.Width != 32 {
		t.Fatalf("image: %+v", r)
	}
	if err := os.WriteFile(path, []byte("changed source"), 0600); err != nil {
		t.Fatal(err)
	}
	content, _ := json.Marshal(r)
	messages := []Message{{Role: RoleTool, ToolCallID: "image", Content: string(content), Images: attachments}}
	req := BuildResponsesRequest(Defaults(), messages, false, nil)
	wire, _ := json.Marshal(req)
	if !strings.Contains(string(wire), `"type":"input_image"`) || !strings.Contains(string(wire), "data:image/png;base64,") {
		t.Fatal(string(wire))
	}
	if EstimateMessages(messages) < 1200 || EstimateMessages(messages) > 2200 {
		t.Fatal("image estimate unbounded")
	}
	if err := os.WriteFile(attachments[0].Asset, []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	wire, _ = json.Marshal(BuildResponsesRequest(Defaults(), messages, false, nil))
	if strings.Contains(string(wire), "data:image") || !strings.Contains(string(wire), "hash mismatch") {
		t.Fatal("snapshot changed silently")
	}
}

func TestImageToolExecRequiresImageEmission(t *testing.T) {
	m := shellTestManager(t)
	imageFixture(t, m)
	delay := 10000
	ctx := WithToolImages(context.Background(), true)
	r, images := m.execution.execute(ctx, executionCall("exec", ExecRequest{Code: `const r=await tools.view_image({path:"fixture.png"}); text({width:r.width}); image(r);`, YieldTimeMS: &delay}), "image")
	if !r.OK || len(images) != 1 || len(r.Output) != 2 {
		t.Fatalf("image bridge: %+v images=%d", r, len(images))
	}
	r, images = m.execution.execute(ctx, executionCall("exec", ExecRequest{Code: `text(await tools.view_image({path:"fixture.png"}));`, YieldTimeMS: &delay}), "metadata")
	if !r.OK || len(images) != 0 {
		t.Fatal("text automatically sent image")
	}
	denied, _ := m.viewImage(context.Background(), executionCall("view_image", ImageRequest{Path: "fixture.png"}))
	if denied.OK || denied.Error.Code != "image_unsupported" {
		t.Fatalf("unsupported accepted: %+v", denied)
	}
}

func TestImageInterpreterReturnsObservationAndHonestCancellation(t *testing.T) {
	m := shellTestManager(t)
	path := imageFixture(t, m)
	ctx := context.WithValue(WithToolImages(context.Background(), true), toolImageInterpreterKey{}, toolImageInterpreter(func(ctx context.Context, image ImageAttachment, purpose string) (toolImageObservation, error) {
		if image.Asset == path || purpose != "describe" {
			t.Fatal("helper received mutable source or lost question")
		}
		if _, err := os.Stat(image.Asset); err != nil {
			t.Fatal(err)
		}
		return toolImageObservation{Text: "红色像素", Source: "vision_model", Model: "fixture-vision"}, nil
	}))
	r, images := m.viewImage(ctx, executionCall("view_image", ImageRequest{Path: path, Description: "describe"}))
	if !r.OK || r.Observation != "红色像素" || r.ObservationSource != "vision_model" || r.ObservationModel != "fixture-vision" || len(images) != 0 {
		t.Fatal(r, images)
	}
	if _, err := m.toolImage(r.ImageID); err != nil {
		t.Fatal("preview snapshot lost", err)
	}
	ctx = context.WithValue(ctx, toolImageInterpreterKey{}, toolImageInterpreter(func(context.Context, ImageAttachment, string) (toolImageObservation, error) {
		return toolImageObservation{}, context.Canceled
	}))
	r, images = m.viewImage(ctx, executionCall("view_image", ImageRequest{Path: path}))
	if r.OK || r.State != "failed" || r.Error.Code != "image_observation_failed" || len(images) != 0 {
		t.Fatal("helper failure disguised", r)
	}
}
