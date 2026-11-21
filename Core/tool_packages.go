// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: toolPackages; versionedTool; versionedToolPermitted; packageToolCatalogue; packageWaitAvailable
// Impact: python -B scripts/code-atlas.py show Core/tool_packages.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/aieyra/aieyra-os/CORE/extensionhost"
	"github.com/aieyra/aieyra-os/CORE/modules"
	"github.com/aieyra/aieyra-os/CORE/platform"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	toolowner "github.com/aieyra/aieyra-os/tool"
	tool "github.com/aieyra/aieyra-os/tool/contract"
	"github.com/aieyra/aieyra-os/tool/workbox"
)

func (m *AgentManager) toolPackages() *modules.Manager {
	layout := platform.ResolveLayout(platform.AppRoot(), m.config, "")
	return extensionhost.New(layout.Packages, extensionhost.Desktop())
}

func (m *AgentManager) versionedTool(ctx context.Context, id string) (tool.PackageTool, error) {
	if tool.ValidCustomID(id) {
		v, err := m.customTool(id)
		return tool.PackageTool{CustomTool: v, Manual: v.Description}, err
	}
	name, digest, ok := tool.ParsePackageID(id)
	if !ok {
		return tool.PackageTool{}, fmt.Errorf("invalid versioned tool identity")
	}
	resolved, err := m.toolPackages().Call(ctx, modules.Request{Action: "resolve", ID: name})
	if err != nil {
		return tool.PackageTool{}, err
	}
	if resolved.Item == nil || resolved.Item.Digest != digest {
		return tool.PackageTool{}, fmt.Errorf("tool package version is no longer enabled; discover and open the current version")
	}
	p, err := modules.Load(ctx, resolved.Directory)
	if err != nil {
		return tool.PackageTool{}, err
	}
	if p.Digest != digest {
		return tool.PackageTool{}, fmt.Errorf("tool package changed during resolution")
	}
	var v tool.PackageTool
	if p.Manifest.Kind == "workbox" {
		var workflow workbox.Package
		workflow, err = extensionhost.Workbox(p)
		if err == nil {
			v = tool.PackageTool{Kind: "workbox", Manual: workflow.Manual + "\n" + workbox.CommandManual, CustomTool: tool.CustomTool{Name: workflow.Name, Description: workflow.Description, Schema: workbox.RequestSchema(), Presentation: &protocol.ToolPresentation{Kind: "cards", Title: workflow.Title}}}
			for _, ref := range workflow.Tools {
				if ref.Builtin != "" {
					v.Capabilities = append(v.Capabilities, ref.Builtin)
					continue
				}
				found := false
				for _, dep := range resolved.Dependencies {
					if dep.Manifest.ID == ref.Package && (dep.Manifest.Kind == "tool" || dep.Manifest.Kind == "toolbox") {
						identity := "mod:" + dep.Manifest.ID + "@" + dep.Digest
						nested, e := m.versionedTool(ctx, identity)
						if e != nil {
							return v, e
						}
						v.Capabilities = append(v.Capabilities, identity)
						v.Capabilities = append(v.Capabilities, nested.Capabilities...)
						found = true
						break
					}
				}
				if !found {
					return v, fmt.Errorf("workflow dependency must be an executable tool: %s", ref.Package)
				}
			}
		}
	} else {
		v, err = extensionhost.Tool(p)
	}
	if err != nil {
		return v, err
	}
	if v.Native != "" {
		return tool.PackageTool{}, fmt.Errorf("compiled tool uses its declared native entry %s; call that tool directly with its existing input and receipt contract", v.Native)
	}
	current, err := m.toolPackages().Call(ctx, modules.Request{Action: "resolve", ID: name})
	if err != nil {
		return tool.PackageTool{}, err
	}
	if current.Revision != resolved.Revision || current.Item == nil || current.Item.Digest != digest {
		return tool.PackageTool{}, fmt.Errorf("tool registry changed during admission; discover and open again")
	}
	// This validated snapshot admits the invocation. Later updates/disable
	// affect new invocations; already admitted cells keep their owned payload.
	v.ID = id
	return v, err
}

func versionedToolPermitted(ctx context.Context, v tool.PackageTool) error {
	if !toolAllowed(ctx, v.ID) {
		return fmt.Errorf("tool_not_assigned: %s", v.ID)
	}
	required := append([]string{"wait"}, v.Capabilities...)
	for _, cap := range required {
		if !toolAllowed(ctx, cap) {
			return fmt.Errorf("tool_not_assigned: %s", cap)
		}
	}
	return nil
}

func packageToolCatalogue(ctx context.Context) string {
	manager, ok := ctx.Value(agentManagerKey{}).(agentManagerContext)
	if !ok || manager.manager == nil {
		return ""
	}
	list, err := manager.manager.toolPackages().Call(ctx, modules.Request{Action: "list"})
	if err != nil {
		return " Tool packages unavailable: registry validation failed."
	}
	var rows []string
	for _, item := range list.Items {
		if _, native := toolowner.Find(item.Manifest.ID); native {
			continue
		} // Native entries retain their direct schema and receipts.
		if !item.Enabled || item.Manifest.Kind != "tool" && item.Manifest.Kind != "toolbox" && item.Manifest.Kind != "workbox" {
			continue
		}
		id := "mod:" + item.Manifest.ID + "@" + item.Digest
		if !toolAllowed(ctx, id) {
			continue
		}
		v, err := manager.manager.versionedTool(ctx, id)
		if err != nil || versionedToolPermitted(ctx, v) != nil {
			continue
		}
		input, _ := json.Marshal(v.Schema)
		rows = append(rows, id+": "+v.Description+" Input: "+string(input)+". Open for the complete manual.")
		if len(rows) >= 64 {
			break
		}
	}
	return strings.Join(rows, "\n")
}

// Avoid adding wait to sessions with no executable extensions. Open manuals
// retain the query route when a version is later disabled or removed.
func packageWaitAvailable(ctx context.Context) bool {
	if execution, ok := ctx.Value(toolboxContextKey{}).(toolboxExecution); ok && execution.state != nil {
		for name, on := range execution.state.Open {
			if on && tool.VersionedID(name) {
				return true
			}
		}
	}
	manager, ok := ctx.Value(agentManagerKey{}).(agentManagerContext)
	if !ok || manager.manager == nil {
		return false
	}
	if rows, err := manager.manager.toolFactory(ctx, json.RawMessage(`{"action":"list"}`)); err == nil && len(rows.([]map[string]string)) > 0 {
		return true
	}
	snapshot, err := manager.manager.toolPackages().Call(ctx, modules.Request{Action: "list"})
	if err != nil {
		return false
	}
	for _, item := range snapshot.Items {
		if _, native := toolowner.Find(item.Manifest.ID); native {
			continue
		}
		if item.Enabled && (item.Manifest.Kind == "tool" || item.Manifest.Kind == "toolbox" || item.Manifest.Kind == "workbox") {
			return true
		}
	}
	return false
}
