// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestInvalidChatToolRetainsFinishUsageAndFailureIdentity
// Impact: python -B scripts/code-atlas.py show Core/chat_tool_failure_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestInvalidChatToolRetainsFinishUsageAndFailureIdentity(t *testing.T) {
	for _, stream := range []bool{true, false} {
		t.Run(fmt.Sprint(stream), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				tool := map[string]any{"index": 0, "id": "unexecuted", "type": "function", "function": map[string]any{"name": "apply_patch", "arguments": `{"patch":"unterminated`}}
				usage := map[string]any{"prompt_tokens": 22946, "completion_tokens": 7309, "prompt_tokens_details": map[string]int{"cached_tokens": 19584}}
				message := map[string]any{"role": "assistant", "tool_calls": []any{tool}}
				choice := map[string]any{"index": 0, "finish_reason": "tool_calls"}
				if stream {
					choice["delta"] = message
					w.Header().Set("Content-Type", "text/event-stream")
					fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", rawJSON(map[string]any{"id": "malformed", "choices": []any{choice}, "usage": usage}))
				} else {
					choice["message"] = message
					_ = json.NewEncoder(w).Encode(map[string]any{"id": "malformed", "choices": []any{choice}, "usage": usage})
				}
			}))
			defer server.Close()
			s := nativeTestSettings(ProtocolChat)
			s.BaseURL, s.Stream = server.URL, boolRef(stream)
			answer, usage, err := completeAgent(context.Background(), New(s), s, []Message{{Role: RoleUser, Content: "fixture"}}, nil)
			if err == nil || len(answer.ToolCalls) != 0 {
				t.Fatal("malformed tool accepted", answer, err)
			}
			if answer.FinishReason != "tool_calls" || usage == nil || usage.CompletionTokens != 7309 {
				t.Fatalf("failure lost observed finish or billed usage: %+v %+v %v", answer, usage, err)
			}
			frame := modelWorkerFrame{}
			frame.setError(err)
			encoded, _ := json.Marshal(frame)
			var decoded modelWorkerFrame
			_ = json.Unmarshal(encoded, &decoded)
			failure := classifyAgentFailure(decoded.decodedError(), server.URL)
			if failure.Code != "invalid_tool_response" || failure.Origin != "upstream" || failure.Retryable {
				t.Fatalf("protocol failure lost across worker: %+v", failure)
			}
		})
	}
}
