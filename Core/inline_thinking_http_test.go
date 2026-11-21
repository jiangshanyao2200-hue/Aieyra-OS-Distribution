// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestInlineThinkingPublicClients
// Impact: python -B scripts/code-atlas.py show Core/inline_thinking_http_test.go
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

// Exercise the public clients over HTTP, including the plain Chat entry and
// native continuation payloads. Fixtures never contact a model provider.
func TestInlineThinkingPublicClients(t *testing.T) {
	const content = "<think>分析中文🙂</think>\n你好 Ryo"
	chunks := []string{"<thi", "nk>分析中文🙂", "</th", "ink>\n你好 Ryo"}
	for _, protocol := range []string{ProtocolChat, ProtocolResponses, ProtocolGoogle, ProtocolMessages} {
		for _, mode := range []string{"stream", "events", "complete"} {
			t.Run(protocol+"/"+mode, func(t *testing.T) {
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					stream := mode == "stream"
					w.Header().Set("Content-Type", "application/json")
					if stream {
						w.Header().Set("Content-Type", "text/event-stream")
					}
					frame := func(v any) { fmt.Fprint(w, responseFrame(v)) }
					switch protocol {
					case ProtocolChat:
						if !stream {
							_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": Message{Role: RoleAssistant, Content: content}, "finish_reason": "stop"}}, "usage": map[string]int{"prompt_tokens": 10, "completion_tokens": 5}})
							return
						}
						for _, text := range chunks {
							frame(map[string]any{"id": "chat_fixture", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"content": text}}}})
						}
						frame(map[string]any{"id": "chat_fixture", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{}, "finish_reason": "stop"}}, "usage": map[string]int{"prompt_tokens": 10, "completion_tokens": 5}})
						fmt.Fprint(w, "data: [DONE]\n\n")
					case ProtocolResponses:
						if !stream {
							_ = json.NewEncoder(w).Encode(map[string]any{"id": "resp_test", "status": "completed", "output": []any{responseTextItem(content)}, "usage": map[string]int{"input_tokens": 10, "output_tokens": 5}})
							return
						}
						frame(map[string]any{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"id": "item_text", "type": "message", "content": []any{}}})
						for _, text := range chunks {
							frame(map[string]any{"type": "response.output_text.delta", "output_index": 0, "item_id": "item_text", "delta": text})
						}
						fmt.Fprint(w, terminalFrame("completed", responseTextItem(content)))
					case ProtocolGoogle:
						texts := []string{content}
						if stream {
							texts = chunks
						}
						for i, text := range texts {
							candidate := map[string]any{"content": map[string]any{"parts": []any{map[string]any{"text": text, "thoughtSignature": "opaque-signature"}}}}
							if i == len(texts)-1 {
								candidate["finishReason"] = "STOP"
							}
							env := map[string]any{"responseId": "google_fixture", "candidates": []any{candidate}, "usageMetadata": map[string]int{"promptTokenCount": 10, "candidatesTokenCount": 5}}
							if stream {
								frame(env)
							} else {
								_ = json.NewEncoder(w).Encode(env)
							}
						}
					case ProtocolMessages:
						if !stream {
							_ = json.NewEncoder(w).Encode(map[string]any{"id": "msg_fixture", "stop_reason": "end_turn", "content": []any{map[string]any{"type": "text", "text": content}}, "usage": map[string]int{"input_tokens": 10, "output_tokens": 5}})
							return
						}
						frame(map[string]any{"type": "message_start", "message": map[string]any{"id": "msg_fixture", "usage": map[string]int{"input_tokens": 10}}})
						frame(map[string]any{"type": "content_block_start", "index": 0, "content_block": map[string]any{"type": "text", "text": ""}})
						for _, text := range chunks {
							frame(map[string]any{"type": "content_block_delta", "index": 0, "delta": map[string]any{"type": "text_delta", "text": text}})
						}
						frame(map[string]any{"type": "content_block_stop", "index": 0})
						frame(map[string]any{"type": "message_delta", "delta": map[string]any{"stop_reason": "end_turn"}, "usage": map[string]int{"output_tokens": 5}})
						frame(map[string]any{"type": "message_stop"})
					}
				}))
				defer server.Close()
				s := nativeTestSettings(protocol)
				s.BaseURL = server.URL
				stream := mode == "stream"
				s.Stream = &stream
				client := New(s)
				var message *Message
				if mode == "complete" {
					m, usage, err := client.Complete(context.Background(), s, nil)
					if err != nil || usage == nil || usage.TotalTokens == 0 && usage.PromptTokens == 0 {
						t.Fatalf("complete: usage=%+v err=%v", usage, err)
					}
					message = &m
				} else {
					var body, thought strings.Builder
					done := false
					for event := range client.Stream(context.Background(), s, nil) {
						switch event.Kind {
						case EventError:
							t.Fatal(event.Err)
						case EventDelta:
							body.WriteString(event.Text)
						case EventReasoning:
							thought.WriteString(event.Text)
						case EventResponse:
							message = event.Message
						case EventDone:
							done = true
						}
					}
					if body.String() != "你好 Ryo" || thought.String() != "分析中文🙂" || !done {
						t.Fatalf("events: body=%q thought=%q done=%v", body.String(), thought.String(), done)
					}
				}
				if message != nil && (message.Content != "你好 Ryo" || message.ReasoningContent != "分析中文🙂") {
					t.Fatalf("message: %+v", message)
				}
				if protocol == ProtocolGoogle && message != nil && !strings.Contains(string(message.NativeContent), "opaque-signature") {
					t.Fatal("native continuation signature lost")
				}
			})
		}
	}
}
