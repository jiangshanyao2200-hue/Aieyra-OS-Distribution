// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestCatalogMaintenancePreservesProfileAndPositiveGeminiBudget; TestCatalogMaintenanceThinkingFollowsProviderContract
// Impact: python -B scripts/code-atlas.py show Core/model_catalog_maintenance_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"testing"
)

func TestCatalogMaintenancePreservesProfileAndPositiveGeminiBudget(t *testing.T) {
	s := catalogGeminiFixture()
	s.applyPoolProfile()
	before := rawJSON(s)
	snapshot := compactionSettings(s)
	applyCatalogMaintenanceSettings(snapshot)
	if snapshot.MaxTokens != 2048 || snapshot.ContextBudget().InputLimit() != 200000 {
		t.Fatal("Gemini compaction output consumed its input budget")
	}
	if err := snapshot.Validate(); err != nil {
		t.Fatal("valid maintenance configuration rejected", err)
	}
	if string(before) != string(rawJSON(s)) {
		t.Fatal("maintenance normalization changed original settings")
	}
	var body map[string]any
	_ = json.Unmarshal(rawJSON(BuildResponsesRequest(snapshot, nil, false, nil)), &body)
	// 网关的 Responses 协议会忽略 Gemini 的思考档位（2026-11-04 实测），目录不再发送。
	if body["max_output_tokens"] != float64(2048) || body["reasoning"] != nil {
		t.Fatal("Gemini maintenance wire does not follow its catalog rule")
	}
}

func TestCatalogMaintenanceThinkingFollowsProviderContract(t *testing.T) {
	for _, tc := range []struct{ model, mode, effort string }{
		{"qwen3.8-flash", "disabled", ""},
		{"qwen3.5-plus", "disabled", ""},
		{"glm-5.3", "enabled", "low"},
		{"kimi-k3", "enabled", ""},
	} {
		s := catalogWireFixture(tc.model, ProtocolMessages, nil)
		before := rawJSON(s)
		snapshot := compactionSettings(s)
		applyCatalogMaintenanceSettings(snapshot)
		if err := snapshot.ValidatePoolRequest(); err != nil {
			t.Fatalf("%s maintenance settings rejected: %v", tc.model, err)
		}
		var body map[string]any
		_ = json.Unmarshal(rawJSON(BuildNativeRequest(snapshot, nil, false, nil)), &body)
		if string(rawJSON(body["thinking"])) != `{"type":"`+tc.mode+`"}` {
			t.Fatal("maintenance thinking did not follow catalog", tc.model)
		}
		if tc.effort != "" && string(rawJSON(body["output_config"])) != `{"effort":"`+tc.effort+`"}` {
			t.Fatal("always-thinking maintenance effort was lost", tc.model)
		}
		if string(before) != string(rawJSON(s)) {
			t.Fatal("maintenance changed saved profile", tc.model)
		}
	}
}
