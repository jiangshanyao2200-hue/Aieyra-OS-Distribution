// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: toolPermissionsKey; liveToolPermissionKey; toolDefinitionRoleKey; projectOnDemand; WithToolPermissions; toolAllowed; permittedCall; CodingToolDefinitions; FilterToolDefinitions
// Impact: python -B scripts/code-atlas.py show Core/tool_permissions.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"
	"strings"

	patchtool "github.com/aieyra/aieyra-os/tool/base/official/apply_patch"
	toolcontract "github.com/aieyra/aieyra-os/tool/contract"
)

// Permissions constrain dispatch, including calls nested inside exec. They are
// not an OS sandbox: granting a shell grants the user's normal OS capabilities.
type toolPermissionsKey struct{}
type liveToolPermissionKey struct{}
type toolDefinitionRoleKey struct{}

func projectOnDemand(ctx context.Context) bool {
	role, _ := ctx.Value(toolDefinitionRoleKey{}).(string)
	if role == "" {
		if c, ok := ctx.Value(workspaceContextKey{}).(workspaceContext); ok && !c.workspace.privateAgentScope {
			role = c.role
		}
	}
	return (role == WorkspaceMatrix || role == WorkspaceExecution || role == "eyra" || role == "cota") && toolboxAvailable(ctx)
}

func WithToolPermissions(ctx context.Context, names []string) context.Context {
	allowed := map[string]bool{}
	for _, name := range names {
		allowed[name] = true
	}
	return context.WithValue(ctx, toolPermissionsKey{}, allowed)
}

func toolAllowed(ctx context.Context, name string) bool {
	if name == "core_link" {
		if identity, _ := ctx.Value(motherIdentityKey{}).(*motherIdentity); identity.active() && !identity.allowed(name) {
			return false
		}
		bound, ok := ctx.Value(conversationLinkCallerKey{}).(conversationLinkCaller)
		return ok && bound.ID != "" && bound.Generation > 0
	}
	if check, ok := ctx.Value(liveToolPermissionKey{}).(func(string) bool); ok && check != nil && !check(name) {
		return false
	}
	if !stageToolAllowed(name) {
		return false
	}
	allowed, restricted := ctx.Value(toolPermissionsKey{}).(map[string]bool)
	// Query/cancel an owned cell is part of the granted package lifecycle.
	// This does not expose arbitrary exec code to the recipient.
	if name == "wait" && stageToolAllowed("tool_factory") {
		if c, ok := ctx.Value(workspaceContextKey{}).(workspaceContext); ok && (c.role == WorkspaceMatrix || c.role == WorkspaceExecution) && allowed["tool_factory"] && packageWaitAvailable(ctx) {
			return true
		}
		for capability, on := range allowed {
			if on && toolcontract.VersionedID(capability) {
				return true
			}
		}
	}
	if c, ok := ctx.Value(workspaceContextKey{}).(workspaceContext); ok && (c.role == WorkspaceMatrix || c.role == WorkspaceExecution) && allowed["tool_factory"] && (strings.HasPrefix(name, "custom:") || toolcontract.ValidPackageID(name)) {
		return true
	}
	return !restricted || allowed[name]
}

func permittedCall(ctx context.Context, call ToolCall) error {
	if call.Function.Name == "toolbox" {
		return nil
	} // The executor returns a disabled receipt for stale calls; it cannot run a hidden capability.
	if !toolAllowed(ctx, call.Function.Name) {
		return fmt.Errorf("tool_not_assigned: %s", call.Function.Name)
	}
	return nil
}

func CodingToolDefinitions(s *Settings) []ToolDefinition {
	t := append([]ToolDefinition{PlanToolDefinition(), patchtool.PatchToolDefinition()}, ShellToolDefinitions()...)
	t = append(t, OrchestrationToolDefinitions()...)
	t = append(t, AgentToolDefinition())
	if CurrentReleaseStage().Toolbox {
		t = append(t, ToolboxDefinition())
	}
	// Image input, an enabled auxiliary vision model or local OCR is resolved
	// at invocation. Keep the assigned schema stable when model choice changes.
	t = append(t, ImageToolDefinition())
	if SupportsWebSearch(s) {
		t = append(t, WebSearchToolDefinition())
	}
	return t
}

func FilterToolDefinitions(ctx context.Context, definitions []ToolDefinition) []ToolDefinition {
	if _, ok := ctx.Value(workspaceContextKey{}).(workspaceContext); ok {
		definitions = append(append([]ToolDefinition(nil), definitions...), WorkspaceToolDefinitions()...)
	}
	var result []ToolDefinition
	ctx = withOfficialToolAdmission(ctx)
	for _, d := range definitions {
		if d.Name == "project" && projectOnDemand(ctx) || d.Name == "models" && toolAllowed(ctx, "agents") {
			continue
		}
		if d.Name == "link" && !toolboxDiscoveryHost(ctx, "os_desktop") {
			continue
		}
		if !officialToolVisible(ctx, d.Name) {
			continue
		}
		if (d.Name == "image_gen" || d.Name == "video_gen") && toolboxAvailable(ctx) {
			continue // Images belong to the on-demand Toolbox; no duplicate schema.
		}
		if toolAllowed(ctx, "terminal") && (d.Name == "exec_command" || d.Name == "write_stdin" || d.Name == "read_shell_output") {
			continue
		}
		// toolbox 与它的目录同源：没有任何可选能力获授权时不出现，避免"目录里有、实际不能用"。
		if d.Name == "toolbox" && toolboxAvailable(ctx) || d.Name != "toolbox" && toolAllowed(ctx, d.Name) {
			if c, ok := ctx.Value(workspaceContextKey{}).(workspaceContext); ok {
				d = c.workspace.toolDefinition(d)
			}
			if d.Name == "toolbox" {
				d = toolboxContextDefinition(ctx, d)
			}
			result = append(result, d)
		}
	}
	return result
}
