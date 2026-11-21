// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: JavaScript
// Impact: python -B scripts/code-atlas.py show Tool/runtime/javascript.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package runtime prepares tool implementations for the host's existing execution service.
// It owns no permissions, processes, persistence, or client state.
package runtime

import (
	"encoding/json"
	"fmt"

	"github.com/aieyra/aieyra-os/tool/contract"
)

func JavaScript(tool contract.CustomTool, input json.RawMessage) (string, error) {
	var args any
	if err := json.Unmarshal(input, &args); err != nil {
		return "", fmt.Errorf("arguments must be JSON: %w", err)
	}
	if err := contract.ValidateArguments(tool.Schema, args); err != nil {
		return "", err
	}
	data, err := json.Marshal(args)
	if err != nil {
		return "", err
	}
	return "const args=" + string(data) + ";\nconst __aieyra_result=await(async()=>{\n" + tool.Code + "\n})();\nif(__aieyra_result!==undefined)text(__aieyra_result);", nil
}
