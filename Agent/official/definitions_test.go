// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/official/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: TestOfficialPackageManifestsDescribeExactPayload; TestOfficialSpecialistPackageIncludesCompleteEditablePrompt; TestOfficialDefinitionsReturnIndependentSnapshots
// Impact: python -B scripts/code-atlas.py show Agent/official/definitions_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package official

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/agent/contract"
)

func TestOfficialPackageManifestsDescribeExactPayload(t *testing.T) {
	for _, id := range PackageIDs() {
		files, err := PackageFiles(id)
		if err != nil {
			t.Fatal(err)
		}
		var manifest struct {
			Files map[string]struct {
				SHA256 string `json:"sha256"`
				Size   int    `json:"size"`
			} `json:"files"`
		}
		if err := json.Unmarshal(files["manifest.json"], &manifest); err != nil {
			t.Fatalf("%s: %v", id, err)
		}
		if len(manifest.Files) != len(files)-1 {
			t.Fatalf("%s manifest does not enumerate its complete payload", id)
		}
		for name, entry := range manifest.Files {
			data, exists := files[name]
			sum := sha256.Sum256(data)
			if !exists || name == "manifest.json" || entry.Size != len(data) || entry.SHA256 != hex.EncodeToString(sum[:]) {
				t.Fatalf("%s: invalid file receipt for %s", id, name)
			}
		}
	}
}

func TestOfficialSpecialistPackageIncludesCompleteEditablePrompt(t *testing.T) {
	for _, id := range []string{"aieyra.cota", "aieyra.vaya"} {
		files, err := PackageFiles(id)
		if err != nil {
			t.Fatal(err)
		}
		files["prompts/提示词.txt"] = append(files["prompts/提示词.txt"], []byte("\n## 安全与边界\nBOUNDARY_EDIT\n## 思考方式\nTHINKING_EDIT\n## 自定义\nCUSTOM_EDIT\n")...)
		p, err := contract.DecodePackage(files, "definition.json", "manual.md", "desktop.json", "cli.json")
		if err != nil {
			t.Fatal(err)
		}
		for _, marker := range []string{"BOUNDARY_EDIT", "THINKING_EDIT", "CUSTOM_EDIT"} {
			if strings.Count(p.Prompt, marker) != 1 {
				t.Fatalf("%s lost or repeated %s", id, marker)
			}
		}
	}
}

func TestOfficialDefinitionsReturnIndependentSnapshots(t *testing.T) {
	a, ok := Role("matrix")
	if !ok || a.Name != "Eyra" || !slices.Contains(a.DefaultTools, "memory") {
		t.Fatal(a, ok)
	}
	a.DefaultTools[0], a.ToolChoices[0], a.Prompts["contract"] = "invented", "invented", "invented"
	a, _ = Role("matrix")
	if a.DefaultTools[0] != "project" || a.ToolChoices[0] != "project" || a.Prompts["contract"] != "Matrix/运行协定/团队主控.txt" {
		t.Fatal("consumer changed shared definition", a)
	}
	names := Names()
	names["execution"] = "invented"
	if Name("execution") != "Cota" || Name("project") != "Vaya" {
		t.Fatal("shared names changed")
	}
	team := Team()
	team.Members[0].Agent, team.GrantableToolbox[0] = "invented", "invented"
	team = Team()
	if team.Members[0].Agent != "aieyra.vaya" || team.GrantableToolbox[0] != "image_gen" {
		t.Fatal("shared team changed", team)
	}
	if _, ok := Role("foreign"); ok {
		t.Fatal("unknown role gained Eyra definition")
	}
	for _, role := range []string{"project", "execution"} {
		d, _ := Role(role)
		if !slices.Contains(d.DefaultTools, "memory") || !slices.Contains(d.ToolChoices, "memory") || slices.Contains(d.ToolChoices, "image_gen") || !slices.Contains(d.ToolChoices, "apply_patch") {
			t.Fatal("role lost public memory or gained unassigned image generation", d)
		}
	}
	cota, _ := Role("execution")
	vaya, _ := Role("project")
	if !slices.Contains(cota.DefaultTools, "apply_patch") || !slices.Contains(cota.DefaultTools, "update_plan") || slices.Contains(vaya.DefaultTools, "apply_patch") || !slices.Contains(a.DefaultTools, "apply_patch") || !slices.Contains(a.DefaultTools, "terminal") {
		t.Fatal("professional execution and investigation defaults were mixed")
	}
}
