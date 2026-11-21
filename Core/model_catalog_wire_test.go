// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: catalogWireFixture; TestCatalogThinkingWire; TestCatalogRejectsUnsupportedOrConflictingThinking
// Impact: python -B scripts/code-atlas.py show Core/model_catalog_wire_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func catalogWireFixture(model, protocol string, options map[string]any) *Settings {
	s := Defaults()
	s.ModelPoolVersion, s.ActiveProfile = 1, "c1-wire"
	s.APIProfiles = []APIProfile{{ID: s.ActiveProfile, ConnectionID: "bailian", Provider: "bailian", Model: model, BaseURL: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", Protocol: protocol, Adapter: "openai", ContextWindow: 8192, OutputLimit: 8192, ToolCalls: true, ContextWindowSource: "conservative_client_budget", Parameters: rawJSON(map[string]any{"max_tokens": 64, "model_options": options})}}
	s.ProviderConnections = []ProviderConnection{{ID: "bailian", Provider: "bailian", BaseURL: s.APIProfiles[0].BaseURL, APIKey: "synthetic-c1-key", RequestTimeout: 30}}
	s.applyPoolProfile()
	return s
}

func TestCatalogThinkingWire(t *testing.T) {
	cases := []struct {
		name, model, protocol string
		stream                bool
		options               map[string]any
		want                  map[string]any
		absent                []string
	}{
		{"qwen38-effort", "qwen3.8-flash", ProtocolChat, true, map[string]any{"reasoning_effort": "medium"}, map[string]any{"enable_thinking": true, "reasoning_effort": "medium"}, []string{"thinking_budget", "reasoning"}},
		{"qwen38-budget", "qwen3.8-max", ProtocolChat, true, map[string]any{"reasoning_budget": 0}, map[string]any{"enable_thinking": true, "thinking_budget": float64(0)}, []string{"reasoning_effort", "reasoning"}},
		{"qwen35-stream", "qwen3.5-27b", ProtocolChat, true, nil, map[string]any{"enable_thinking": true}, []string{"reasoning_effort", "reasoning"}},
		{"qwen35-nonstream", "qwen3.5-27b", ProtocolChat, false, nil, map[string]any{"enable_thinking": false}, []string{"reasoning_effort", "thinking_budget"}},
		{"qwen35-responses-nonstream", "qwen3.5-plus", ProtocolResponses, false, map[string]any{"reasoning_enabled": true}, map[string]any{"enable_thinking": false}, []string{"reasoning", "thinking_budget"}},
		{"qwen35-messages-nonstream", "qwen3.5-plus", ProtocolMessages, false, map[string]any{"thinking_mode": "enabled"}, map[string]any{"thinking": map[string]any{"type": "disabled"}}, []string{"output_config", "thinking_budget"}},
		{"glm53-budget-ignored", "glm-5.3", ProtocolChat, true, map[string]any{"reasoning_effort": "low", "reasoning_budget": 1000}, map[string]any{"enable_thinking": true, "reasoning_effort": "low", "tool_stream": true}, []string{"thinking_budget"}},
		{"kimi-k3", "kimi-k3", ProtocolChat, true, map[string]any{"reasoning_effort": "high"}, map[string]any{"enable_thinking": true, "reasoning_effort": "high"}, []string{"thinking_budget"}},
		{"kimi-vendor-max", "kimi/kimi-k3", ProtocolChat, true, map[string]any{"reasoning_effort": "max"}, map[string]any{"enable_thinking": true, "reasoning_effort": "max"}, []string{"thinking_budget"}},
		{"minimax-adaptive", "MiniMax/MiniMax-M3", ProtocolChat, true, nil, map[string]any{"thinking": map[string]any{"type": "adaptive"}}, []string{"enable_thinking", "reasoning_effort"}},
		{"minimax-disabled", "MiniMax/MiniMax-M3", ProtocolChat, false, map[string]any{"thinking_mode": "disabled"}, map[string]any{"thinking": map[string]any{"type": "disabled"}}, []string{"enable_thinking"}},
		{"qwen38-responses", "qwen3.8-max", ProtocolResponses, true, map[string]any{"reasoning_effort": "medium"}, map[string]any{"reasoning": map[string]any{"effort": "medium"}}, []string{"enable_thinking", "thinking_budget", "reasoning_effort"}},
		{"qwen38-messages", "qwen3.8-flash", ProtocolMessages, true, map[string]any{"reasoning_effort": "low"}, map[string]any{"thinking": map[string]any{"type": "enabled"}, "output_config": map[string]any{"effort": "low"}}, []string{"thinking_budget", "reasoning_effort", "enable_thinking"}},
	}
	records := map[string]any{}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := catalogWireFixture(tc.model, tc.protocol, tc.options)
			if err := s.ValidatePoolRequest(); err != nil {
				t.Fatal(err)
			}
			var request any
			switch tc.protocol {
			case ProtocolChat:
				request = BuildRequest(s, nil, tc.stream)
			case ProtocolResponses:
				request = BuildResponsesRequest(s, nil, tc.stream, nil)
			case ProtocolMessages:
				request = BuildNativeRequest(s, nil, tc.stream, nil)
			}
			raw, err := json.Marshal(request)
			if err != nil {
				t.Fatal(err)
			}
			var body map[string]any
			_ = json.Unmarshal(raw, &body)
			for key, value := range tc.want {
				if string(rawJSON(body[key])) != string(rawJSON(value)) {
					t.Fatalf("%s = %s; want %s", key, rawJSON(body[key]), rawJSON(value))
				}
			}
			for _, key := range tc.absent {
				if _, has := body[key]; has {
					t.Fatalf("unexpected wire field %s", key)
				}
			}
			records[tc.name] = body
		})
	}
	for _, protocol := range []string{ProtocolChat, ProtocolResponses} {
		s := catalogGeminiFixture()
		s.APIProfiles[0].Protocol = protocol
		s.applyPoolProfile()
		var request any = BuildRequest(s, nil, true)
		if protocol == ProtocolResponses {
			request = BuildResponsesRequest(s, nil, true, nil)
		}
		raw, _ := json.Marshal(request)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		// 网关只认 Google 的 thinking_level（Chat）；reasoning_effort 和 Responses 的档位都会被忽略。
		if protocol == ProtocolChat && (body["reasoning_effort"] != nil || string(rawJSON(body["extra_body"])) != `{"google":{"thinking_config":{"thinking_level":"high"}}}`) {
			t.Fatal("Gemini Chat effort not serialized")
		}
		if protocol == ProtocolResponses && body["reasoning"] != nil {
			t.Fatal("Gemini Responses effort not serialized")
		}
		records["gemini-"+protocol] = body
	}
	if dir := os.Getenv("AIEYRA_C1_EVIDENCE"); dir != "" {
		raw, _ := json.MarshalIndent(records, "", "  ")
		if err := os.WriteFile(filepath.Join(dir, "thinking-wire.json"), raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestCatalogRejectsUnsupportedOrConflictingThinking(t *testing.T) {
	for _, tc := range []struct {
		model, protocol string
		options         map[string]any
	}{
		{"qwen3.8-flash", ProtocolChat, map[string]any{"reasoning_budget": 100, "reasoning_effort": "low"}},
		{"qwen3.8-flash", ProtocolResponses, map[string]any{"reasoning_budget": 100}},
		{"kimi/kimi-k3", ProtocolChat, map[string]any{"reasoning_effort": "low"}},
		{"glm-5.3", ProtocolChat, map[string]any{"reasoning_enabled": false}},
	} {
		s := catalogWireFixture(tc.model, tc.protocol, tc.options)
		// Loading migrates stale persisted values; an explicit invalid edit must
		// still fail validation before any request can be sent.
		s.ModelOptions = cloneOptions(tc.options)
		if s.ValidatePoolRequest() == nil {
			t.Fatal("invalid thinking configuration accepted", tc.model, tc.protocol)
		}
	}
	qwen := catalogWireFixture("qwen3.8-flash", ProtocolChat, nil)
	f := qwen.activePoolProfile().ParameterSpecs[len(qwen.activePoolProfile().ParameterSpecs)-1]
	f.WirePath = []string{"model"}
	if validParameterPath(f) {
		t.Fatal("reviewed source permitted identity overwrite")
	}
	if validProfileParameterPath(catalogGeminiFixture().activePoolProfile(), qwen.activePoolProfile().ParameterSpecs[0]) {
		t.Fatal("provider-specific mapping accepted for a different relay")
	}
}
