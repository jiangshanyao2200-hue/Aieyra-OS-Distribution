// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: toolboxDiscoveryEntry; toolboxDirectEntry; toolboxContextEnabled; toolboxDiscoveryHost; toolboxBuiltinVisible; toolboxDiscovery; text; toolboxDiscoveryText; toolboxDiscoveryIndex; toolboxContextDefinition; toolboxOpenedDescription
// Impact: python -B scripts/code-atlas.py show Core/toolbox_discovery.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"
	"strings"

	toolboxowner "github.com/aieyra/aieyra-os/tool/toolbox"
)

// Discovery describes the actual invocation context. It never grants a tool,
// resolves private manual contents into a receipt, or preexecutes a query.
type toolboxDiscoveryEntry struct {
	Capability toolboxowner.Capability
	Queries    []toolboxowner.Query
	Recovery   bool
}

func toolboxDirectEntry(ctx context.Context, name string) bool {
	c, ok := ctx.Value(workspaceContextKey{}).(workspaceContext)
	return ok && c.role == WorkspaceMatrix && (name == "agents" || name == "community" || name == "link")
}

func toolboxContextEnabled(ctx context.Context) bool {
	if !CurrentReleaseStage().Toolbox {
		return false
	}
	c, ok := ctx.Value(workspaceContextKey{}).(workspaceContext)
	return !(ok && baseToolMode && c.workspace != nil && c.workspace.isTerminal())
}

func toolboxDiscoveryHost(ctx context.Context, host string) bool {
	if host == "" {
		return true
	}
	if bound, ok := ctx.Value(programAgentContextKey{}).(programAgentContext); ok {
		return host == "os_desktop" && bound.manager != nil && bound.manager.linkHome != nil && !bound.manager.linkHome.terminal
	}
	c, ok := ctx.Value(workspaceContextKey{}).(workspaceContext)
	if !ok || c.workspace == nil || c.workspace.Mode() != HostOS || c.workspace.isTerminal() {
		return false
	}
	return host == "os_desktop" || host == "os_matrix" && c.role == WorkspaceMatrix
}

func toolboxBuiltinVisible(ctx context.Context, entry toolboxowner.Capability) bool {
	return toolboxContextEnabled(ctx) && toolAllowed(ctx, entry.Name) &&
		toolboxDiscoveryHost(ctx, entry.Host) && officialToolVisible(ctx, entry.Name)
}

func toolboxDiscovery(ctx context.Context) []toolboxDiscoveryEntry {
	if !toolboxContextEnabled(ctx) {
		return nil
	}
	ctx = withOfficialToolAdmission(ctx)
	var rows []toolboxDiscoveryEntry
	for _, capability := range toolboxowner.Catalog() {
		if !toolboxBuiltinVisible(ctx, capability) {
			continue
		}
		row := toolboxDiscoveryEntry{Capability: capability, Recovery: !officialToolEnabled(ctx, capability.Name)}
		for _, query := range toolboxowner.Queries(capability.Name) {
			if !toolboxDiscoveryHost(ctx, query.Host) {
				continue
			}
			// Disabled imagegen keeps only the original batch continuation
			// inputs. Admission remains enforced by the actual dispatcher.
			if row.Recovery && !officialToolContinuation(ToolCall{Function: FunctionCall{Name: capability.Name, Arguments: string(rawJSON(map[string]any{"action": query.Action}))}}) {
				continue
			}
			row.Queries = append(row.Queries, query)
		}
		rows = append(rows, row)
	}
	return rows
}

func (row toolboxDiscoveryEntry) text() string {
	return toolboxowner.Describe(row.Capability, row.Queries, row.Recovery)
}

// Project the three system domains once. Query schemas for these domains load
// only with the selected manual; unrelated grants are never advertised.
func toolboxDiscoveryText(ctx context.Context) string {
	var parts, sections []string
	for _, entry := range toolboxDiscovery(ctx) {
		if toolboxDirectEntry(ctx, entry.Capability.Name) {
			continue
		}
		if section := toolboxowner.SystemSection(entry.Capability.Name); section != "" {
			sections = append(sections, section)
			continue
		}
		parts = append(parts, entry.text())
	}
	if len(sections) > 0 {
		parts = append(parts, "system: manage configuration (settings), OS modules (software), and versioned tools (tools). Available section values: "+strings.Join(sections, ", ")+". Set section on open/call/close; only that manual loads. Legacy tool names remain compatible; original permissions still apply.")
	}
	if len(parts) == 0 {
		return ""
	}
	return fmt.Sprintf("Toolbox discovery v%d. %s\n", toolboxowner.CatalogVersion, toolboxowner.DiscoveryInstructions) + strings.Join(parts, "\n")
}

func toolboxDiscoveryIndex(ctx context.Context) string {
	var names []string
	system := false
	for _, entry := range toolboxDiscovery(ctx) {
		if toolboxDirectEntry(ctx, entry.Capability.Name) {
			continue
		}
		if toolboxowner.SystemSection(entry.Capability.Name) != "" {
			system = true
			continue
		}
		names = append(names, entry.Capability.Name)
	}
	if system {
		names = append(names, "system")
	}
	if len(names) == 0 {
		return ""
	}
	return "Available toolbox: " + strings.Join(names, ", ") + ". Inputs and sections are in its tool description."
}

func toolboxContextDefinition(ctx context.Context, definition ToolDefinition) ToolDefinition {
	definition.Description += "\n" + toolboxDiscoveryText(ctx)
	return definition
}

func toolboxOpenedDescription(ctx context.Context, name string) string {
	for _, entry := range toolboxDiscovery(ctx) {
		if entry.Capability.Name == name {
			return "Opened " + name + ". Its manual loads next request; no target action has run."
		}
	}
	return "Tool opened. Detailed instructions will be available on the next request; no target action has run."
}
