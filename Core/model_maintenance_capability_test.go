// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestPooledMaintenanceRespectsAdvertisedEffort
// Impact: python -B scripts/code-atlas.py show Core/model_maintenance_capability_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"testing"
)

func TestPooledMaintenanceRespectsAdvertisedEffort(t *testing.T) {
	for _, tc := range []struct {
		name   string
		values []string
		want   any
	}{
		{"unknown-gpt", nil, nil},
		{"high-only", []string{"high"}, "high"},
		{"supports-low", []string{"low", "high"}, "low"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := Defaults()
			s.Adapter, s.APIProtocol, s.Model = "openai", ProtocolResponses, "gpt-unreviewed-fixture"
			s.ModelPoolVersion, s.ActiveProfile = 1, "fixture"
			s.ModelOptions = map[string]any{}
			p := APIProfile{ID: "fixture", Model: s.Model, ContextWindow: 128000, OutputLimit: 8192}
			if tc.values != nil {
				p.ParameterSpecs = []ParameterSpec{{Key: "reasoning_effort", Type: "enum", Values: tc.values}}
				s.ModelOptions["reasoning_effort"] = "high"
			}
			s.APIProfiles = []APIProfile{p}
			before, _ := json.Marshal(s)
			for _, maintenance := range []*Settings{compactionSettings(s), startupGreetingSettings(s)} {
				if maintenance.ModelOptions["reasoning_effort"] != tc.want {
					t.Fatalf("maintenance introduced unsupported effort: %#v", maintenance.ModelOptions)
				}
			}
			after, _ := json.Marshal(s)
			if string(before) != string(after) {
				t.Fatal("maintenance changed task settings")
			}
		})
	}
}
