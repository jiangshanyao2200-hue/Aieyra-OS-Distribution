// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: PatchRequest; PatchError; PatchLine; PatchHunk; PatchFile; PatchResult; CustomTool
// Impact: python -B scripts/code-atlas.py show Core/tool_contracts.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	patch "github.com/aieyra/aieyra-os/tool/base/official/apply_patch/contract"
	toolcontract "github.com/aieyra/aieyra-os/tool/contract"
)

type PatchRequest = patch.PatchRequest
type PatchError = patch.PatchError
type PatchLine = patch.PatchLine
type PatchHunk = patch.PatchHunk
type PatchFile = patch.PatchFile
type PatchResult = patch.PatchResult

type CustomTool = toolcontract.CustomTool
