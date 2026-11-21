// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestBailianThinkingDescriptorPreservesFalseAndProviderDefault; TestLearnedParametersSurviveEachProtocolAndDoNotReplaceCoreFields; TestLearnedDeepSeekOptionsMergeWithStandardReasoning
// Impact: python -B scripts/code-atlas.py show Core/parameter_descriptors_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"testing"
)

func TestBailianThinkingDescriptorPreservesFalseAndProviderDefault(t *testing.T) {
	for _, value := range []any{true, false, nil} {
		s := Defaults()
		s.Adapter = "openai"
		s.APIProtocol = ProtocolChat
		s.BaseURL = "https://llm-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
		s.Model = "qwen3.8-flash"
		s.ActiveProfile = "bailian-test"
		s.APIProfiles = []APIProfile{{ID: s.ActiveProfile, Provider: "bailian", ParameterSpecs: []ParameterSpec{{Key: "reasoning_enabled", Type: "boolean", WirePath: []string{"enable_thinking"}, Source: "https://help.aliyun.com/zh/model-studio/deep-thinking"}}}}
		s.ModelOptions = map[string]any{}
		if value != nil {
			s.ModelOptions["reasoning_enabled"] = value
		}
		raw, err := json.Marshal(BuildRequest(s, []Message{{Role: RoleUser, Content: "hello"}}, true))
		if err != nil {
			t.Fatal(err)
		}
		var body map[string]any
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Fatal(err)
		}
		actual, present := body["enable_thinking"]
		if present != (value != nil) || actual != value {
			t.Fatalf("thinking value %v lost: %s", value, raw)
		}
		if _, exists := body["reasoning"]; exists {
			t.Fatalf("wrong protocol field: %s", raw)
		}
	}
}

func TestLearnedParametersSurviveEachProtocolAndDoNotReplaceCoreFields(t *testing.T) {
	for _, protocol := range []string{ProtocolResponses, ProtocolChat, ProtocolMessages, ProtocolGoogle} {
		t.Run(protocol, func(t *testing.T) {
			s := Defaults()
			s.Adapter = "openai"
			s.Model = "test-model"
			s.BaseURL = "https://example.test"
			s.APIKey = "synthetic-only"
			s.APIProtocol = protocol
			s.ActiveProfile = "test"
			s.ModelPoolVersion = 1
			s.MaxTokens = 2048
			path := []string{"thinking", "adaptive_depth"}
			if protocol == ProtocolResponses {
				path = []string{"reasoning", "adaptive_depth"}
			}
			if protocol == ProtocolGoogle {
				path = []string{"generationConfig", "adaptiveDepth"}
			}
			enabled := true
			s.APIProfiles = []APIProfile{{ID: "test", ConnectionID: "test", Model: s.Model, Adapter: s.Adapter, BaseURL: s.BaseURL, Protocol: protocol, Enabled: &enabled, ResponseVerified: true, ToolCalls: false, ParameterSpecs: []ParameterSpec{{Key: "adaptive_depth", Type: "integer", Min: 1, Max: 5, WirePath: path, Source: "synthetic provider documentation"}}}}
			s.ProviderConnections = []ProviderConnection{{ID: "test", BaseURL: s.BaseURL, APIKey: s.APIKey}}
			s.ModelOptions = map[string]any{"adaptive_depth": 3.0}
			if err := s.ValidatePoolRequest(); err != nil {
				t.Fatal(err)
			}
			var request any
			switch protocol {
			case ProtocolResponses:
				request = BuildResponsesRequest(s, []Message{{Role: RoleUser, Content: "hello"}}, false, nil)
			case ProtocolChat:
				request = BuildRequest(s, []Message{{Role: RoleUser, Content: "hello"}}, false)
			default:
				request = BuildNativeRequest(s, []Message{{Role: RoleUser, Content: "hello"}}, false, nil)
			}
			raw, err := json.Marshal(request)
			if err != nil {
				t.Fatal(err)
			}
			var body map[string]any
			if err = json.Unmarshal(raw, &body); err != nil {
				t.Fatal(err)
			}
			nested, ok := body[path[0]].(map[string]any)
			if !ok || nested[path[1]] != 3.0 {
				t.Fatalf("parameter missing: %s", raw)
			}
			if protocol == ProtocolGoogle && nested["maxOutputTokens"] != 2048.0 {
				t.Fatal("output limit lost")
			}
			clone := s.Clone()
			clone.APIProfiles[0].ParameterSpecs[0].WirePath[1] = "changed"
			if s.APIProfiles[0].ParameterSpecs[0].WirePath[1] == "changed" {
				t.Fatal("descriptor shares mutable memory")
			}
			s.APIProfiles[0].ParameterSpecs[0].WirePath = []string{"messages"}
			if s.ValidatePoolRequest() == nil {
				t.Fatal("unsafe parameter accepted")
			}
		})
	}
}

func TestLearnedDeepSeekOptionsMergeWithStandardReasoning(t *testing.T) {
	s := Defaults()
	s.ActiveProfile = "d"
	s.ModelOptions = map[string]any{"adaptive_depth": 2.0}
	s.APIProfiles = []APIProfile{{ID: "d", ParameterSpecs: []ParameterSpec{{Key: "adaptive_depth", Type: "integer", Min: 1, Max: 5, WirePath: []string{"reasoning", "adaptive_depth"}, Source: "synthetic test source"}}}}
	raw, err := json.Marshal(BuildResponsesRequest(s, nil, false, nil))
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.Unmarshal(raw, &body)
	r := body["reasoning"].(map[string]any)
	if r["adaptive_depth"] != 2.0 || r["effort"] == nil {
		t.Fatalf("reasoning merge lost standard field %s", raw)
	}
	for _, path := range [][]string{{"authorization"}, {"reasoning", "effort"}, {"generationConfig", "maxOutputTokens"}, {"text", "format"}, {"__proto__", "x"}} {
		if validParameterPath(ParameterSpec{Key: "bad", Type: "boolean", WirePath: path, Source: "test"}) {
			t.Fatal("unsafe path", path)
		}
	}
}
