// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/extensionhost/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Workbox
// Impact: python -B scripts/code-atlas.py show Core/extensionhost/workbox.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package extensionhost

import (
	"fmt"
	"github.com/aieyra/aieyra-os/CORE/modules"
	"github.com/aieyra/aieyra-os/tool/workbox"
)

// Workbox verifies executable references against the same outer manifest used
// for dependency resolution and permission grants. Definitions grant nothing.
func Workbox(p *modules.Package) (workbox.Package, error) {
	m := p.Manifest
	var empty workbox.Package
	if m.Kind != "workbox" || m.Contracts["workbox"] == "" {
		return empty, fmt.Errorf("explicit workbox contract required")
	}
	for client, renderer := range map[string]string{"desktop": "aieyra.workbox", "cli": "aieyra.text"} {
		v := m.Presentation[client]
		if v.Contract != "1.0.0" || v.Renderer != renderer || v.Entry == "" {
			return empty, fmt.Errorf("unsupported %s workflow presentation", client)
		}
	}
	v, err := workbox.Decode(p.Files, m.Entrypoints["workflow"], m.Entrypoints["manual"], m.Presentation["desktop"].Entry, m.Presentation["cli"].Entry)
	if err != nil {
		return v, err
	}
	want := map[string]bool{}
	deps := map[string]bool{}
	for _, dep := range m.Dependencies {
		if !dep.Optional {
			deps[dep.ID] = true
		}
	}
	for _, ref := range v.Tools {
		if ref.Builtin != "" {
			want["tool.invoke\x00"+ref.Builtin] = true
		} else {
			if !deps[ref.Package] {
				return v, fmt.Errorf("workflow tool must be a required package dependency: %s", ref.Package)
			}
			want["package.invoke\x00"+ref.Package] = true
		}
	}
	if a := v.AgentTemplate; a != nil && a.Package != "" {
		if !deps[a.Package] {
			return v, fmt.Errorf("specialist must declare a required Agent dependency: %s", a.Package)
		}
		want["package.invoke\x00"+a.Package] = true
	}
	if len(want) != len(m.Permissions) {
		return v, fmt.Errorf("workflow permissions must exactly declare its tools")
	}
	for _, permission := range m.Permissions {
		key := permission.Capability + "\x00" + permission.Scope
		if !want[key] {
			return v, fmt.Errorf("workflow permission is not used: %s", permission.Scope)
		}
		delete(want, key)
	}
	return v, nil
}
