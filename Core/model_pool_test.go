// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestModelPoolBlocksDisabledMissingAndUnselectedRequests; TestModelPoolAllowsUntestedChatWithoutInventingCapabilityEvidence; TestModelPoolLoadUsesConnectionAndIndependentModelOptions; TestModelPoolReusedClientRejectsNewlyDisabledModel; TestGenericModelOptionsRequestOwnsLearnedArrays; TestLegacyOpenCodeRequestsSummaryWithoutSavingUserConfig; TestGenericModelOptionsMapToNativeProtocols; summaryItem; TestResponsesSummaryStreamsImmediatelyAndReplaysOpaqueReasoning
// Impact: python -B scripts/code-atlas.py show Core/model_pool_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestModelPoolBlocksDisabledMissingAndUnselectedRequests(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1); w.WriteHeader(500) }))
	defer server.Close()
	for _, protocol := range []string{ProtocolChat, ProtocolResponses, ProtocolMessages, ProtocolGoogle} {
		for _, failure := range []string{"disabled", "missing", "different_model"} {
			t.Run(protocol+"/"+failure, func(t *testing.T) {
				s := Defaults()
				s.Adapter = "openai"
				s.Model = "pool-model"
				s.BaseURL = server.URL
				s.APIProtocol = protocol
				s.APIKey = "fake"
				s.ModelContextWindow = 128000
				s.ModelPoolVersion = 1
				s.ActiveProfile = "pool-entry"
				enabled := failure != "disabled"
				s.APIProfiles = []APIProfile{{ID: "pool-entry", ConnectionID: "fixture", Model: s.Model, BaseURL: s.BaseURL, Protocol: protocol, Adapter: "openai", Enabled: &enabled, ToolCalls: true, ContextWindow: 128000}}
				s.ProviderConnections = []ProviderConnection{{ID: "fixture", BaseURL: s.BaseURL, APIKey: "fake", RequestTimeout: 30}}
				if failure == "missing" {
					s.APIProfiles = nil
				}
				if failure == "different_model" {
					s.Model = "outside-pool"
				}
				if s.ValidatePoolRequest() == nil {
					t.Fatal("invalid pool selection accepted")
				}
				var gotError bool
				for e := range New(s).Stream(context.Background(), s, []Message{{Role: RoleUser, Content: "test"}}) {
					gotError = gotError || e.Err != nil
				}
				if !gotError {
					t.Fatal("missing request rejection")
				}
			})
		}
	}
	if requests.Load() != 0 {
		t.Fatalf("disabled models reached server: %d", requests.Load())
	}
}

func TestModelPoolAllowsUntestedChatWithoutInventingCapabilityEvidence(t *testing.T) {
	s := Defaults()
	s.Adapter, s.Model, s.BaseURL, s.APIKey = "openai", "unprobed-chat", "http://127.0.0.1:1", "synthetic"
	s.APIProtocol, s.ModelPoolVersion, s.ActiveProfile = ProtocolResponses, 1, "unprobed"
	s.APIProfiles = []APIProfile{{ID: "unprobed", ConnectionID: "fixture", Model: s.Model, BaseURL: s.BaseURL, Protocol: s.Protocol(), Adapter: s.Adapter, ContextWindow: 8192}}
	s.ProviderConnections = []ProviderConnection{{ID: "fixture", BaseURL: s.BaseURL, APIKey: s.APIKey}}
	if err := s.ValidatePoolRequest(); err != nil {
		t.Fatal(err)
	}
	if s.APIProfiles[0].ToolCalls || s.APIProfiles[0].ResponseVerified {
		t.Fatal("untested capability evidence changed")
	}
	for _, kind := range []string{"image", "video"} {
		s.APIProfiles[0].Kind = kind
		if s.ValidatePoolRequest() == nil {
			t.Fatalf("%s model accepted for chat", kind)
		}
	}
}
func TestModelPoolLoadUsesConnectionAndIndependentModelOptions(t *testing.T) {
	s := Defaults()
	s.ModelPoolVersion = 1
	s.ActiveProfile = "muse"
	s.APIKey = "stale-key"
	s.Model = "stale-model"
	enabled := true
	s.APIProfiles = []APIProfile{{ID: "muse", ConnectionID: "opencode-go", Provider: "opencode-go", Model: "muse-spark-1.3-contributor", BaseURL: "https://opencode.ai/zen/go/v1", Protocol: ProtocolResponses, Adapter: "openai", Enabled: &enabled, ToolCalls: true, ContextWindow: 1048576, Parameters: rawJSON(map[string]any{"max_tokens": 4096, "model_options": map[string]any{"reasoning_effort": "low", "reasoning_summary": "auto"}})}}
	s.ProviderConnections = []ProviderConnection{{ID: "opencode-go", BaseURL: s.APIProfiles[0].BaseURL, APIKey: "actual-connection-key", RequestTimeout: 90}}
	file := filepath.Join(t.TempDir(), "config.json")
	b, _ := json.Marshal(s)
	if e := os.WriteFile(file, b, 0600); e != nil {
		t.Fatal(e)
	}
	loaded, e := Load(file)
	if e != nil {
		t.Fatal(e)
	}
	if loaded.APIKey != "actual-connection-key" || loaded.Model != s.APIProfiles[0].Model || loaded.MaxTokens != 4096 || loaded.ModelOptions["reasoning_summary"] != "auto" {
		t.Fatal("pool materialization lost model or connection")
	}
	cp := loaded.Clone()
	cp.ModelOptions["reasoning_summary"] = "detailed"
	cp.ProviderConnections[0].APIKey = "new-key"
	if loaded.ModelOptions["reasoning_summary"] != "auto" || loaded.ProviderConnections[0].APIKey != "actual-connection-key" {
		t.Fatal("clone shared mutable pool state")
	}
}

func TestModelPoolReusedClientRejectsNewlyDisabledModel(t *testing.T) {
	for _, protocol := range []string{ProtocolChat, ProtocolResponses, ProtocolMessages, ProtocolGoogle} {
		t.Run(protocol, func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(500) }))
			defer server.Close()
			s := Defaults()
			s.ModelPoolVersion = 1
			s.Adapter = "openai"
			s.Model = "fixture"
			s.APIProtocol = protocol
			s.BaseURL = server.URL
			s.APIKey = "fake"
			s.ActiveProfile = "p"
			enabled := true
			s.APIProfiles = []APIProfile{{ID: "p", ConnectionID: "c", Model: s.Model, Adapter: s.Adapter, Protocol: protocol, BaseURL: server.URL, Enabled: &enabled, ToolCalls: true}}
			s.ProviderConnections = []ProviderConnection{{ID: "c", BaseURL: server.URL, APIKey: "fake"}}
			client := New(s)
			enabled = false
			if _, _, err := client.Complete(context.Background(), s, nil); err == nil {
				t.Fatal("disabled model accepted by reused client")
			}
			var events <-chan Event
			if protocol == ProtocolChat {
				events = client.StreamChatTools(context.Background(), s, nil, nil)
			} else {
				events = client.Stream(context.Background(), s, nil)
			}
			gotError := false
			for event := range events {
				gotError = gotError || event.Err != nil
			}
			if !gotError || calls.Load() != 0 {
				t.Fatal("disabled model reached HTTP")
			}
		})
	}
}

func TestGenericModelOptionsRequestOwnsLearnedArrays(t *testing.T) {
	s := Defaults()
	s.Adapter = "openai"
	s.APIProtocol = ProtocolChat
	s.Model = "fixture"
	s.ActiveProfile = "fixture"
	s.APIProfiles = []APIProfile{{ID: "fixture", Model: "fixture", Adapter: "openai", Protocol: ProtocolChat, ParameterSpecs: []ParameterSpec{{Key: "vendor_hints", Type: "strings", WirePath: []string{"vendor_hints"}, Source: "https://example.org/api"}}}}
	s.ModelOptions = map[string]any{"vendor_hints": []any{"original"}}
	req := BuildRequest(s, nil, true)
	s.ModelOptions["vendor_hints"].([]any)[0] = "changed"
	b, err := json.Marshal(req)
	if err != nil || !strings.Contains(string(b), `"vendor_hints":["original"]`) {
		t.Fatal("request shares mutable settings")
	}
}

func TestLegacyOpenCodeRequestsSummaryWithoutSavingUserConfig(t *testing.T) {
	s := Defaults()
	s.Adapter = "openai"
	s.BaseURL = "https://opencode.ai/zen/go/v1"
	s.Model = "muse-spark-1.3-contributor"
	b, err := json.Marshal(BuildResponsesRequest(s, nil, true, nil))
	if err != nil || !strings.Contains(string(b), `"summary":"auto"`) {
		t.Fatal("legacy OpenCode summary request compatibility was lost")
	}
	s.ModelPoolVersion = 1
	b, _ = json.Marshal(BuildResponsesRequest(s, nil, true, nil))
	if strings.Contains(string(b), `"summary"`) {
		t.Fatal("explicit provider-default selection was overridden")
	}
	for _, tc := range []struct {
		name, base, protocol, explicit, want string
		version                              int
	}{
		{name: "legacy_explicit", base: s.BaseURL, protocol: ProtocolResponses, explicit: "concise", want: "concise"},
		{name: "v1_explicit", base: s.BaseURL, protocol: ProtocolResponses, explicit: "detailed", want: "detailed", version: 1},
		{name: "other_provider", base: "https://relay.example/v1", protocol: ProtocolResponses},
		{name: "similar_host", base: "https://opencode.ai.relay.example/v1", protocol: ProtocolResponses},
		{name: "chat", base: s.BaseURL, protocol: ProtocolChat},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := Defaults()
			s.Adapter, s.BaseURL, s.APIProtocol, s.ModelPoolVersion = "openai", tc.base, tc.protocol, tc.version
			s.ModelOptions = map[string]any{"reasoning_effort": "high"}
			if tc.explicit != "" {
				s.ModelOptions["reasoning_summary"] = tc.explicit
			}
			before, _ := json.Marshal(s)
			var request any = BuildRequest(s, nil, true)
			if tc.protocol == ProtocolResponses {
				request = BuildResponsesRequest(s, nil, true, nil)
			}
			raw, err := json.Marshal(request)
			if err != nil {
				t.Fatal(err)
			}
			var body struct {
				Reasoning struct {
					Summary string `json:"summary"`
				} `json:"reasoning"`
			}
			if err = json.Unmarshal(raw, &body); err != nil || body.Reasoning.Summary != tc.want {
				t.Fatal("summary request differs from version, protocol or explicit selection")
			}
			after, _ := json.Marshal(s)
			if string(before) != string(after) {
				t.Fatal("request building modified saved settings")
			}
		})
	}
}
func TestGenericModelOptionsMapToNativeProtocols(t *testing.T) {
	for _, protocol := range []string{ProtocolChat, ProtocolResponses, ProtocolMessages, ProtocolGoogle} {
		t.Run(protocol, func(t *testing.T) {
			s := Defaults()
			s.Adapter = "openai"
			s.Model = "fixture"
			s.APIProtocol = protocol
			s.BaseURL = "https://openrouter.ai/api/v1"
			s.ModelOptions = map[string]any{"temperature": float64(0), "top_p": .7, "reasoning_effort": "low"}
			var request any
			switch protocol {
			case ProtocolChat:
				s.ModelOptions["frequency_penalty"] = .5
				request = BuildRequest(s, nil, true)
			case ProtocolResponses:
				s.ModelOptions["reasoning_summary"] = "auto"
				request = BuildResponsesRequest(s, nil, true, nil)
			default:
				request = BuildNativeRequest(s, nil, true, nil)
			}
			b, e := json.Marshal(request)
			if e != nil {
				t.Fatal(e)
			}
			var body map[string]any
			_ = json.Unmarshal(b, &body)
			switch protocol {
			case ProtocolChat:
				if body["temperature"] != nil || body["top_p"] != nil || body["frequency_penalty"] != nil || body["reasoning"].(map[string]any)["effort"] != "low" {
					t.Fatal(string(b))
				}
			case ProtocolResponses:
				if body["reasoning"].(map[string]any)["summary"] != "auto" || body["temperature"] != nil || body["top_p"] != nil {
					t.Fatal(string(b))
				}
			case ProtocolMessages:
				if body["thinking"].(map[string]any)["type"] != "adaptive" || body["output_config"].(map[string]any)["effort"] != "low" {
					t.Fatal(string(b))
				}
			case ProtocolGoogle:
				g := body["generationConfig"].(map[string]any)
				if g["temperature"] != nil || g["topP"] != nil || g["thinkingConfig"].(map[string]any)["thinkingLevel"] != "LOW" {
					t.Fatal(string(b))
				}
			}
		})
	}
	ds := Defaults()
	ds.ModelOptions = map[string]any{"frequency_penalty": 1, "reasoning_summary": "auto"}
	b, _ := json.Marshal(BuildRequest(ds, nil, true))
	if strings.Contains(string(b), "frequency_penalty") || strings.Contains(string(b), "summary") {
		t.Fatal("generic options contaminated DeepSeek")
	}
}
func summaryItem(text string) json.RawMessage {
	return rawJSON(map[string]any{"type": "reasoning", "id": "reasoning-1", "summary": []any{map[string]any{"type": "summary_text", "text": text}}, "encrypted_content": "opaque-signature"})
}
func TestResponsesSummaryStreamsImmediatelyAndReplaysOpaqueReasoning(t *testing.T) {
	part := func(kind, delta, text string) string {
		return responseFrame(map[string]any{"type": kind, "output_index": 0, "item_id": "reasoning-1", "summary_index": 0, "delta": delta, "text": text})
	}
	prefix := responseFrame(map[string]any{"type": "response.output_item.added", "output_index": 0, "item": rawJSON(map[string]any{"id": "reasoning-1", "type": "reasoning", "summary": []any{}})})
	prefix += part("response.reasoning_summary_text.delta", "Check the boundary.", "")
	// 正文先到，思考摘要的 done 还未到；必须立即让正文接管，不等摘要结束。
	prefix += responseFrame(map[string]any{"type": "response.output_item.added", "output_index": 1, "item": responseTextItem("")})
	prefix += responseFrame(map[string]any{"type": "response.output_text.delta", "output_index": 1, "item_id": "item_text", "delta": "Answer"})
	stream := prefix + part("response.reasoning_summary_text.done", "", "Check the boundary.") + responseFrame(map[string]any{"type": "response.output_item.done", "output_index": 0, "item": summaryItem("Check the boundary.")}) + terminalFrame("completed", summaryItem("Check the boundary."), responseTextItem("Answer"))
	events, e := parseResponseFixture(stream)
	if e != nil {
		t.Fatal(e)
	}
	thought, body := "", ""
	bodyBeforeDone := false
	doneSeen := false
	var message *Message
	for _, e := range events {
		switch e.Kind {
		case EventReasoning:
			thought += e.Text
		case EventReasoningDone:
			doneSeen = true
		case EventDelta:
			body += e.Text
			bodyBeforeDone = bodyBeforeDone || !doneSeen
		case EventResponse:
			message = e.Message
		}
	}
	if thought != "Check the boundary." || body != "Answer" || !bodyBeforeDone || message == nil || message.ReasoningContent != thought {
		t.Fatalf("thought=%q body=%q immediate=%v", thought, body, bodyBeforeDone)
	}
	s := Defaults()
	s.Adapter = "openai"
	s.Model = "muse"
	s.BaseURL = "https://opencode.ai/zen/go/v1"
	message.Provider = s.ProviderIdentity()
	request := BuildResponsesRequest(s, []Message{*message}, true, nil)
	b, _ := json.Marshal(request)
	if !strings.Contains(string(b), "opaque-signature") {
		t.Fatal("lost original reasoning replay")
	}
	s.Model = "another-model"
	b, _ = json.Marshal(BuildResponsesRequest(s, []Message{*message}, true, nil))
	if strings.Contains(string(b), "opaque-signature") {
		t.Fatal("cross-model signature replay")
	}
	env := responseEnvelope{ID: "r", Status: "completed", Output: []json.RawMessage{summaryItem("Nonstream summary"), responseTextItem("Answer")}}
	m, e := env.message()
	if e != nil || m.ReasoningContent != "Nonstream summary" {
		t.Fatal("nonstream summary lost", e)
	}
	for _, bad := range []string{prefix} {
		events, e := parseResponseFixture(bad)
		if e == nil {
			t.Fatal("invalid summary stream accepted")
		}
		for _, e := range events {
			if e.Kind == EventResponse && len(e.Message.ToolCalls) > 0 {
				t.Fatal("invalid summary authorized tools")
			}
		}
	}
}
