// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/contract/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: packageFixture; decodeFixture; TestAgentPackageReadsOnlyExplicitPublicFilesAndSections; TestAgentPackageRejectsIncompleteOrUnsafeContracts; TestAgentPackageLegacyAliasesRemainPackageLocalAndCloneIndependent
// Impact: python -B scripts/code-atlas.py show Agent/contract/package_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

import (
	"encoding/json"
	"strings"
	"testing"

	contextport "github.com/aieyra/aieyra-os/contracts/context"
)

func packageFixture() (Definition, map[string][]byte) {
	d := Definition{Schema: 1, ID: "sample.reviewer", Version: "1.0.0", Name: "Reviewer", ToolChoices: []string{"project"}, DefaultTools: []string{"project"}, Prompts: map[string]string{"role": "prompts/public.txt#Role", "boundary": "prompts/boundary.txt"}, ContextProvider: &contextport.Reference{ID: "aieyra.context.structured", Version: "1.0.0", StateSchema: 1}, Runtime: &PackageRuntime{Model: ModelRequirements{ToolCalls: true}, Budget: AgentBudget{MaxTokens: 10000, TimeoutSeconds: 60}, Policy: AgentPolicy{WorkMode: "direct-or-delegate", Lifetime: "retained"}, PromptOrder: []string{"role", "boundary"}, DataSchema: 1}}
	return d, map[string][]byte{"prompts/public.txt": []byte("## Role\nUse actual receipts.\n## Other\nDo not select this section."), "prompts/boundary.txt": {}, "manual.md": []byte("Create an idle instance, select a model, then send work."), "desktop.json": []byte(`{"schema":"aieyra.agent-view/1","view":"task","title":"Reviewer"}`), "cli.json": []byte(`{"schema":"aieyra.agent-view/1","view":"json","title":"Reviewer"}`)}
}

func decodeFixture(d Definition, files map[string][]byte) (Package, error) {
	files["agent.json"], _ = json.Marshal(d)
	return DecodePackage(files, "agent.json", "manual.md", "desktop.json", "cli.json")
}

func TestAgentPackageReadsOnlyExplicitPublicFilesAndSections(t *testing.T) {
	d, files := packageFixture()
	p, err := decodeFixture(d, files)
	if err != nil || !strings.Contains(p.Prompt, "actual receipts") || strings.Contains(p.Prompt, "Do not select") {
		t.Fatal(p, err)
	}
	// A familiar host resource name is still only a name inside this package.
	d.Prompts["role"] = "Matrix/自我.txt"
	if _, err := decodeFixture(d, files); err == nil {
		t.Fatal("missing package text must never fall back to the host index")
	}
	files["Matrix/自我.txt"] = []byte("package-owned, never the user's private prompt")
	p, err = decodeFixture(d, files)
	if err != nil || !strings.Contains(p.Prompt, "package-owned") {
		t.Fatal(p, err)
	}
}

func TestAgentPackageRejectsIncompleteOrUnsafeContracts(t *testing.T) {
	cases := map[string]func(*Definition, map[string][]byte){
		"source only":       func(d *Definition, _ map[string][]byte) { d.Runtime = nil },
		"unbounded budget":  func(d *Definition, _ map[string][]byte) { d.Runtime.Budget.MaxTokens = 0 },
		"unbounded time":    func(d *Definition, _ map[string][]byte) { d.Runtime.Budget.TimeoutSeconds = 3601 },
		"missing provider":  func(d *Definition, _ map[string][]byte) { d.ContextProvider = nil },
		"unsupported data":  func(d *Definition, _ map[string][]byte) { d.Runtime.DataSchema = 2 },
		"unresolved prompt": func(d *Definition, _ map[string][]byte) { d.Runtime.PromptOrder = []string{"missing"} },
		"traversal":         func(d *Definition, _ map[string][]byte) { d.Prompts["role"] = "../private.txt" },
		"missing section":   func(d *Definition, _ map[string][]byte) { d.Prompts["role"] = "prompts/public.txt#Absent" },
		"bad UTF8":          func(_ *Definition, f map[string][]byte) { f["prompts/public.txt"] = []byte{255} },
		"missing manual":    func(_ *Definition, f map[string][]byte) { delete(f, "manual.md") },
		"missing CLI":       func(_ *Definition, f map[string][]byte) { delete(f, "cli.json") },
		"invented renderer": func(_ *Definition, f map[string][]byte) {
			f["desktop.json"] = []byte(`{"schema":"aieyra.agent-view/1","view":"execute-html","title":"Wrong"}`)
		},
		"model lacks tools": func(d *Definition, _ map[string][]byte) { d.Runtime.Model.ToolCalls = false },
		"incomplete local mapping": func(d *Definition, _ map[string][]byte) {
			d.Runtime.PromptFiles = map[string]string{"role": "prompts/public.txt"}
		},
		"wrong controller": func(d *Definition, f map[string][]byte) {
			d.Runtime.Team = "team.json"
			f["team.json"] = []byte(`{"schema":1,"controller":"another.agent","controller_role":"lead","members":[],"grantable_toolbox":[]}`)
		},
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			d, files := packageFixture()
			change(&d, files)
			if _, err := decodeFixture(d, files); err == nil {
				t.Fatal("incomplete package was accepted")
			}
		})
	}
}

func TestAgentPackageLegacyAliasesRemainPackageLocalAndCloneIndependent(t *testing.T) {
	d, files := packageFixture()
	d.Runtime.PromptFiles = map[string]string{"role": "prompts/public.txt#Role", "boundary": "prompts/boundary.txt"}
	d.Prompts["role"] = "Legacy/role.txt"
	p, err := decodeFixture(d, files)
	if err != nil || !strings.Contains(p.Prompt, "actual receipts") {
		t.Fatal(p, err)
	}
	clone := d.Clone()
	clone.Runtime.PromptFiles["role"], clone.Runtime.PromptOrder[0], clone.Runtime.Budget.MaxTokens = "changed.txt", "changed", 1
	if d.Runtime.PromptFiles["role"] != "prompts/public.txt#Role" || d.Runtime.PromptOrder[0] != "role" || d.Runtime.Budget.MaxTokens != 10000 {
		t.Fatal("instance mutation changed the public definition")
	}
}
