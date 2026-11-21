// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestNativeReferenceExactIdentityAndMissingControls; catalogGeminiFixture; catalogRoundTripper; RoundTrip; TestCatalogGeminiPlaceholderCanSend; TestCatalogMigrationPreservesDeclaredLimitsAndExactIdentity; TestCatalogDoesNotClampPriorGPTMigration
// Impact: python -B scripts/code-atlas.py show Core/model_catalog_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativeReferenceExactIdentityAndMissingControls(t *testing.T) {
	for _, id := range []string{"unrelated/grok-4.7", "openai/grok-4.7", "GROK-4.7", "grok-4.7-turbo"} {
		if _, ok := nativeModelReference(id); ok {
			t.Fatalf("unverified identity matched: %s", id)
		}
	}
	for _, id := range []string{"grok-4.7", "x-ai/grok-4.7", "xai/grok-4.7:free"} {
		m, ok := nativeModelReference(id)
		if !ok || m.ContextWindow != 500000 {
			t.Fatalf("exact identity missing: %s", id)
		}
	}
	p := APIProfile{Provider: "custom", Model: "mistral-small-2506", BaseURL: "https://relay.invalid/v1", Protocol: ProtocolChat, ContextWindow: 8192, ContextWindowSource: "conservative_client_budget", OutputLimit: 2048}
	upgradeKnownProfile(&p)
	if p.ContextWindow != 128000 || p.ToolCalls {
		t.Fatalf("reference confused with channel proof: %+v", p)
	}
	m := ModelCatalogEntry{Reasoning: true, ReasoningOptions: []ModelReasoningOption{{Type: "effort", Values: []string{"low", "high"}}}}
	p.ParameterSpecs = []ParameterSpec{{Key: "reasoning_effort", Type: "enum", Values: []string{"user-existing"}}}
	enrichNativeThinking(&p, m)
	if len(p.ParameterSpecs) != 1 || p.ParameterSpecs[0].Values[0] != "user-existing" {
		t.Fatal("existing controls overwritten")
	}
	p.ParameterSpecs = nil
	enrichNativeThinking(&p, m)
	enrichNativeThinking(&p, m)
	if len(p.ParameterSpecs) != 1 || len(p.ParameterSpecs[0].Values) != 2 {
		t.Fatal("missing controls not added idempotently")
	}
}

func catalogGeminiFixture() *Settings {
	s := Defaults()
	s.ModelPoolVersion, s.ActiveProfile = 1, "matrix-94d7732c1a24665785db"
	s.APIProfiles = []APIProfile{{ID: s.ActiveProfile, ConnectionID: "user-aieyra", Provider: "custom", Model: "gemini-3.8-flash-high", BaseURL: "https://fast.aieyra.cn/v1", Protocol: ProtocolResponses, Adapter: "openai", ContextWindow: 8192, OutputLimit: 8192, ContextWindowSource: "conservative_client_budget", Parameters: rawJSON(map[string]any{"max_tokens": 0, "thinking_type": "enabled", "reasoning_effort": "high", "model_options": map[string]any{}})}}
	s.ProviderConnections = []ProviderConnection{{ID: "user-aieyra", Provider: "custom", BaseURL: s.APIProfiles[0].BaseURL, APIKey: "synthetic-c1-key", RequestTimeout: 30}}
	return s
}

type catalogRoundTripper func(*http.Request) (*http.Response, error)

func (f catalogRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestCatalogGeminiPlaceholderCanSend(t *testing.T) {
	s := catalogGeminiFixture()
	broken := ContextBudget{Window: s.APIProfiles[0].ContextWindow, Output: s.APIProfiles[0].OutputLimit}
	if broken.InputLimit() != 0 {
		t.Fatal("fixture no longer reproduces the zero input budget")
	}
	file := filepath.Join(t.TempDir(), "config.json")
	raw, _ := json.Marshal(s)
	if err := os.WriteFile(file, raw, 0600); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(file)
	if err != nil {
		t.Fatal(err)
	}
	p := loaded.activePoolProfile()
	if p.ContextWindow != 8192 || p.OutputLimit != 2048 || !p.ToolCalls || loaded.ContextBudget().InputLimit() != 200000 || *p.CompactAtTokens != 200000 {
		t.Fatal("Gemini migration did not restore a positive budget and verified tools")
	}
	if err := loaded.ValidatePoolRequest(); err != nil {
		t.Fatal(err)
	}
	client := New(loaded)
	calls := 0
	client.http.Transport = catalogRoundTripper(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != "https://fast.aieyra.cn/v1/responses" {
			t.Fatal("wrong endpoint")
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if _, capped := body["max_output_tokens"]; capped || body["model"] != p.Model {
			t.Fatal("local context reservation must not become a wire output cap")
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"id":"c1-fixture","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"C1_OK"}]}]}`))}, nil
	})
	m, _, err := client.Complete(context.Background(), loaded, []Message{{Role: RoleUser, Content: "Reply C1_OK"}})
	if err != nil || m.Content != "C1_OK" || calls != 1 {
		t.Fatal("migrated profile failed to complete the local provider request", err)
	}
	after, _ := os.ReadFile(file)
	if string(raw) != string(after) {
		t.Fatal("loading edited the source configuration")
	}
}

func TestCatalogMigrationPreservesDeclaredLimitsAndExactIdentity(t *testing.T) {
	for _, source := range []string{"provider_catalog", "user", "", "bundled_model_reference"} {
		p := catalogGeminiFixture().APIProfiles[0]
		p.ContextWindowSource, p.OutputLimit = source, 900
		before := rawJSON(p)
		upgradeKnownProfile(&p)
		if string(before) != string(rawJSON(p)) {
			t.Fatal("non-placeholder profile changed", source)
		}
	}
	for _, base := range []string{"https://fast.aieyra.cn.evil.example/v1", "http://fast.aieyra.cn/v1", "https://another.example/v1"} {
		p := catalogGeminiFixture().APIProfiles[0]
		p.BaseURL = base
		upgradeKnownProfile(&p)
		if p.ToolCalls || p.OutputLimit != 2048 {
			t.Fatal("unverified relay acquired gateway capabilities")
		}
	}
	p := catalogGeminiFixture().APIProfiles[0]
	p.Protocol = ProtocolGoogle
	upgradeKnownProfile(&p)
	if p.ToolCalls {
		t.Fatal("unverified protocol acquired gateway capabilities")
	}
	for _, id := range []string{"unknown", "gemini-3.8-flash-high-extra"} {
		p = catalogGeminiFixture().APIProfiles[0]
		p.Model, p.Parameters = id, rawJSON(map[string]any{"max_tokens": 8192})
		upgradeKnownProfile(&p)
		if p.ToolCalls || p.OutputLimit != 2048 {
			t.Fatal("unknown model fallback incorrect")
		}
		var params map[string]any
		_ = json.Unmarshal(p.Parameters, &params)
		if params["max_tokens"] != float64(2048) {
			t.Fatal("excessive placeholder output was not migrated")
		}
		before := rawJSON(p)
		upgradeKnownProfile(&p)
		if string(before) != string(rawJSON(p)) {
			t.Fatal("migration is not idempotent")
		}
	}
}

func TestCatalogDoesNotClampPriorGPTMigration(t *testing.T) {
	p := APIProfile{Model: "gpt-6-astra", Protocol: ProtocolResponses, ContextWindow: 8192, OutputLimit: 8192, ContextWindowSource: "conservative_client_budget", Parameters: rawJSON(map[string]any{"max_tokens": 8192})}
	upgradeKnownProfile(&p)
	var params map[string]any
	_ = json.Unmarshal(p.Parameters, &params)
	if p.ContextWindow != 1050000 || p.OutputLimit != 128000 || params["max_tokens"] != float64(8192) {
		t.Fatal("prior GPT migration regressed")
	}
}
