// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: TestPresetInheritanceAdmission
// Impact: python -B scripts/code-atlas.py show Theme/contract/presets_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

import (
	"encoding/json"
	"testing"
)

func TestPresetInheritanceAdmission(t *testing.T) {
	prefix := `{"schema":"aieyra.theme/1","elements":"1.0.0","tokens":{"--ui-accent":"#123456"},"presets":`
	good := `{"base":{"name":"Parent","values":{"tokens":{"--ui-accent":"#abcdef"}}},"child":{"name":"Child","extends":"base","values":{"tokens":{"--ui-text":"#dddddd"}}}}`
	p, err := Decode([]byte(prefix + good + `}`))
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := resolvePreset(p, "child", map[string]bool{})
	if err != nil || resolved.Tokens["--ui-accent"] != "#abcdef" || resolved.Tokens["--ui-text"] != "#dddddd" {
		t.Fatal(resolved, err)
	}
	for _, bad := range []string{
		`null`,
		`{"a":{"name":"A","extends":"b","values":{}},"b":{"name":"B","extends":"a","values":{}}}`,
		`{"a":{"name":"A","extends":"missing","values":{}}}`,
		`{"a":{"name":"A","extends":"","values":{}}}`,
		`{"a":{"name":"A","extends":null,"values":{}}}`,
		`{"a":{"name":"A","values":{"layouts":{"message":{"slot":"avatar"}}}}}`,
		`{"a":{"name":"A","values":{"assets":{}}}}`,
		`{"a":{"name":"A","values":{"tokens":{"wrong":null}}}}`,
		`{"a":{"name":"A","values":{"tokens":{"--ui-accent":"url(https://example.invalid/private)"}}}}`,
		`{"a":{"name":"A","values":null}}`,
	} {
		if _, err = Decode([]byte(prefix + bad + `}`)); err == nil {
			t.Fatalf("accepted invalid preset %s", bad)
		}
	}
	delete(p.Presets, "child")
	preset := p.Presets["base"]
	preset.Values["tokens"] = json.RawMessage(`{"--ui-accent":null}`)
	p.Presets["base"] = preset
	resolved, err = resolvePreset(p, "base", map[string]bool{})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := resolved.Tokens["--ui-accent"]; ok {
		t.Fatal("explicit token removal lost")
	}
}
