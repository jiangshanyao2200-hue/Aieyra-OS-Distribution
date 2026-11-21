// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TerminalToolDefinition; canonicalTerminalCall
// Impact: python -B scripts/code-atlas.py show Core/terminal_tool.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import terminaltool "github.com/aieyra/aieyra-os/tool/base/official/terminal"

func TerminalToolDefinition() ToolDefinition                { return terminaltool.Definition(runtimePrompt) }
func canonicalTerminalCall(call ToolCall) (ToolCall, error) { return terminaltool.CanonicalCall(call) }
