// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/extensionhost/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Agent
// Impact: python -B scripts/code-atlas.py show Core/extensionhost/agent.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package extensionhost

import (
	"fmt"

	"github.com/aieyra/aieyra-os/CORE/modules"
	agent "github.com/aieyra/aieyra-os/agent/contract"
)

// Agent applies the same complete definition and presentation checks to bundled
// public definitions and imported packages. This validates data, never authority.
func Agent(p *modules.Package) (agent.Package, error) {
	var empty agent.Package
	m := p.Manifest
	if m.Kind != "agent" || m.Contracts["agent"] == "" {
		return empty, fmt.Errorf("explicit agent contract required")
	}
	for client, renderer := range map[string]string{"desktop": "aieyra.agent", "cli": "aieyra.text"} {
		v := m.Presentation[client]
		if v.Contract != "1.0.0" || v.Renderer != renderer || v.Entry == "" {
			return empty, fmt.Errorf("unsupported %s agent presentation", client)
		}
	}
	pkg, err := agent.DecodePackage(p.Files, m.Entrypoints["agent"], m.Entrypoints["manual"], m.Presentation["desktop"].Entry, m.Presentation["cli"].Entry)
	if err != nil {
		return empty, err
	}
	d := pkg.Definition
	if d.ID != m.ID || d.Version != m.Version || d.Runtime.DataSchema != m.Data.Schema {
		return empty, fmt.Errorf("agent identity, version or data schema disagrees with its manifest")
	}
	deps, used, permissions := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, dep := range m.Dependencies {
		if !dep.Optional {
			deps[dep.ID] = true
		}
	}
	for _, name := range d.ToolChoices {
		permissions["tool.invoke\x00"+name] = true
	}
	for _, refs := range [][]string{d.Runtime.ToolPackages, d.Runtime.Programs} {
		for _, id := range refs {
			used[id] = true
			permissions["package.invoke\x00"+id] = true
		}
	}
	if pkg.Team != nil {
		for _, member := range pkg.Team.Members {
			used[member.Agent] = true
		}
	}
	if d.ContextProvider.ID != "aieyra.context.pac" && d.ContextProvider.ID != "aieyra.context.structured" {
		used[d.ContextProvider.ID] = true
	}
	for id := range used {
		if !deps[id] {
			return empty, fmt.Errorf("agent capability must declare a required dependency: %s", id)
		}
	}
	if len(permissions) != len(m.Permissions) {
		return empty, fmt.Errorf("agent permissions must exactly declare its capabilities")
	}
	for _, permission := range m.Permissions {
		key := permission.Capability + "\x00" + permission.Scope
		if !permissions[key] {
			return empty, fmt.Errorf("agent permission is not used: %s", permission.Scope)
		}
		delete(permissions, key)
	}
	return pkg, nil
}
