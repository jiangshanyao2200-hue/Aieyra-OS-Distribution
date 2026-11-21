// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/extensionhost/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: bundledAgent; TestOfficialAgentsUseCompleteCommonPackageContract; TestAgentManifestCannotOmitGrantsOrChangeDefinitionIdentity
// Impact: python -B scripts/code-atlas.py show Core/extensionhost/agent_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package extensionhost

import (
	"encoding/json"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/modules"
	agent "github.com/aieyra/aieyra-os/agent/contract"
	"github.com/aieyra/aieyra-os/agent/official"
)

func bundledAgent(t *testing.T, id string) *modules.Package {
	t.Helper()
	files, err := official.PackageFiles(id)
	if err != nil {
		t.Fatal(err)
	}
	p, err := modules.FromFiles(files)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestOfficialAgentsUseCompleteCommonPackageContract(t *testing.T) {
	for _, id := range official.PackageIDs() {
		t.Run(id, func(t *testing.T) {
			p := bundledAgent(t, id)
			v, err := Agent(p)
			if err != nil || v.Definition.ID != id || v.Prompt == "" || v.Definition.Runtime.Budget.MaxTokens < 1 {
				t.Fatal(v, err)
			}
			if id == "aieyra.eyra" && (v.Team == nil || len(v.Team.Members) != 2) {
				t.Fatal("official team is missing from the common definition")
			}
		})
	}
}

func TestAgentManifestCannotOmitGrantsOrChangeDefinitionIdentity(t *testing.T) {
	cases := map[string]func(*modules.Package){
		"missing permission": func(p *modules.Package) { p.Manifest.Permissions = nil },
		"extra permission": func(p *modules.Package) {
			p.Manifest.Permissions = append(p.Manifest.Permissions, modules.Permission{Capability: "tool.invoke", Scope: "computer", Reason: "unused"})
		},
		"wrong identity":          func(p *modules.Package) { p.Manifest.ID = "other.agent" },
		"missing team dependency": func(p *modules.Package) { p.Manifest.Dependencies = nil },
		"unsupported presentation": func(p *modules.Package) {
			v := p.Manifest.Presentation["desktop"]
			v.Renderer = "execute-html"
			p.Manifest.Presentation["desktop"] = v
		},
		"different data schema": func(p *modules.Package) { p.Manifest.Data.Schema++ },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			p := bundledAgent(t, "aieyra.eyra")
			change(p)
			if _, err := Agent(p); err == nil {
				t.Fatal("invalid Agent package accepted")
			}
		})
	}
	// Package-local public text, not the host index, resolves an imported alias.
	p := bundledAgent(t, "aieyra.vaya")
	var d agent.Definition
	if err := json.Unmarshal(p.Files["definition.json"], &d); err != nil {
		t.Fatal(err)
	}
	d.Runtime.PromptFiles = nil
	p.Files["definition.json"], _ = json.Marshal(d)
	if _, err := Agent(p); err == nil {
		t.Fatal("legacy resource names escaped package ownership")
	}
}
