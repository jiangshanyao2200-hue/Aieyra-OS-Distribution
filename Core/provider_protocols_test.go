// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: nativeTestSettings; nativeSSE; anthropicToolEvents; TestAnthropicToolStreamAndSignatureReplay; TestAnthropicRejectsTruncationAndInvalidTools; TestGoogleToolStreamAndThoughtSignature; TestNativeHTTPToolRoundTrip; TestOpenRouterReasoningReplayAndIsolation; TestNativeCredentialArchiveDropsOpaqueCopies; TestProviderHeadersStableSessionAndNoCrossOriginLeak; TestAnthropicRejectsInvalidBlockIdentity; TestNativeRuntimeManualStaysAtRequestTail
// Impact: python -B scripts/code-atlas.py show Core/provider_protocols_test.go
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

func nativeTestSettings(protocol string) *Settings {
	s := Defaults()
	s.Adapter = "openai"
	s.APIProtocol = protocol
	s.Model = "test-coder"
	s.ModelContextWindow = 128000
	s.APIKey = "sk-native-fixture"
	return s
}
func nativeSSE(events ...any) string {
	var b strings.Builder
	for _, e := range events {
		fmt.Fprintf(&b, "data: %s\n\n", rawJSON(e))
	}
	return b.String()
}
func anthropicToolEvents() []any {
	return []any{
		map[string]any{"type": "message_start", "message": map[string]any{"id": "msg_test", "usage": map[string]any{"input_tokens": 10, "cache_read_input_tokens": 20}}},
		map[string]any{"type": "content_block_start", "index": 0, "content_block": map[string]any{"type": "thinking", "thinking": "", "signature": ""}},
		map[string]any{"type": "content_block_delta", "index": 0, "delta": map[string]any{"type": "thinking_delta", "thinking": "inspect"}},
		map[string]any{"type": "content_block_delta", "index": 0, "delta": map[string]any{"type": "signature_delta", "signature": "opaque-signature"}},
		map[string]any{"type": "content_block_stop", "index": 0},
		map[string]any{"type": "content_block_start", "index": 1, "content_block": map[string]any{"type": "tool_use", "id": "call_test", "name": "exec_command", "input": map[string]any{}}},
		map[string]any{"type": "content_block_delta", "index": 1, "delta": map[string]any{"type": "input_json_delta", "partial_json": "{\"cmd\":"}},
		map[string]any{"type": "content_block_delta", "index": 1, "delta": map[string]any{"type": "input_json_delta", "partial_json": "\"pwd\"}"}},
		map[string]any{"type": "content_block_stop", "index": 1},
		map[string]any{"type": "message_delta", "delta": map[string]any{"stop_reason": "tool_use"}, "usage": map[string]any{"output_tokens": 12}},
		map[string]any{"type": "message_stop"},
	}
}
func TestAnthropicToolStreamAndSignatureReplay(t *testing.T) {
	var events []Event
	m, u, err := readAnthropic(strings.NewReader(nativeSSE(anthropicToolEvents()...)), func(e Event) error { events = append(events, e); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if len(m.ToolCalls) != 1 || m.ToolCalls[0].Function.Arguments != "{\"cmd\":\"pwd\"}" || m.ReasoningContent != "inspect" || u.PromptTokens != 30 || u.CompletionTokens != 12 {
		t.Fatalf("unexpected message/usage: %+v %+v", m, u)
	}
	s := nativeTestSettings(ProtocolMessages)
	m.Provider = s.ProviderIdentity()
	body := BuildNativeRequest(s, []Message{{Role: RoleUser, Content: "inspect"}, m, {Role: RoleTool, ToolCallID: "call_test", Content: "workspace"}}, true, nil)
	data := string(rawJSON(body))
	if !strings.Contains(data, "opaque-signature") || !strings.Contains(data, "tool_result") || strings.Contains(data, "reasoning_content") {
		t.Fatal(data)
	}
	s.BaseURL = "https://another.invalid"
	data = string(rawJSON(BuildNativeRequest(s, []Message{m}, true, nil)))
	if strings.Contains(data, "opaque-signature") {
		t.Fatal("cross-provider signature leaked")
	}
	found := false
	for _, e := range events {
		if e.Kind == EventReasoningDone {
			found = true
		}
		if e.Kind == EventResponse {
			t.Fatal("parser published executable response early")
		}
	}
	if !found {
		t.Fatal("missing thought end")
	}
	// 当上游网关返回的 tool_use 缺失 id 时，chatIdentity 补全的 ID 必须同步回写到 NativeContent，避免次轮重放报 400。
	noIDPayload := rawJSON(map[string]any{
		"id":          "msg_noid",
		"stop_reason": "tool_use",
		"content": []any{
			map[string]any{"type": "tool_use", "id": "", "name": "terminal", "input": map[string]any{"action": "exec"}},
		},
	})
	parsed, _, err := parseAnthropic(noIDPayload, nil)
	if err != nil || len(parsed.ToolCalls) != 1 || parsed.ToolCalls[0].ID == "" {
		t.Fatalf("expected synthesized tool call ID: %+v err=%v", parsed, err)
	}
	sReplay := nativeTestSettings(ProtocolMessages)
	parsed.Provider = sReplay.ProviderIdentity()
	replayed := string(rawJSON(BuildNativeRequest(sReplay, []Message{{Role: RoleUser, Content: "hi"}, parsed, {Role: RoleTool, ToolCallID: parsed.ToolCalls[0].ID, Content: "ok"}}, true, nil)))
	if !strings.Contains(replayed, `"id":"`+parsed.ToolCalls[0].ID+`"`) {
		t.Fatalf("NativeContent did not backfill synthesized tool_use.id: %s", replayed)
	}
}
func TestAnthropicRejectsTruncationAndInvalidTools(t *testing.T) {
	all := anthropicToolEvents()
	for n := 0; n < len(all); n++ {
		if _, _, err := readAnthropic(strings.NewReader(nativeSSE(all[:n]...)), func(Event) error { return nil }); err == nil {
			t.Fatalf("accepted prefix %d", n)
		}
	}
	cases := [][]any{append(append([]any{}, all...), all[0]), append(append([]any{}, all[:8]...), all[9:]...)}
	for _, events := range cases {
		if _, _, err := readAnthropic(strings.NewReader(nativeSSE(events...)), func(Event) error { return nil }); err == nil {
			t.Fatal("accepted invalid order")
		}
	}
	for _, finish := range []string{"max_tokens", "pause_turn", ""} {
		data := rawJSON(map[string]any{"id": "x", "stop_reason": finish, "content": []any{map[string]any{"type": "tool_use", "id": "c", "name": "run", "input": map[string]any{}}}})
		message, _, err := parseAnthropic(data, nil)
		if finish == "max_tokens" {
			if err != nil || message.FinishReason != "length" || len(message.ToolCalls) != 0 || len(message.IncompleteTools) != 1 {
				t.Fatalf("truncated tool must be retained only for audit: %+v, %v", message, err)
			}
		} else if err == nil {
			t.Fatalf("accepted tools at %s", finish)
		}
	}
}
func TestGoogleToolStreamAndThoughtSignature(t *testing.T) {
	first := map[string]any{"responseId": "g1", "candidates": []any{map[string]any{"content": map[string]any{"parts": []any{map[string]any{"text": "inspect", "thought": true}}}}}}
	last := map[string]any{"responseId": "g1", "candidates": []any{map[string]any{"finishReason": "STOP", "content": map[string]any{"parts": []any{map[string]any{"thoughtSignature": "google-signature", "functionCall": map[string]any{"name": "exec_command", "args": map[string]any{"cmd": "pwd"}}}}}}}, "usageMetadata": map[string]any{"promptTokenCount": 20, "candidatesTokenCount": 5, "thoughtsTokenCount": 3}}
	m, u, err := readGoogle(strings.NewReader(nativeSSE(first, last)), func(Event) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if len(m.ToolCalls) != 1 || u.CompletionTokens != 8 {
		t.Fatal("missing tools/usage")
	}
	s := nativeTestSettings(ProtocolGoogle)
	m.Provider = s.ProviderIdentity()
	body := BuildNativeRequest(s, []Message{m, {Role: RoleTool, ToolCallID: m.ToolCalls[0].ID, Content: "workspace"}}, true, nil)
	data := string(rawJSON(body))
	if !strings.Contains(data, "google-signature") || !strings.Contains(data, "functionResponse") || !strings.Contains(data, "exec_command") {
		t.Fatal(data)
	}
	if _, _, err = readGoogle(strings.NewReader(nativeSSE(first)), func(Event) error { return nil }); err == nil {
		t.Fatal("accepted truncated Google stream")
	}
	last["responseId"] = "g2"
	if _, _, err = readGoogle(strings.NewReader(nativeSSE(first, last)), func(Event) error { return nil }); err == nil {
		t.Fatal("accepted mismatching identity")
	}
}
func TestNativeHTTPToolRoundTrip(t *testing.T) {
	for _, protocol := range []string{ProtocolMessages, ProtocolGoogle} {
		for _, stream := range []bool{false, true} {
			t.Run(protocol+fmt.Sprint(stream), func(t *testing.T) {
				count := 0
				s := nativeTestSettings(protocol)
				s.SetStream(stream)
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					count++
					var b map[string]any
					if json.NewDecoder(r.Body).Decode(&b) != nil {
						t.Error("bad request")
					}
					if !strings.HasPrefix(r.Header.Get("User-Agent"), "AieyraOS/") {
						t.Error("missing user agent")
					}
					if protocol == ProtocolMessages {
						if r.URL.Path != "/messages" || r.Header.Get("x-api-key") != s.APIKey || r.Header.Get("anthropic-version") != "2023-06-01" {
							t.Error("incorrect auth/endpoint")
						}
						if count == 1 {
							if stream {
								fmt.Fprint(w, nativeSSE(anthropicToolEvents()...))
							} else {
								fmt.Fprint(w, `{"id":"m1","stop_reason":"tool_use","content":[{"type":"tool_use","id":"call_test","name":"exec_command","input":{"cmd":"pwd"}}]}`)
							}
						} else {
							if !strings.Contains(string(rawJSON(b)), "tool_result") {
								t.Error("missing tool output")
							}
							if stream {
								fmt.Fprint(w, nativeSSE(map[string]any{"type": "message_start", "message": map[string]any{"id": "m2"}}, map[string]any{"type": "content_block_start", "index": 0, "content_block": map[string]any{"type": "text", "text": "DONE"}}, map[string]any{"type": "content_block_stop", "index": 0}, map[string]any{"type": "message_delta", "delta": map[string]any{"stop_reason": "end_turn"}}, map[string]any{"type": "message_stop"}))
							} else {
								fmt.Fprint(w, `{"id":"m2","stop_reason":"end_turn","content":[{"type":"text","text":"DONE"}]}`)
							}
						}
					} else {
						if !strings.HasPrefix(r.URL.Path, "/models/test-coder:") || r.Header.Get("x-goog-api-key") != s.APIKey {
							t.Error("wrong Google endpoint/auth")
						}
						part := map[string]any{"text": "DONE"}
						if count == 1 {
							part = map[string]any{"functionCall": map[string]any{"name": "exec_command", "args": map[string]any{"cmd": "pwd"}}}
						} else if !strings.Contains(string(rawJSON(b)), "functionResponse") {
							t.Error("missing Google tool response")
						}
						env := map[string]any{"responseId": fmt.Sprint("g", count), "candidates": []any{map[string]any{"finishReason": "STOP", "content": map[string]any{"parts": []any{part}}}}}
						if stream {
							fmt.Fprint(w, nativeSSE(env))
						} else {
							fmt.Fprint(w, string(rawJSON(env)))
						}
					}
				}))
				defer server.Close()
				s.BaseURL = server.URL
				client := New(s)
				history := []Message{{Role: RoleUser, Content: "inspect"}}
				tools := []ToolDefinition{{Name: "exec_command", Parameters: rawJSON(map[string]any{"type": "object"})}}
				for turn := 0; turn < 2; turn++ {
					var m *Message
					for e := range client.StreamNative(context.Background(), s, history, tools) {
						if e.Err != nil {
							t.Fatal(e.Err)
						}
						if e.Kind == EventResponse {
							m = e.Message
						}
					}
					if m == nil {
						t.Fatal("missing complete response")
					}
					if turn == 0 {
						if len(m.ToolCalls) != 1 {
							t.Fatal("missing tool call")
						}
						history = append(history, *m, Message{Role: RoleTool, ToolCallID: m.ToolCalls[0].ID, Content: "workspace"})
					} else if m.Content != "DONE" {
						t.Fatal(m.Content)
					}
				}
			})
		}
	}
}
func TestOpenRouterReasoningReplayAndIsolation(t *testing.T) {
	stream := `data: {"id":"r1","choices":[{"index":0,"delta":{"reasoning":"inspect","reasoning_details":[{"type":"reasoning.encrypted","index":0,"id":"sig","data":"abc"}]}}]}` + "\n\n" + `data: {"id":"r1","choices":[{"index":0,"delta":{"reasoning_details":[{"type":"reasoning.encrypted","index":0,"id":"sig","data":"def"}],"content":"done"},"finish_reason":"stop"}]}` + "\n\ndata: [DONE]\n\n"
	var m Message
	if err := readChatTools(strings.NewReader(stream), func(e Event) error {
		if e.Message != nil {
			m = *e.Message
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if m.ReasoningContent != "inspect" || !strings.Contains(string(m.ReasoningDetails), "abcdef") {
		t.Fatal("signature lost")
	}
	s := nativeTestSettings(ProtocolChat)
	s.BaseURL = "https://openrouter.ai/api/v1"
	m.Provider = s.ProviderIdentity()
	body := string(rawJSON(BuildRequest(s, []Message{m}, true)))
	if !strings.Contains(body, "reasoning_details") || strings.Contains(body, "provider_identity") || strings.Contains(body, "reasoning_content") || !strings.Contains(body, "require_parameters") {
		t.Fatal(body)
	}
	s.Model = "other"
	if strings.Contains(string(rawJSON(BuildRequest(s, []Message{m}, true))), "abcdef") {
		t.Fatal("signature leaked across models")
	}
}

func TestNativeCredentialArchiveDropsOpaqueCopies(t *testing.T) {
	call := ToolCall{ID: "call", Type: "function", Function: FunctionCall{Name: "toolbox", Arguments: `{"action":"call","name":"settings","arguments":{"action":"probe","api_key":"sk-sensitive-fixture"}}`}}
	m := archiveToolMessage(Message{ToolCalls: []ToolCall{call}, NativeContent: json.RawMessage(`["sk-sensitive-fixture"]`), ReasoningDetails: json.RawMessage(`["sk-sensitive-fixture"]`)})
	if strings.Contains(string(rawJSON(m)), "sk-sensitive-fixture") {
		t.Fatal("credential copied through native protocol archive")
	}
}
func TestProviderHeadersStableSessionAndNoCrossOriginLeak(t *testing.T) {
	s := nativeTestSettings(ProtocolChat)
	s.BaseURL = "https://opencode.ai/zen/go/v1"
	c := New(s)
	ctx := WithProviderSession(context.Background(), "session-test")
	r, _ := http.NewRequestWithContext(ctx, "POST", s.BaseURL+"/chat/completions", nil)
	c.providerHeaders(r)
	if r.Header.Get("x-opencode-session") != "session-test" {
		t.Fatal("missing stable session")
	}
	r, _ = http.NewRequestWithContext(ctx, "POST", "https://another.invalid/chat/completions", nil)
	c.providerHeaders(r)
	if r.Header.Get("x-opencode-session") != "" {
		t.Fatal("session leaked to unrelated origin")
	}
}

func TestAnthropicRejectsInvalidBlockIdentity(t *testing.T) {
	for _, index := range []any{nil, "0", 0.5, -1} {
		events := anthropicToolEvents()
		block := map[string]any{"type": "content_block_start", "index": index, "content_block": map[string]any{"type": "tool_use", "id": "c", "name": "run", "input": map[string]any{}}}
		events[1] = block
		if _, _, err := readAnthropic(strings.NewReader(nativeSSE(events...)), func(Event) error { return nil }); err == nil {
			t.Fatal("accepted invalid index")
		}
	}
	events := anthropicToolEvents()
	events[2] = map[string]any{"type": "content_block_delta", "index": 0, "delta": map[string]any{"type": "input_json_delta", "partial_json": "{}"}}
	if _, _, err := readAnthropic(strings.NewReader(nativeSSE(events...)), func(Event) error { return nil }); err == nil {
		t.Fatal("accepted mismatched block")
	}
}

func TestNativeRuntimeManualStaysAtRequestTail(t *testing.T) {
	for _, protocol := range []string{ProtocolMessages, ProtocolGoogle} {
		s := nativeTestSettings(protocol)
		b := BuildNativeRequest(s, []Message{{Role: RoleSystem, Content: "STABLE_PREFIX"}, {Role: RoleUser, Content: "TASK"}, {Role: RoleSystem, Name: "aieyra_toolbox_open", Content: "EPHEMERAL_MANUAL"}}, true, nil)
		prefix := b["system"]
		if protocol == ProtocolGoogle {
			prefix = b["systemInstruction"]
		}
		if strings.Contains(string(rawJSON(prefix)), "EPHEMERAL_MANUAL") {
			t.Fatal("manual moved into cache prefix")
		}
		key := "messages"
		if protocol == ProtocolGoogle {
			key = "contents"
		}
		if !strings.Contains(string(rawJSON(b[key])), "EPHEMERAL_MANUAL") {
			t.Fatal("manual missing at tail")
		}
	}
}
