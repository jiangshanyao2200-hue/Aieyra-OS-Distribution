// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestAlphaEmptyReasoningWireAndProviderIsolation; TestAlphaStrictThinkingToolRoundTrip
// Impact: python -B scripts/code-atlas.py show Core/chat_reasoning_wire_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestAlphaEmptyReasoningWireAndProviderIsolation(t *testing.T) {
	for _, field := range []string{"reasoning_content", "reasoning_details", ""} {
		t.Run("generic_"+field, func(t *testing.T) {
			s := Defaults()
			s.Adapter, s.ActiveProfile = "openai", "fixture"
			s.APIProfiles = []APIProfile{{ID: "fixture", ReasoningField: field}}
			messages := []Message{
				{Role: RoleUser, Content: "task"},
				{Role: RoleAssistant, Provider: s.ProviderIdentity()},
				{Role: RoleAssistant, Provider: s.ProviderIdentity(), ReasoningContent: "exact current reasoning"},
				{Role: RoleAssistant, Provider: "different-model", ReasoningContent: "foreign private reasoning"},
				{Role: RoleTool, ToolCallID: "call", Content: "result"},
			}
			before := append([]Message(nil), messages...)
			req := BuildRequest(s, messages, true)
			// Marshaling must use the immutable request snapshot after settings change.
			s.APIProfiles[0].ReasoningField = "changed"
			raw, err := json.Marshal(req)
			if err != nil {
				t.Fatal(err)
			}
			var wire struct{ Messages []map[string]any }
			if err := json.Unmarshal(raw, &wire); err != nil {
				t.Fatal(err)
			}
			for i, m := range wire.Messages {
				value, exists := m["reasoning_content"]
				want := field == "reasoning_content" && i >= 1 && i <= 3
				if exists != want {
					t.Fatalf("message %d: field exists %v, want %v: %s", i, exists, want, raw)
				}
				if want && value != map[int]string{1: "", 2: "exact current reasoning", 3: ""}[i] {
					t.Fatalf("reasoning was lost, invented or leaked: %s", raw)
				}
			}
			if !reflect.DeepEqual(messages, before) {
				t.Fatal("wire conversion modified stored messages")
			}
		})
	}
}

// The first tool reply has no thinking delta. A strict thinking route still
// requires the empty key on the next request; later nonempty reasoning is exact.
func TestAlphaStrictThinkingToolRoundTrip(t *testing.T) {
	for _, generic := range []bool{false, true} {
		t.Run(fmt.Sprintf("generic_%v", generic), func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				var body struct{ Messages []map[string]any }
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				for _, m := range body.Messages {
					if m["role"] != RoleAssistant {
						continue
					}
					value, exists := m["reasoning_content"]
					if !exists {
						http.Error(w, `{"error":{"message":"reasoning_content must be passed back"}}`, 400)
						return
					}
					if value != "" && value != "exact-reasoning" {
						t.Errorf("changed reasoning: %v", value)
					}
				}
				w.Header().Set("Content-Type", "text/event-stream")
				if calls == 2 {
					io.WriteString(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"exact-reasoning\"}}]}\n\n")
				}
				if calls <= 2 {
					fmt.Fprintf(w, "data: {\"id\":\"reply-%d\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-%d\",\"type\":\"function\",\"function\":{\"name\":\"fixture\",\"arguments\":\"{}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n", calls, calls)
				} else {
					io.WriteString(w, "data: {\"id\":\"done\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"verified\"},\"finish_reason\":\"stop\"}]}\n\n")
				}
				io.WriteString(w, "data: [DONE]\n\n")
			}))
			defer server.Close()
			s := Defaults()
			s.BaseURL, s.APIKey, s.APIProtocol, s.ThinkingType = server.URL, "fixture", ProtocolChat, "enabled"
			if generic {
				s.Adapter, s.ActiveProfile = "openai", "fixture"
				s.APIProfiles = []APIProfile{{ID: "fixture", ReasoningField: "reasoning_content"}}
			}
			messages := []Message{{Role: RoleUser, Content: "two tool steps"}}
			for turn := 0; turn < 3; turn++ {
				var answer *Message
				for event := range New(s).StreamChatTools(context.Background(), s, messages, nil) {
					if event.Kind == EventError {
						t.Fatal(event.Err)
					}
					if event.Kind == EventResponse {
						answer = event.Message
					}
				}
				if answer == nil {
					t.Fatal("no complete response")
				}
				answer.Provider = s.ProviderIdentity()
				messages = append(messages, *answer)
				for _, call := range answer.ToolCalls {
					messages = append(messages, Message{Role: RoleTool, ToolCallID: call.ID, Content: "verified result"})
				}
				if turn == 2 && answer.Content != "verified" {
					t.Fatal("incomplete round trip")
				}
			}
			if calls != 3 {
				t.Fatalf("unexpected retry/replay: %d", calls)
			}
		})
	}
}
