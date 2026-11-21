// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/protocol/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: VideoRequest; Validate; VideoTask; VideoProviderError; Error; GeneratedVideoByteLimit
// Impact: python -B scripts/code-atlas.py show Contracts/protocol/video.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package protocol

import (
	"fmt"
	"strings"
)

// VideoRequest contains only the verified text-to-video input. Duration and
// size are generation hints, not promises about the returned media.
type VideoRequest struct {
	Model    string `json:"model"`
	Prompt   string `json:"prompt"`
	Duration int    `json:"duration"`
	Size     string `json:"size,omitempty"`
}

func (r VideoRequest) Validate() error {
	if r.Model == "" || len(r.Model) > 160 || strings.TrimSpace(r.Prompt) == "" || len(r.Prompt) > 16000 || r.Duration < 1 || r.Duration > 30 {
		return fmt.Errorf("视频需要模型、非空描述及1–30秒时长提示")
	}
	if r.Size != "" && r.Size != "1280x720" && r.Size != "720x1280" && r.Size != "1024x1024" {
		return fmt.Errorf("视频画幅提示必须是1280x720、720x1280或1024x1024")
	}
	return nil
}

type VideoTask struct {
	ID       string `json:"id"`
	Model    string `json:"model,omitempty"`
	State    string `json:"state"`
	Progress *int   `json:"progress,omitempty"`
	URL      string `json:"url,omitempty"`
}

type VideoProviderError struct {
	Message string
	Unknown bool
}

func (e *VideoProviderError) Error() string { return e.Message }

const GeneratedVideoByteLimit int64 = 256 << 20
