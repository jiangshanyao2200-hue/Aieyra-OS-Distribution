// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/extensionhost/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Desktop; New; Context; Tool; nativeTool
// Impact: python -B scripts/code-atlas.py show Core/extensionhost/desktop.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package extensionhost assembles implemented extension contracts for a client.
// The generic module store never depends on an individual extension runtime.
package extensionhost

import (
	"encoding/json"
	"fmt"
	"reflect"
	"runtime"

	"github.com/aieyra/aieyra-os/CORE/modules"
	"github.com/aieyra/aieyra-os/agent/context/packaged"
	"github.com/aieyra/aieyra-os/api/adapter"
	halo "github.com/aieyra/aieyra-os/halo/contract"
	program "github.com/aieyra/aieyra-os/program/contract"
	theme "github.com/aieyra/aieyra-os/theme/contract"
	toolowner "github.com/aieyra/aieyra-os/tool"
	tool "github.com/aieyra/aieyra-os/tool/contract"
)

func Desktop() modules.Host {
	return modules.Host{Client: "desktop", Platform: runtime.GOOS + "/" + runtime.GOARCH,
		Contracts:    map[string]string{"core": "1.0.0", "api": "1.0.0", "context": "1.0.0", "program": "1.2.0", "theme": "1.4.0", "halo": "1.0.0", "tool": "1.1.0", "workbox": "1.0.0", "agent": "1.0.0"},
		Capabilities: []string{"network.https", "tool.invoke", "package.invoke"}, Kinds: []string{"api", "context", "halo", "program", "theme", "tool", "toolbox", "workbox", "agent"}}
}

func New(root string, host modules.Host) *modules.Manager {
	m := modules.New(root, host)
	m.LoadSource = loadSource
	var catalogError error
	m.OfficialDigests, catalogError = officialDigests()
	m.ValidatePackage = func(p *modules.Package) error {
		if catalogError != nil {
			return catalogError
		}
		switch p.Manifest.Kind {
		case "context":
			_, err := Context(p)
			return err
		case "api":
			if p.Manifest.Contracts["api"] == "" || len(p.Manifest.Permissions) != 0 || len(p.Manifest.Capabilities) != 0 {
				return fmt.Errorf("API adapter requires an explicit contract and no execution permissions or capabilities")
			}
			_, err := adapter.Decode(p.Files[p.Manifest.Entrypoints["adapter"]])
			return err
		case "agent":
			_, err := Agent(p)
			return err
		case "workbox":
			_, err := Workbox(p)
			return err
		case "tool", "toolbox":
			_, err := Tool(p)
			return err
		case "halo":
			if p.Manifest.Contracts["halo"] == "" || len(p.Manifest.Permissions) != 0 || len(p.Manifest.Capabilities) != 0 {
				return fmt.Errorf("halo requires an explicit contract and no execution permissions or capabilities")
			}
			_, err := halo.Decode(p.Files[p.Manifest.Entrypoints["halo"]])
			return err
		case "theme":
			if p.Manifest.Contracts["theme"] == "" || len(p.Manifest.Permissions) != 0 {
				return fmt.Errorf("theme contract must be explicit and must not request execution permissions")
			}
			definition, err := theme.Decode(p.Files[p.Manifest.Entrypoints["theme"]])
			if err != nil {
				return err
			}
			return definition.ValidateFiles(p.Files)
		case "program":
			for _, permission := range p.Manifest.Permissions {
				if permission.Capability != "network.https" {
					return fmt.Errorf("program runtime cannot consume permission %s", permission.Capability)
				}
			}
			if p.Manifest.Contracts["program"] == "" {
				return fmt.Errorf("program contract must be explicit")
			}
			files := map[string]bool{}
			for name := range p.Files {
				files[name] = true
			}
			definition, err := program.Decode(p.Files[p.Manifest.Entrypoints["program"]], files)
			if err == nil && definition.Desktop.Native != "" {
				trusted := false
				for _, digest := range m.OfficialDigests[p.Manifest.ID] {
					trusted = trusted || digest == p.Digest
				}
				contract := "^1.1.0"
				if definition.Desktop.Navigation.Host == "process" {
					contract = "^1.2.0"
				}
				if !trusted || p.Manifest.ID != "aieyra."+definition.Desktop.Native || p.Manifest.Contracts["program"] != contract {
					return fmt.Errorf("native program requires the exact compiled official package and adapter contract")
				}
			}
			return err
		default:
			return fmt.Errorf("package runtime is not implemented: %s", p.Manifest.Kind)
		}
	}
	m.DefaultPackages = OfficialPackages
	m.RetiredPackages = map[string]bool{"aieyra.notes": true}
	m.HostManagedDefaults = map[string]bool{"aieyra.browser": true, "aieyra.servers": true, "aieyra.link": true, "aieyra.coding": true, "aieyra.workspace": true, "aieyra.center": true, "aieyra.together": true, "aieyra.tool.image_gen": true}
	// Native tool payloads are compiled with this host. Upgrade their installed
	// metadata with the adapter, retaining explicit disables/removals and grants.
	for _, tool := range toolowner.Officials() {
		m.HostManagedDefaults[tool.ID] = true
	}
	return m
}

func Context(p *modules.Package) (packaged.Definition, error) {
	m := p.Manifest
	if m.Kind != "context" || m.Contracts["context"] == "" || len(m.Permissions) != 0 || len(m.Capabilities) != 0 {
		return packaged.Definition{}, fmt.Errorf("context policy requires an explicit contract and no execution permissions or capabilities")
	}
	d, err := packaged.Decode(p.Files[m.Entrypoints["context"]])
	if err != nil {
		return d, err
	}
	if d.ID != m.ID || d.Version != m.Version || d.StateSchema != m.Data.Schema {
		return d, fmt.Errorf("context policy identity, version or schema differs from its manifest")
	}
	return d, nil
}

// Tool checks type-specific execution and presentation contracts after the
// generic registry has checked file integrity, compatibility and grants.
func Tool(p *modules.Package) (tool.PackageTool, error) {
	m := p.Manifest
	if m.Kind != "tool" && m.Kind != "toolbox" || m.Contracts["tool"] == "" {
		return tool.PackageTool{}, fmt.Errorf("explicit tool package contract is required")
	}
	var header struct {
		Schema string `json:"schema"`
	}
	_ = json.Unmarshal(p.Files[m.Entrypoints["tool"]], &header)
	if header.Schema == "aieyra.native-tool/1" {
		return nativeTool(p)
	}
	for client, renderer := range map[string]string{"desktop": "aieyra.tool", "cli": "aieyra.text"} {
		v := m.Presentation[client]
		if v.Contract != "1.0.0" || v.Renderer != renderer || v.Entry == "" {
			return tool.PackageTool{}, fmt.Errorf("unsupported %s tool presentation", client)
		}
	}
	v, err := tool.DecodePackage(p.Files, m.Entrypoints["tool"], m.Entrypoints["manual"], m.Presentation["desktop"].Entry, m.Presentation["cli"].Entry)
	if err != nil {
		return v, err
	}
	want := map[string]bool{}
	for _, cap := range v.Capabilities {
		want[cap] = true
	}
	if len(m.Permissions) != len(want) {
		return v, fmt.Errorf("tool permissions must exactly declare implementation capabilities")
	}
	for _, permission := range m.Permissions {
		if permission.Capability != "tool.invoke" || !want[permission.Scope] {
			return v, fmt.Errorf("tool permission does not match implementation capability")
		}
		delete(want, permission.Scope)
	}
	return v, nil
}

func nativeTool(p *modules.Package) (tool.PackageTool, error) {
	m := p.Manifest
	d, err := tool.DecodeNative(p.Files[m.Entrypoints["tool"]])
	if err != nil {
		return tool.PackageTool{}, err
	}
	own, known := toolowner.Find(m.ID)
	digests, err := officialDigests()
	trusted := false
	for _, digest := range digests[m.ID] {
		trusted = trusted || digest == p.Digest
	}
	if err != nil || !trusted || !known || d.Name != own.Name || !reflect.DeepEqual(d.Aliases, own.Aliases) || m.Contracts["tool"] != "^1.1.0" || len(m.Permissions) != 0 || len(m.Capabilities) != 0 {
		return tool.PackageTool{}, fmt.Errorf("native tool requires the exact compiled official payload and adapter contract")
	}
	for client, renderer := range map[string]string{"desktop": "aieyra.native-tool", "cli": "aieyra.native-text"} {
		view := m.Presentation[client]
		if view.Renderer != renderer || view.Contract != "1.0.0" || len(p.Files[view.Entry]) == 0 {
			return tool.PackageTool{}, fmt.Errorf("native tool requires its actual %s presentation", client)
		}
	}
	return tool.PackageTool{Native: d.Name, Kind: m.Kind, Manual: string(p.Files[m.Entrypoints["manual"]])}, nil
}
