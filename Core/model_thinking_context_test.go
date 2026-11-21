// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: nativeModelConfigFixture; modelConfigBody; TestNativeModelConfigurationUsesRealCapacityAndExactEffort; TestNativeModelContextMigratesUserBudgetsAndPreservesInputCeilings; TestCatalogCapacityMigrationKeepsProviderCeilingsAndExactCompact; TestLegacyModelSamplingNeverReachesAnyProtocol; TestDeepSeekChatRelayUsesNativeThinkingToggle; TestObsoleteModelThinkingDefaultsMigrateWithoutBlockingOtherProfiles
// Impact: python -B scripts/code-atlas.py show Core/model_thinking_context_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"testing"
)

func nativeModelConfigFixture(model, protocol string, options map[string]any) *Settings {
	s := Defaults()
	s.ModelPoolVersion, s.ActiveProfile = 1, "native-model-config"
	s.APIProfiles = []APIProfile{{ID: s.ActiveProfile, ConnectionID: "relay", Provider: "custom", Model: model,
		BaseURL: "https://relay.invalid/v1", Protocol: protocol, Adapter: "openai",
		ContextWindow: 8192, OutputLimit: 2048, ContextWindowSource: "conservative_client_budget",
		ResponseVerified: true, CompactAtTokens: catalogInt(6000),
		Parameters: rawJSON(map[string]any{"max_tokens": 0, "model_options": options})}}
	s.ProviderConnections = []ProviderConnection{{ID: "relay", Provider: "custom", BaseURL: s.APIProfiles[0].BaseURL, APIKey: "synthetic-native-key", RequestTimeout: 30}}
	s.applyPoolProfile()
	return s
}

func modelConfigBody(t *testing.T, s *Settings) map[string]any {
	t.Helper()
	if err := s.ValidatePoolRequest(); err != nil {
		t.Fatal(err)
	}
	var request any
	switch s.Protocol() {
	case ProtocolChat:
		request = BuildRequest(s, nil, true)
	case ProtocolResponses:
		request = BuildResponsesRequest(s, nil, true, nil)
	default:
		request = BuildNativeRequest(s, nil, true, nil)
	}
	raw, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	return body
}

func TestNativeModelConfigurationUsesRealCapacityAndExactEffort(t *testing.T) {
	for _, tc := range []struct {
		model         string
		window, input int
		efforts       []string
	}{
		{"gemini-4-argon", 1048576, 1042432, []string{"low", "medium", "high"}},
		{"gpt-6.1-sol", 1050000, 919952, []string{"low", "medium", "high", "xhigh", "max"}},
	} {
		t.Run(tc.model, func(t *testing.T) {
			s := nativeModelConfigFixture(tc.model, ProtocolResponses, nil)
			p := s.activePoolProfile()
			if p.ContextWindow != tc.window || s.ContextBudget().InputLimit() != tc.input || *p.CompactAtTokens != 6000 {
				t.Fatalf("wrong capacity or migrated threshold: profile=%+v budget=%+v", p, s.ContextBudget())
			}
			if p.ToolCalls || p.Vision {
				t.Fatal("native reference granted relay capabilities")
			}
			rule, ok := catalogRule(p)
			if !ok || string(rawJSON(rule.ParameterSpecs[0].Values)) != string(rawJSON(tc.efforts)) {
				t.Fatal("wrong effort enum", rule)
			}
			if _, has := modelConfigBody(t, s)["reasoning"]; has {
				t.Fatal("Auto should leave supplier default unset")
			}
			s.ModelOptions = map[string]any{"reasoning_effort": "low"}
			if string(rawJSON(modelConfigBody(t, s)["reasoning"])) != `{"effort":"low"}` {
				t.Fatal("effort not serialized")
			}
			s.ModelOptions["reasoning_effort"] = "none"
			if s.ValidatePoolRequest() == nil {
				t.Fatal("unsupported none accepted")
			}
		})
	}
}

func TestNativeModelContextMigratesUserBudgetsAndPreservesInputCeilings(t *testing.T) {
	s := nativeModelConfigFixture("gpt-6.1-sol", ProtocolResponses, nil)
	p := s.activePoolProfile()
	p.ContextWindow, p.ContextWindowSource, p.OutputLimit = 380000, "user_config", 8192
	p.CompactAtTokens = catalogInt(0)
	s.applyPoolProfile()
	if p.ContextWindow != 1050000 || p.OutputLimit != 8192 || s.ContextBudget().Window != 1050000 || s.ContextBudget().InputLimit() != 919952 || s.ContextBudget().Threshold() != 0 {
		t.Fatal("known capacity or disabled compaction lost", s.ContextBudget())
	}
	b := ContextBudget{Window: 1050000, Output: 4096, MaxInput: 922000, Working: 1000000, Percent: 100}
	if b.WorkingLimit() != 919952 || b.Threshold() != 919952 || b.AccommodateRequiredInput(925000).InputLimit() != 919952 {
		t.Fatal("independent input cap bypassed", b)
	}
	q := catalogWireFixture("qwen3.8-flash", ProtocolChat, nil)
	if q.ContextBudget().InputLimit() != 981568 {
		t.Fatal("Qwen thinking input cap missing", q.ContextBudget())
	}
	q = catalogWireFixture("qwen-plus-2025-07-14", ProtocolChat, nil)
	if q.APIProfiles[0].ContextWindow != 131072 || q.ContextBudget().InputLimit() != 96256 {
		t.Fatal("snapshot version inherited latest capacity", q.ContextBudget())
	}
}

func TestCatalogCapacityMigrationKeepsProviderCeilingsAndExactCompact(t *testing.T) {
	for _, source := range []string{"user_config", "user", "", "conservative_client_budget", "provider_catalog", "official_model_reference", "bundled_model_reference"} {
		for _, compact := range []int{0, 1234, 6000, 286000} {
			s := nativeModelConfigFixture("gemini-4-argon", ProtocolResponses, nil)
			p := s.activePoolProfile()
			p.ContextWindow, p.ContextWindowSource, p.OutputLimit = 380000, source, 2048
			p.CompactAtTokens = catalogInt(compact)
			s.applyPoolProfile()
			want := 1048576
			if source == "provider_catalog" || source == "official_model_reference" || source == "bundled_model_reference" {
				want = 380000
			}
			if p.ContextWindow != want || *p.CompactAtTokens != compact {
				t.Fatalf("%s: capacity=%d compact=%d", source, p.ContextWindow, *p.CompactAtTokens)
			}
			before := string(rawJSON(p))
			s.applyPoolProfile()
			if before != string(rawJSON(p)) {
				t.Fatal("capacity migration is not idempotent", source)
			}
		}
	}
	s := nativeModelConfigFixture("gemini-4-argon", ProtocolResponses, nil)
	p := s.activePoolProfile()
	p.ContextWindow, p.ContextWindowLimit, p.ContextWindowSource = 64000, 128000, "user_config"
	p.CompactAtTokens = catalogInt(0)
	s.applyPoolProfile()
	if p.ContextWindow != 128000 || profileContextLimit(p) != 128000 || *p.CompactAtTokens != 0 {
		t.Fatal("explicit provider ceiling or zero lost", p)
	}
	p.Model, p.ContextWindow, p.ContextWindowLimit, p.ContextWindowSource = "unreviewed-capacity-model", 64000, 0, "user_config"
	before := string(rawJSON(p))
	upgradeCatalogProfile(p)
	if string(rawJSON(p)) != before || profileContextLimit(p) != 0 {
		t.Fatal("unknown capacity was invented", p)
	}
}

func TestLegacyModelSamplingNeverReachesAnyProtocol(t *testing.T) {
	legacy := map[string]any{"temperature": .4, "top_p": .5, "top_k": 5, "min_p": .1, "frequency_penalty": 1, "presence_penalty": 1, "repetition_penalty": 1, "seed": 7, "stop": []any{"old-stop"}, "logprobs": true, "top_logprobs": 3}
	for _, protocol := range []string{ProtocolChat, ProtocolResponses, ProtocolMessages, ProtocolGoogle} {
		t.Run(protocol, func(t *testing.T) {
			s := nativeModelConfigFixture("unlisted-model", protocol, legacy)
			body := modelConfigBody(t, s)
			for key := range legacy {
				if _, has := body[key]; has {
					t.Fatalf("sampling field leaked: %s", key)
				}
			}
			if g, ok := body["generationConfig"].(map[string]any); ok {
				for _, key := range []string{"temperature", "topP", "topK", "seed", "stopSequences"} {
					if _, has := g[key]; has {
						t.Fatalf("Google sampling field leaked: %s", key)
					}
				}
			}
		})
	}
	for _, protocol := range []string{ProtocolChat, ProtocolResponses} {
		for _, thinking := range []string{"enabled", "disabled"} {
			s := Defaults()
			s.APIProtocol = protocol
			s.ThinkingType = thinking
			s.Temperature = .2
			s.TopP = .5
			body := modelConfigBody(t, s)
			if body["temperature"] != nil || body["top_p"] != nil {
				t.Fatal("DeepSeek legacy sampling leaked")
			}
		}
	}
}

func TestDeepSeekChatRelayUsesNativeThinkingToggle(t *testing.T) {
	for _, effort := range []string{"none", "low", "max"} {
		s := nativeModelConfigFixture("deepseek-flash", ProtocolChat, map[string]any{"reasoning_effort": effort})
		s.APIProfiles[0].ParameterSpecs = []ParameterSpec{{Key: "reasoning_effort", Type: "enum", Values: []string{"none", "low", "high", "max"}}}
		body := modelConfigBody(t, s)
		mode := "enabled"
		if effort == "none" {
			mode = "disabled"
			if body["reasoning_effort"] != nil {
				t.Fatal("Chat sent none instead of disabled")
			}
		} else if body["reasoning_effort"] != effort {
			t.Fatal(body)
		}
		if body["thinking"].(map[string]any)["type"] != mode {
			t.Fatal(body)
		}
	}
}

func TestObsoleteModelThinkingDefaultsMigrateWithoutBlockingOtherProfiles(t *testing.T) {
	s := nativeModelConfigFixture("gpt-6.1-sol", ProtocolResponses, map[string]any{"reasoning_effort": "none", "reasoning_summary": "auto", "temperature": .7})
	if len(s.ModelOptions) != 2 || s.ModelOptions["temperature"] != .7 || s.ModelOptions["reasoning_summary"] != "auto" {
		t.Fatal("obsolete thinking selections not cleared", s.ModelOptions)
	}
	if err := s.ValidatePoolRequest(); err != nil {
		t.Fatal(err)
	}
	if reasoning := modelConfigBody(t, s)["reasoning"].(map[string]any); reasoning["effort"] != nil || reasoning["summary"] != "auto" {
		t.Fatal("obsolete effort was sent or valid summary lost", reasoning)
	}
	fast := nativeModelConfigFixture("gpt-6-astra", ProtocolResponses, map[string]any{"reasoning_effort": "low", "reasoning_summary": "concise", "service_tier": "fast"})
	if err := fast.ValidatePoolRequest(); err != nil {
		t.Fatal(err)
	}
	if modelConfigBody(t, fast)["service_tier"] != "fast" {
		t.Fatal("existing fast tier lost")
	}
}
