// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: TestContentRendererAdmission
// Impact: python -B scripts/code-atlas.py show Theme/contract/definition_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

import (
	"encoding/json"
	"testing"
)

func TestContentRendererAdmission(t *testing.T) {
	good := Definition{Schema: "aieyra.theme/1", Elements: "1.0.0", Renderers: map[string]Node{
		"aieyra.content.code/1":        {Tag: "section", Children: []Node{{Slot: "caption"}, {Slot: "content"}}},
		"aieyra.content.quote/1":       {Slot: "content"},
		"aieyra.content.table/1":       {Slot: "content"},
		"aieyra.content.thinking/1":    {Children: []Node{{Slot: "heading"}, {Slot: "content"}}},
		"aieyra.content.tool-result/1": {Children: []Node{{Slot: "summary"}, {Slot: "content"}, {Slot: "details"}}},
		"aieyra.content.image/1":       {Children: []Node{{Slot: "heading"}, {Slot: "content"}, {Slot: "controls"}}},
		"aieyra.content.media/1":       {Children: []Node{{Slot: "heading"}, {Slot: "content"}, {Slot: "controls"}}},
		"aieyra.content.attachment/1":  {Tag: "span", Children: []Node{{Slot: "name"}, {Slot: "metadata"}}},
	}}
	raw, _ := json.Marshal(good)
	if _, err := Decode(raw); err != nil {
		t.Fatal(err)
	}
	cases := map[string]map[string]Node{
		"future version":          {"aieyra.content.code/2": {Slot: "content"}},
		"missing content":         {"aieyra.content.code/1": {Slot: "caption"}},
		"duplicated content":      {"aieyra.content.quote/1": {Children: []Node{{Slot: "content"}, {Slot: "content"}}}},
		"script":                  {"aieyra.content.quote/1": {Tag: "script", Children: []Node{{Slot: "content"}}}},
		"external asset":          {"aieyra.content.table/1": {Slot: "content", Style: map[string]string{"background": "url(https://example.invalid/image)"}}},
		"lost media controls":     {"aieyra.content.media/1": {Children: []Node{{Slot: "heading"}, {Slot: "content"}}}},
		"lost image controls":     {"aieyra.content.image/1": {Children: []Node{{Slot: "heading"}, {Slot: "content"}}}},
		"invalid button contents": {"aieyra.content.attachment/1": {Tag: "section", Children: []Node{{Slot: "name"}, {Slot: "metadata"}}}},
	}
	for name, renderers := range cases {
		t.Run(name, func(t *testing.T) {
			good.Renderers = renderers
			raw, _ := json.Marshal(good)
			if _, err := Decode(raw); err == nil {
				t.Fatal("accepted unsafe or incompatible content renderer")
			}
		})
	}
}
