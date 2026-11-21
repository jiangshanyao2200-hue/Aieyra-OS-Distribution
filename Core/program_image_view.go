// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: programToolImages
// Impact: python -B scripts/code-atlas.py show Core/program_image_view.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
)

// Native canvas tools return an owned image file, then the same view_image
// transport validates and persists its pixels for the model's tool receipt.
// Arbitrary toolbox results cannot inject visual attachments through this port.
func programToolImages(ctx context.Context, shell *ShellManager, call ToolCall, result *ToolboxResult) []ImageAttachment {
	if shell == nil || !result.OK || call.Function.Name != "toolbox" {
		return nil
	}
	var args struct {
		Action    string `json:"action"`
		Name      string `json:"name"`
		Arguments struct {
			Action    string `json:"action"`
			Operation string `json:"operation"`
			Arguments struct {
				ID        string `json:"id"`
				Operation string `json:"operation"`
			} `json:"arguments"`
		} `json:"arguments"`
	}
	if json.Unmarshal([]byte(call.Function.Arguments), &args) != nil || args.Action != "call" || (args.Name != "software_api" && args.Name != "system") || args.Arguments.Action != "program" || args.Arguments.Operation != "invoke" || args.Arguments.Arguments.ID != "aieyra.workspace" {
		return nil
	}
	switch args.Arguments.Arguments.Operation {
	case "images.view", "images.view_many", "annotations.preview":
	default:
		return nil
	}
	var payload struct {
		ModelImage *ImageRequest `json:"model_image"`
	}
	if json.Unmarshal(result.Data, &payload) != nil || payload.ModelImage == nil {
		return nil
	}
	fail := func(message string) []ImageAttachment {
		result.OK, result.State = false, "failed"
		result.Error = &ShellError{Code: "program_image_unavailable", Message: message}
		return nil
	}
	if !toolAllowed(ctx, "view_image") {
		return fail("画布 Agent 的查看图片工具已停用")
	}
	request := *payload.ModelImage
	if request.Path == "" || len(request.Paths) != 0 {
		return fail("画布返回的图片身份无效")
	}
	encoded, _ := json.Marshal(request)
	viewed, attachments := shell.viewImage(ctx, ToolCall{ID: call.ID + "-canvas-view", Type: "function", Function: FunctionCall{Name: "view_image", Arguments: string(encoded)}})
	if !viewed.OK || (len(attachments) == 0 && viewed.Observation == "") {
		return fail(fmt.Sprintf("画布图片像素未返回：%v", viewed.Error))
	}
	if viewed.Observation != "" {
		result.Output = viewed.Observation
		var data map[string]any
		if json.Unmarshal(result.Data, &data) == nil && data != nil {
			data["image_observation"] = viewed
			result.Data = rawJSON(data)
		}
	} else {
		result.Output = "Canvas image pixels are attached to this receipt; image numbers and pagination are in data."
	}
	return attachments
}
