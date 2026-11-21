// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/parameters/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestGenericMappingsKeepExplicitFalseAndZero; TestReviewedRuleWinsAndStreamConstraintIsPerRequest; TestDescriptorRejectsIdentityAndNonFiniteValues
// Impact: python -B scripts/code-atlas.py show API/parameters/parameters_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package parameters_test

import (
	"encoding/json"
	"math"
	"reflect"
	"testing"

	"github.com/aieyra/aieyra-os/api/parameters"
)

func TestGenericMappingsKeepExplicitFalseAndZero(t *testing.T) {
	for _, tc := range []struct {
		name    string
		profile parameters.Profile
		want    map[string]any
	}{
		{"google-budget", parameters.Profile{Protocol: parameters.ProtocolGoogle, Options: map[string]any{"reasoning_budget": 0}}, map[string]any{"generationConfig": map[string]any{"thinkingConfig": map[string]any{"includeThoughts": true, "thinkingBudget": float64(0)}}}},
		{"messages-disabled", parameters.Profile{Protocol: parameters.ProtocolMessages, Options: map[string]any{"reasoning_enabled": false}}, map[string]any{"thinking": map[string]any{"type": "disabled"}}},
		{"responses-summary", parameters.Profile{Protocol: parameters.ProtocolResponses, Options: map[string]any{"reasoning_summary": "none", "reasoning_enabled": false}}, map[string]any{"reasoning": map[string]any{"summary": "none", "enabled": false}}},
		{"chat-router", parameters.Profile{Protocol: parameters.ProtocolChat, OpenRouter: true, Options: map[string]any{"reasoning_effort": "low"}}, map[string]any{"reasoning": map[string]any{"effort": "low"}}},
		{"vendor-default", parameters.Profile{Protocol: parameters.ProtocolResponses, OpenCode: true}, map[string]any{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tc.profile.Generic = true
			before, _ := json.Marshal(tc.profile)
			body := map[string]any{"temperature": 0.5, "top_p": 0.8}
			parameters.ApplyGeneric(tc.profile, body, true)
			if !reflect.DeepEqual(body, tc.want) {
				t.Fatal(body, tc.want)
			}
			after, _ := json.Marshal(tc.profile)
			if string(before) != string(after) {
				t.Fatal("profile modified")
			}
		})
	}
}

func TestReviewedRuleWinsAndStreamConstraintIsPerRequest(t *testing.T) {
	rule := parameters.Rule{Protocol: parameters.ProtocolChat, StreamOnly: true, Defaults: map[string]any{"reasoning_enabled": true}, ParameterSpecs: []parameters.Spec{
		{Key: "reasoning_enabled", Type: "boolean", WirePath: []string{"enable_thinking"}},
		{Key: "reasoning_effort", Type: "enum", Values: []string{"low", "high"}, WirePath: []string{"reasoning_effort"}},
		{Key: "reasoning_budget", Type: "integer", Min: 0, Max: 100, WirePath: []string{"thinking_budget"}},
	}}
	p := parameters.Profile{Generic: true, Protocol: parameters.ProtocolChat, Rule: &rule, Options: map[string]any{"reasoning_budget": 0, "reasoning_effort": "high"}}
	before, _ := json.Marshal(p)
	for _, streaming := range []bool{true, false, true} {
		body := map[string]any{"reasoning": map[string]any{"effort": "generic"}}
		parameters.ApplyGeneric(p, body, streaming)
		if body["enable_thinking"] != streaming || body["reasoning"] != nil || body["reasoning_effort"] != nil {
			t.Fatal(body)
		}
		_, budget := body["thinking_budget"]
		if budget != streaming || budget && body["thinking_budget"] != 0 {
			t.Fatal(body)
		}
	}
	after, _ := json.Marshal(p)
	if string(before) != string(after) {
		t.Fatal("rule defaults or options modified")
	}
}

func TestDescriptorRejectsIdentityAndNonFiniteValues(t *testing.T) {
	for _, path := range [][]string{{"model"}, {"headers"}, {"tools"}, {"messages"}, {"authorization"}, {"reasoning", "effort"}, {"generationConfig", "maxOutputTokens"}, {"text", "format"}, {"__proto__", "x"}} {
		if parameters.ValidPath(parameters.Spec{Key: "custom", Type: "boolean", WirePath: path, Source: "fixture documentation"}) {
			t.Fatal("reserved path accepted", path)
		}
	}
	spec := parameters.Spec{Key: "depth", Type: "integer", Min: 0, Max: 3, WirePath: []string{"reasoning", "depth"}, Source: "fixture documentation"}
	if !parameters.ValidPath(spec) || !parameters.ValidValue(spec, 0) {
		t.Fatal("valid custom option rejected")
	}
	for _, value := range []any{-1, 4, 1.5, math.NaN(), math.Inf(1), "2"} {
		if parameters.ValidValue(spec, value) {
			t.Fatal("invalid value accepted", value)
		}
	}
	body := parameters.Learned(parameters.Profile{Specs: []parameters.Spec{spec}, Options: map[string]any{"depth": 0}})
	if body["reasoning"].(map[string]any)["depth"] != float64(0) {
		t.Fatal("zero option lost", body)
	}
}
