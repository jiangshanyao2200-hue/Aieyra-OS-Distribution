// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/protocol/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ImageEditInput; imageSizes; GeneratedImageByteLimit; ImageEditByteLimit; ImageRequest; ImageProviderError; Error; Validate; ImageUsage
// Impact: python -B scripts/code-atlas.py show Contracts/protocol/image.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package protocol

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

type ImageEditInput struct {
	Path          string
	Data          []byte
	Width, Height int
}

var imageSizes = map[string]bool{"auto": true, "1024x1024": true, "1536x1024": true, "1024x1536": true}

const GeneratedImageByteLimit = 32 << 20
const ImageEditByteLimit = 96 << 20

type ImageRequest struct {
	Operation         string           `json:"-"`
	Quality           string           `json:"quality,omitempty"`
	Images            []ImageEditInput `json:"-"`
	Mask              *ImageEditInput  `json:"-"`
	Prompt            string           `json:"prompt"`
	Model             string           `json:"model"`
	Size              string           `json:"size,omitempty"`
	OutputFormat      string           `json:"output_format,omitempty"`
	OutputCompression *int             `json:"output_compression,omitempty"`
	Background        string           `json:"background,omitempty"`
	Moderation        string           `json:"moderation,omitempty"`
	InputFidelity     string           `json:"input_fidelity,omitempty"`
}

// Unknown 表示请求结果不确定（可能已扣费）；不自动重发。
type ImageProviderError struct {
	Message string
	Unknown bool
}

func (e *ImageProviderError) Error() string { return e.Message }

func (p ImageRequest) Validate() error {
	if strings.TrimSpace(p.Prompt) == "" || len([]rune(p.Prompt)) > 24000 || p.Model == "" || len(p.Model) > 240 || strings.IndexFunc(p.Model, unicode.IsControl) >= 0 {
		return fmt.Errorf("image_gen requires a configured model and a complete prompt")
	}
	if !imageSizes[p.Size] {
		parts := strings.Split(p.Size, "x")
		if len(parts) != 2 {
			return fmt.Errorf("invalid image size")
		}
		w, ew := strconv.Atoi(parts[0])
		h, eh := strconv.Atoi(parts[1])
		if ew != nil || eh != nil || w < 256 || h < 256 || w > 4096 || h > 4096 || w%16 != 0 || h%16 != 0 || w*h > 16*1024*1024 {
			return fmt.Errorf("image size must use 16-pixel increments, 256–4096 per side")
		}
	}
	if p.OutputFormat != "" && p.OutputFormat != "png" && p.OutputFormat != "jpeg" && p.OutputFormat != "webp" {
		return fmt.Errorf("invalid image output format")
	}
	if p.OutputCompression != nil && (*p.OutputCompression < 0 || *p.OutputCompression > 100) {
		return fmt.Errorf("image compression must be 0–100")
	}
	if p.Background != "" && p.Background != "auto" && p.Background != "opaque" && p.Background != "transparent" {
		return fmt.Errorf("invalid image background")
	}
	if p.Background == "transparent" && p.OutputFormat == "jpeg" {
		return fmt.Errorf("transparent images require png or webp")
	}
	if p.Moderation != "" && p.Moderation != "auto" && p.Moderation != "low" {
		return fmt.Errorf("invalid image moderation")
	}
	if p.InputFidelity != "" && p.InputFidelity != "low" && p.InputFidelity != "high" {
		return fmt.Errorf("invalid image input fidelity")
	}
	return nil
}

type ImageUsage struct{ Input, Output int }
