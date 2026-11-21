// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: nativeWorkflowKey; nativeWorkflowCapabilities; workflowPackage; workflowCapabilities; workflowAdmit
// Impact: python -B scripts/code-atlas.py show Core/workbox_packages.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"
	"reflect"
	"sort"

	"github.com/aieyra/aieyra-os/CORE/extensionhost"
	"github.com/aieyra/aieyra-os/CORE/modules"
	tool "github.com/aieyra/aieyra-os/tool/contract"
	"github.com/aieyra/aieyra-os/tool/workbox"
)

type nativeWorkflowKey struct{}

// Only the authenticated user entry grants an enabled workflow's declared
// capabilities independently of Eyra's role defaults. The normal version and
// permission admission still runs before new work; receipt recovery stays first.
func nativeWorkflowCapabilities(ctx context.Context, i workbox.Instance) context.Context {
	if native, _ := ctx.Value(nativeWorkflowKey{}).(bool); !native {
		return ctx
	}
	names := workflowCapabilities(i.Package, i.Tools)
	if allowed, ok := ctx.Value(toolPermissionsKey{}).(map[string]bool); ok {
		for name, on := range allowed {
			if on {
				names = append(names, name)
			}
		}
	}
	return WithToolPermissions(ctx, names)
}

func (m *AgentManager) workflowPackage(ctx context.Context, id string) (workbox.Package, map[string]string, map[string]workbox.LockedTool, error) {
	var p workbox.Package
	name, digest, ok := tool.ParsePackageID(id)
	if !ok {
		return p, nil, nil, fmt.Errorf("invalid workflow package identity")
	}
	store := m.toolPackages()
	r, err := store.Call(ctx, modules.Request{Action: "resolve", ID: name})
	if err != nil {
		return p, nil, nil, err
	}
	if r.Item == nil || r.Item.Digest != digest {
		return p, nil, nil, fmt.Errorf("workflow package version is not enabled")
	}
	source, err := modules.Load(ctx, r.Directory)
	if err != nil {
		return p, nil, nil, err
	}
	if source.Digest != digest {
		return p, nil, nil, fmt.Errorf("workflow package changed")
	}
	p, err = extensionhost.Workbox(source)
	if err != nil {
		return p, nil, nil, err
	}
	dependencies := map[string]string{}
	kinds := map[string]string{}
	for _, dep := range r.Dependencies {
		dependencies[dep.Manifest.ID] = dep.Digest
		kinds[dep.Manifest.ID] = dep.Manifest.Kind
	}
	tools := map[string]workbox.LockedTool{}
	for alias, ref := range p.Tools {
		if ref.Builtin != "" {
			tools[alias] = workbox.LockedTool{Identity: ref.Builtin, Capabilities: []string{ref.Builtin}}
			continue
		}
		hash := dependencies[ref.Package]
		if hash == "" {
			return p, nil, nil, fmt.Errorf("unresolved workflow tool: %s", ref.Package)
		}
		if kinds[ref.Package] != "tool" && kinds[ref.Package] != "toolbox" {
			return p, nil, nil, fmt.Errorf("workflow dependency must be a tool")
		}
		identity := "mod:" + ref.Package + "@" + hash
		v, e := m.versionedTool(ctx, identity)
		if e != nil {
			return p, nil, nil, e
		}
		if v.Kind == "workbox" {
			return p, nil, nil, fmt.Errorf("recursive Workbox dispatch is not supported")
		}
		tools[alias] = workbox.LockedTool{Identity: identity, Capabilities: append([]string(nil), v.Capabilities...)}
	}
	if a := p.AgentTemplate; a != nil && a.Package != "" {
		if kinds[a.Package] != "agent" || dependencies[a.Package] == "" {
			return p, nil, nil, fmt.Errorf("specialist dependency must resolve to an Agent")
		}
		bound, e := m.resolveAgentPackage(ctx, "mod:"+a.Package+"@"+dependencies[a.Package])
		if e != nil {
			return p, nil, nil, e
		}
		if bound.Definition.Runtime.WorkflowPort != "aieyra.workbox/1" {
			return p, nil, nil, fmt.Errorf("specialist Agent does not declare the bound workflow port")
		}
	}
	last, err := store.Call(ctx, modules.Request{Action: "resolve", ID: name})
	if err != nil {
		return p, nil, nil, err
	}
	if last.Revision != r.Revision {
		return p, nil, nil, fmt.Errorf("workflow dependencies changed during admission")
	}
	return p, dependencies, tools, nil
}

func workflowCapabilities(id string, locked map[string]workbox.LockedTool) []string {
	seen := map[string]bool{id: true, "wait": true}
	for _, t := range locked {
		seen[t.Identity] = true
		for _, c := range t.Capabilities {
			seen[c] = true
		}
	}
	out := []string{}
	for c := range seen {
		out = append(out, c)
	}
	sort.Strings(out)
	return out
}
func (m *AgentManager) workflowAdmit(ctx context.Context, i workbox.Instance) error {
	p, deps, tools, err := m.workflowPackage(ctx, i.Package)
	if err != nil {
		return err
	}
	if !reflect.DeepEqual(p.Definition, i.Definition) || !reflect.DeepEqual(deps, i.Dependencies) || !reflect.DeepEqual(tools, i.Tools) {
		return fmt.Errorf("workflow dependency version or permission changed; existing results remain readable")
	}
	for _, c := range workflowCapabilities(i.Package, i.Tools) {
		if !toolAllowed(ctx, c) {
			return fmt.Errorf("tool_not_assigned: %s", c)
		}
	}
	return nil
}
