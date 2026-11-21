// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestGoogleEmptyTextToolRoundTrip; TestGoogleLegacyEmptyTextReplayPreservesOpaqueParts
// Impact: python -B scripts/code-atlas.py show Core/provider_google_empty_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The gateway terminates a tool stream with an empty text part. Replaying it
// makes Google reject the next request's Part.data oneof before reading tools.
func TestGoogleEmptyTextToolRoundTrip(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprint(stream), func(t *testing.T) {
			count := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				count++
				var body struct {
					Contents []struct {
						Role  string           `json:"role"`
						Parts []map[string]any `json:"parts"`
					} `json:"contents"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				if count == 2 {
					foundSignature, foundResult := false, false
					for _, turn := range body.Contents {
						for _, p := range turn.Parts {
							if text, ok := p["text"].(string); ok && text == "" {
								http.Error(w, "Part.data is empty", http.StatusBadRequest)
								return
							}
							foundSignature = foundSignature || p["thoughtSignature"] == "opaque-fixture-signature"
							if fr, ok := p["functionResponse"].(map[string]any); ok {
								foundResult = fr["name"] == "g1_sum" && fr["id"] == "call_fixture" && fr["response"].(map[string]any)["output"] == "42"
							}
						}
					}
					if !foundSignature || !foundResult {
						t.Errorf("signature or tool result lost: %s", rawJSON(body))
					}
				}
				parts := []any{map[string]any{"text": "42"}}
				if count == 1 {
					parts = []any{
						map[string]any{"thought": true, "text": ""},
						map[string]any{"thoughtSignature": "opaque-fixture-signature", "functionCall": map[string]any{"id": "call_fixture", "name": "g1_sum", "args": map[string]any{"a": 17, "b": 25}}},
						map[string]any{"text": ""},
					}
				}
				env := map[string]any{"responseId": fmt.Sprint("g", count), "candidates": []any{map[string]any{"finishReason": "STOP", "content": map[string]any{"parts": parts}}}}
				if stream {
					fmt.Fprint(w, nativeSSE(env))
				} else {
					fmt.Fprint(w, string(rawJSON(env)))
				}
			}))
			defer server.Close()
			s := nativeTestSettings(ProtocolGoogle)
			s.BaseURL = server.URL
			s.SetStream(stream)
			client := New(s)
			history := []Message{{Role: RoleUser, Content: "17 + 25"}}
			for turn := 0; turn < 2; turn++ {
				var response *Message
				for e := range client.StreamNative(context.Background(), s, history, nil) {
					if e.Err != nil {
						t.Fatal(e.Err)
					}
					if e.Kind == EventResponse {
						response = e.Message
					}
				}
				if response == nil {
					t.Fatal("missing completed response")
				}
				if turn == 0 {
					if len(response.ToolCalls) != 1 || response.ToolCalls[0].Function.Arguments != `{"a":17,"b":25}` {
						t.Fatalf("tool changed: %+v", response)
					}
					if strings.Contains(string(response.NativeContent), `"text":""`) {
						t.Fatal("empty stream markers persisted in assistant history")
					}
					history = append(history, *response, Message{Role: RoleTool, ToolCallID: response.ToolCalls[0].ID, Content: "42"})
				} else if response.Content != "42" {
					t.Fatal(response.Content)
				}
			}
			if count != 2 {
				t.Fatalf("unexpected retry count: %d", count)
			}
		})
	}
}

func TestGoogleLegacyEmptyTextReplayPreservesOpaqueParts(t *testing.T) {
	s := nativeTestSettings(ProtocolGoogle)
	stored := Message{Role: RoleAssistant, Provider: s.ProviderIdentity(), NativeContent: json.RawMessage(`[{"text":"","thought":true},{"text":"","thoughtSignature":"signed-empty"},{"inlineData":{"mimeType":"image/png","data":"opaque-image"}},{"functionCall":{"name":"g1_sum","args":{}},"thoughtSignature":"signed-tool"},{"text":""}]`)}
	body := BuildNativeRequest(s, []Message{stored}, true, nil)
	turns := body["contents"].([]any)
	parts := turns[0].(map[string]any)["parts"].([]any)
	if len(parts) != 3 {
		t.Fatalf("legacy empty markers replayed or opaque parts dropped: %s", rawJSON(body))
	}
	if parts[0].(map[string]any)["thoughtSignature"] != "signed-empty" || parts[1].(map[string]any)["inlineData"] == nil || parts[2].(map[string]any)["thoughtSignature"] != "signed-tool" {
		t.Fatal("opaque payload/signature changed")
	}
	var original []any
	if err := json.Unmarshal(stored.NativeContent, &original); err != nil || len(original) != 5 {
		t.Fatal("stored history mutated")
	}
}
