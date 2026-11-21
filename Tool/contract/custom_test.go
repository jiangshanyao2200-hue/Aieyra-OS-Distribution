// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fixture; TestExistingToolVersionIdentityAndPresentationArePreserved; TestInvalidSchemasCannotPanicOrAcceptArguments; TestViewCompatibilityRejectsExecutableOrUnsafeFields
// Impact: python -B scripts/code-atlas.py show Tool/contract/custom_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

import (
	"encoding/json"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"math"
	"strings"
	"testing"
)

func fixture(t *testing.T) CustomTool {
	t.Helper()
	var v CustomTool
	if err := json.Unmarshal([]byte(`{"presentation":{"kind":"cards","title":"Fixture"},"id":"","name":"fixture","description":"Fixture","code":"return args.value","schema":{"additionalProperties":false,"properties":{"value":{"type":"string"}},"required":["value"],"type":"object"},"capabilities":[]}`), &v); err != nil {
		t.Fatal(err)
	}
	return v
}
func TestExistingToolVersionIdentityAndPresentationArePreserved(t *testing.T) {
	v := fixture(t)
	if err := ValidateCustom(v, true); err != nil {
		t.Fatal(err)
	}
	id, err := CustomDigest(v)
	if err != nil || id != "custom:fixture.2abdc80b4d30e4b3" {
		t.Fatal(id, err)
	}
	v.ID = id
	again, err := CustomDigest(v)
	if again != id || err != nil || !ValidCustomID(id) {
		t.Fatal(again, err)
	}
	v.Presentation.Title = "Other"
	next, _ := CustomDigest(v)
	if next == id {
		t.Fatal("presentation change retained old version")
	}
	v.Presentation = nil
	if ValidateCustom(v, true) == nil {
		t.Fatal("new tool accepted without a view")
	}
	if err := ValidateCustom(v, false); err != nil {
		t.Fatal("legacy view omission lost compatibility", err)
	}
	v.Schema["fixture"] = math.NaN()
	if _, err := CustomDigest(v); err == nil {
		t.Fatal("non-JSON definition hashed")
	}
}
func TestInvalidSchemasCannotPanicOrAcceptArguments(t *testing.T) {
	for _, raw := range []string{`null`, `{}`, `{"type":"unknown"}`, `{"type":"object","additionalProperties":false}`, `{"type":"array"}`, `{"type":"object","additionalProperties":false,"properties":{},"required":[42]}`, `{"type":"integer","enum":["x"]}`, `{"type":"boolean","enum":true}`, `{"type":"string","enum":[]}`, `{"type":"array","items":{"type":"string"},"enum":[[]]}`} {
		t.Run(raw, func(t *testing.T) {
			var schema map[string]any
			if err := json.Unmarshal([]byte(raw), &schema); err != nil {
				t.Fatal(err)
			}
			if ValidateArguments(schema, map[string]any{}) == nil {
				t.Fatal("invalid schema accepted")
			}
		})
	}
	v := fixture(t)
	for _, args := range []any{nil, map[string]any{}, map[string]any{"value": 42.0}, map[string]any{"value": "x", "extra": true}} {
		if ValidateArguments(v.Schema, args) == nil {
			t.Fatal("invalid arguments accepted", args)
		}
	}
	if err := ValidateArguments(v.Schema, map[string]any{"value": "original"}); err != nil {
		t.Fatal(err)
	}
	if ValidateArguments(map[string]any{"type": "integer"}, float64(9007199254740992)) == nil {
		t.Fatal("unsafe integer accepted")
	}
}
func TestViewCompatibilityRejectsExecutableOrUnsafeFields(t *testing.T) {
	for _, view := range []*protocol.ToolPresentation{{Kind: "javascript"}, {Kind: "table", Columns: []protocol.ToolPresentationColumn{{Key: "__proto__", Label: "bad"}}}, {Kind: "cards", Title: strings.Repeat("a", 181)}} {
		if ValidatePresentation(view) == nil {
			t.Fatal(view)
		}
	}
	if err := ValidatePresentation(&protocol.ToolPresentation{Kind: "table", Columns: []protocol.ToolPresentationColumn{{Key: "path", Label: "File"}}}); err != nil {
		t.Fatal(err)
	}
}
