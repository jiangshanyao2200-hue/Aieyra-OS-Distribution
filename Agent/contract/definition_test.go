// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/contract/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: fixtureDefinition; TestDefinitionRejectsInvalidDefaultsAndResourceReferences; TestTeamRejectsUnknownMembersAndDuplicateRoleOrSetting
// Impact: python -B scripts/code-atlas.py show Agent/contract/definition_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

import (
	"encoding/json"
	"testing"
)

func fixtureDefinition() Definition {
	return Definition{Schema: 1, ID: "example.author", Version: "1.0.0", Name: "Author", ToolChoices: []string{"project", "apply_patch"}, DefaultTools: []string{"project"}, Prompts: map[string]string{"role": "子代/模板/工作.txt"}}
}

func TestDefinitionRejectsInvalidDefaultsAndResourceReferences(t *testing.T) {
	for name, change := range map[string]func(*Definition){
		"unsupported schema": func(d *Definition) { d.Schema = 2 },
		"missing identity":   func(d *Definition) { d.ID = "" },
		"invalid version":    func(d *Definition) { d.Version = "latest" },
		"unknown default":    func(d *Definition) { d.DefaultTools = []string{"memory"} },
		"duplicate tool":     func(d *Definition) { d.ToolChoices = []string{"project", "project"} },
		"traversal":          func(d *Definition) { d.Prompts["role"] = "../private.txt" },
		"drive":              func(d *Definition) { d.Prompts["role"] = "C:/private/fixture.txt" },
		"backslash":          func(d *Definition) { d.Prompts["role"] = "a\\b.txt" },
		"missing fragment":   func(d *Definition) { d.Prompts["role"] = "a.txt#" },
	} {
		t.Run(name, func(t *testing.T) {
			d := fixtureDefinition()
			change(&d)
			data, _ := json.Marshal(d)
			if _, err := ParseDefinition(data); err == nil {
				t.Fatal("accepted invalid definition")
			}
		})
	}
	d := fixtureDefinition()
	data, _ := json.Marshal(d)
	if _, err := ParseDefinition(data); err != nil {
		t.Fatal(err)
	}
	if _, err := ParseDefinition(append(data, []byte(` {}`)...)); err == nil {
		t.Fatal("accepted trailing JSON")
	}
	var extra map[string]any
	_ = json.Unmarshal(data, &extra)
	extra["api_key"] = "fixture"
	data, _ = json.Marshal(extra)
	if _, err := ParseDefinition(data); err == nil {
		t.Fatal("accepted undeclared field")
	}
}

func TestTeamRejectsUnknownMembersAndDuplicateRoleOrSetting(t *testing.T) {
	a, b := fixtureDefinition(), fixtureDefinition()
	b.ID = "example.helper"
	ds := map[string]Definition{a.ID: a, b.ID: b}
	base := Team{Schema: 1, Controller: a.ID, ControllerRole: "leader", Members: []TeamMember{{Role: "reviewer", Agent: b.ID, ToolsSetting: "reviewer_tools"}}}
	for _, change := range []func(*Team){
		func(v *Team) { v.Members[0].Agent = "missing" },
		func(v *Team) { v.Members[0].Role = "leader" },
		func(v *Team) { v.Members = append(v.Members, v.Members[0]) },
		func(v *Team) {
			v.Members = append(v.Members, TeamMember{Role: "writer", Agent: b.ID, ToolsSetting: "reviewer_tools"})
		},
	} {
		v := base.Clone()
		change(&v)
		data, _ := json.Marshal(v)
		if _, err := ParseTeam(data, ds); err == nil {
			t.Fatal("accepted invalid team", v)
		}
	}
	data, _ := json.Marshal(base)
	if _, err := ParseTeam(data, ds); err != nil {
		t.Fatal(err)
	}
}
