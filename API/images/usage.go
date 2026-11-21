// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/images/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ParseUsage
// Impact: python -B scripts/code-atlas.py show API/images/usage.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package images

import (
	"encoding/json"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

// A missing or partial usage object is unknown, including a reported zero on
// only one side. Image bytes never provide a token estimate.
func ParseUsage(raw json.RawMessage) *protocol.ImageUsage {
	var v struct {
		Input      *int `json:"input_tokens"`
		Output     *int `json:"output_tokens"`
		Prompt     *int `json:"prompt_tokens"`
		Completion *int `json:"completion_tokens"`
	}
	if json.Unmarshal(raw, &v) != nil {
		return nil
	}
	input, output := v.Input, v.Output
	if input == nil && output == nil {
		input, output = v.Prompt, v.Completion
	}
	if input == nil || output == nil || *input < 0 || *output < 0 || *input > 1_000_000_000 || *output > 1_000_000_000 {
		return nil
	}
	return &protocol.ImageUsage{Input: *input, Output: *output}
}
