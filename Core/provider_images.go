// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: requestImages
// Impact: python -B scripts/code-atlas.py show Core/provider_images.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"github.com/aieyra/aieyra-os/api/request"
	"github.com/aieyra/aieyra-os/contracts/storage"
)

// The host owns private assets, integrity checks, byte limits and fallback
// wording. Each request gets one budget; API owns protocol-specific encoding.
func requestImages(supported bool, config string) request.ResolveImages {
	budget := imageRequestByteLimit
	missingTool := runtimePrompt("Matrix/辅助指令/历史图片缺失.txt")
	missingUser := runtimePrompt("Matrix/辅助指令/用户图片缺失.txt")
	return func(m Message) []request.Image {
		images := make([]request.Image, 0, len(m.Images))
		for i, attachment := range m.Images {
			image := request.Image{Text: missingTool}
			if m.Role == RoleUser {
				image.Text = missingUser
			}
			if supported {
				attachment.Asset = storage.Relocate(config, attachment.Asset)
				image = readRequestImage(attachment, &budget)
			}
			if m.Role == RoleUser {
				image.Label = imageLabel(i, attachment)
			}
			images = append(images, image)
		}
		return images
	}
}
