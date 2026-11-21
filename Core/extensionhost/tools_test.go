// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/extensionhost/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestToolPackagesRequireImplementationManualViewsAndExactPermissions
// Impact: python -B scripts/code-atlas.py show Core/extensionhost/tools_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package extensionhost

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/modules"
)

func TestToolPackagesRequireImplementationManualViewsAndExactPermissions(t *testing.T) {
	for _, sample := range []string{"tool-statistics", "toolbox-report"} {
		source, _ := filepath.Abs(filepath.Join("..", "..", "SDK", "examples", sample))
		manager := New(t.TempDir(), Desktop())
		r, err := manager.Inspect(context.Background(), source)
		if err != nil || !r.Compatibility.Compatible {
			t.Fatal(sample, r, err)
		}
		for _, change := range []struct {
			name  string
			apply func(*modules.Package)
		}{
			{"no manual", func(p *modules.Package) { delete(p.Files, "manual.md") }},
			{"no view", func(p *modules.Package) { delete(p.Files, "desktop.json") }},
			{"empty manual", func(p *modules.Package) { p.Files["manual.md"] = []byte(" ") }},
			{"unknown renderer", func(p *modules.Package) {
				v := p.Manifest.Presentation["desktop"]
				v.Renderer = "arbitrary.html"
				p.Manifest.Presentation["desktop"] = v
			}},
			{"unknown cli", func(p *modules.Package) {
				p.Files["cli.json"] = []byte(`{"schema":"aieyra.tool-text/1","result":"output","format":"script"}`)
			}},
			{"invalid binding", func(p *modules.Package) {
				p.Files["desktop.json"] = []byte(`{"schema":"aieyra.tool-view/1","result":"invented","view":{"kind":"cards"}}`)
			}},
			{"empty columns", func(p *modules.Package) {
				p.Files["desktop.json"] = []byte(`{"schema":"aieyra.tool-view/1","result":"output","view":{"kind":"table"}}`)
			}},
			{"extra grant", func(p *modules.Package) {
				p.Manifest.Permissions = append(p.Manifest.Permissions, modules.Permission{Capability: "tool.invoke", Scope: "exec_command", Reason: "not declared by implementation"})
			}},
			{"unsupported schema", func(p *modules.Package) {
				p.Files["tool.json"] = []byte(`{"schema":"aieyra.tool/1","executor":"javascript/1","name":"bad","description":"Bad schema","entry":"run.js","input":{"type":"object","additionalProperties":true,"properties":{}},"capabilities":[]}`)
			}},
			{"unknown definition field", func(p *modules.Package) {
				p.Files["tool.json"] = []byte(`{"schema":"aieyra.tool/1","executor":"javascript/1","unknown":true}`)
			}},
		} {
			t.Run(sample+"/"+change.name, func(t *testing.T) {
				p, err := modules.Load(context.Background(), source)
				if err != nil {
					t.Fatal(err)
				}
				change.apply(p)
				if manager.ValidatePackage(p) == nil {
					t.Fatal("incomplete/unsupported tool declared compatible")
				}
			})
		}
	}
	source, _ := filepath.Abs(filepath.Join("..", "..", "SDK", "examples", "program-notebook"))
	p, err := modules.Load(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	p.Manifest.Permissions = []modules.Permission{{Capability: "tool.invoke", Scope: "apply_patch", Reason: "not supported by Program"}}
	if New(t.TempDir(), Desktop()).ValidatePackage(p) == nil {
		t.Fatal("Program inherited Tool-specific permission")
	}
}
