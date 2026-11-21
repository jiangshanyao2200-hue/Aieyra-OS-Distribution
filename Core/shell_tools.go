// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: timeSinceMS; ShellToolDefinitions; legacyShellToolDefinitions; IsShellTool
// Impact: python -B scripts/code-atlas.py show Core/shell_tools.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	terminaltool "github.com/aieyra/aieyra-os/tool/base/official/terminal"
	"time"
)

func timeSinceMS(t time.Time) int64 { return time.Since(t).Milliseconds() }
func ShellToolDefinitions() []ToolDefinition {
	return append(legacyShellToolDefinitions(), TerminalToolDefinition())
}
func legacyShellToolDefinitions() []ToolDefinition {
	return terminaltool.LegacyDefinitions(runtimePrompt)
}
func IsShellTool(name string) bool { return terminaltool.IsTool(name) }
