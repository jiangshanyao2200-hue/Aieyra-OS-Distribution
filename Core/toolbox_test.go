// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: toolboxCall; TestToolboxCredentialArchivePreservesReceiptsWithoutRawKey; TestToolboxTransactionalLifecycleAndRecovery; TestProviderSwitchDoesNotLeakRawReasoning; TestChatToolStreamCompleteAndInterrupted; TestChatToolStreamGatewayFraming
// Impact: python -B scripts/code-atlas.py show Core/toolbox_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func toolboxCall(id, action, name string) ToolCall {
	b, _ := json.Marshal(map[string]any{"action": action, "name": name, "arguments": map[string]any{}})
	return ToolCall{ID: id, Type: "function", Function: FunctionCall{Name: "toolbox", Arguments: string(b)}}
}

func TestToolboxCredentialArchivePreservesReceiptsWithoutRawKey(t *testing.T) {
	archive, err := NewSessionArchive(t.TempDir() + "/config.json")
	if err != nil {
		t.Fatal(err)
	}
	args := `{"action":"call","name":"settings","arguments":{"action":"probe","api_key":"sk-sensitive-only-in-memory","base_url":"https://relay.example"}}`
	call := ToolCall{ID: "secret-call", Type: "function", Function: FunctionCall{Name: "toolbox", Arguments: args}}
	response := Message{Role: RoleAssistant, ToolCalls: []ToolCall{call}, ResponseItems: []json.RawMessage{json.RawMessage(`{"type":"function_call","arguments":"sk-sensitive-only-in-memory"}`)}}
	state := &ToolboxState{Open: map[string]bool{"settings": true}}
	turn, err := ExecuteToolTurn(WithToolbox(context.Background(), state, ""), &PlanEngine{}, nil, response, "secret-invocation", archive.Append)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(archive.Path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "sk-sensitive-only-in-memory") {
		t.Fatal("raw tool credential persisted")
	}
	if ToolArgumentHash(call) != ToolArgumentHash(turn.Messages[0].ToolCalls[0]) {
		t.Fatal("redaction broke receipt identity")
	}
	if _, err = archive.read(); err != nil {
		t.Fatal("redacted archive cannot restore", err)
	}
	if response.ToolCalls[0].Function.Arguments != args {
		t.Fatal("execution arguments mutated")
	}
}
func TestToolboxTransactionalLifecycleAndRecovery(t *testing.T) {
	state := &ToolboxState{}
	ctx := WithToolbox(context.Background(), state, "")
	engine := &PlanEngine{}
	if r := state.Execute(ctx, "", toolboxCall("bad", "call", "compact")); r.OK {
		t.Fatal("closed tool executed")
	}
	response := Message{Role: RoleAssistant, ResponseID: "open-close", ToolCalls: []ToolCall{toolboxCall("open", "open", "settings"), toolboxCall("close", "close", "settings")}}
	var kinds []string
	turn, err := ExecuteToolTurn(ctx, engine, nil, response, response.ResponseID, func(kind string, _ any) error { kinds = append(kinds, kind); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if len(kinds) != 4 || kinds[0] != "tool_intent" || kinds[3] != "tool_turn" {
		t.Fatal(kinds)
	}
	if state.Details() != "" || RestoreToolbox(turn.Messages).Details() != "" {
		t.Fatal("closed instructions retained")
	}
	if strings.Contains(turn.Messages[1].Content, "expected_version") {
		t.Fatal("manual persisted into history")
	}
	again, err := ExecuteToolTurn(ctx, engine, nil, response, response.ResponseID, func(string, any) error { t.Fatal("replay wrote"); return nil })
	if err != nil || !again.Replayed {
		t.Fatal(err, again)
	}
	open := state.Execute(ctx, "", toolboxCall("compact-open", "open", "compact"))
	if !open.OK {
		t.Fatal(open)
	}
	maintenance := &contextCompaction{}
	ctx = context.WithValue(ctx, contextCompactionKey{}, maintenance)
	ctx = context.WithValue(ctx, compactBoundaryKey{}, true)
	compact := state.Execute(ctx, "", toolboxCall("compact", "call", "compact"))
	if !compact.OK || !compactionPending(maintenance.snapshot()) || !strings.Contains(compact.Output, "not yet completed") {
		t.Fatal(compact)
	}
}

func TestProviderSwitchDoesNotLeakRawReasoning(t *testing.T) {
	s := Defaults()
	s.Adapter = "openai"
	s.Model = "relay-model"
	s.ModelContextWindow = 128000
	s.BaseURL = "https://relay.example/v1"
	s.APIKey = "test"
	s.Sanitize()
	if s.Model != "relay-model" || s.Validate() != nil {
		t.Fatal("generic model changed")
	}
	old := Message{Role: RoleAssistant, Provider: "old", Content: "answer", ReasoningContent: "private provider reasoning", ResponseItems: []json.RawMessage{json.RawMessage(`{"type":"reasoning","encrypted_content":"old-provider-only"}`)}, ToolCalls: []ToolCall{{ID: "call", Function: FunctionCall{Name: "toolbox", Arguments: `{"action":"list"}`}}}}
	messages := []Message{old, {Role: RoleTool, ToolCallID: "call", Content: `{"ok":true}`}}
	req := BuildResponsesRequest(s, messages, false, []ToolDefinition{ToolboxDefinition()})
	data, _ := json.Marshal(req)
	if strings.Contains(string(data), "old-provider-only") || strings.Contains(string(data), "private provider reasoning") || req.Reasoning != nil || len(req.Input) != 3 {
		t.Fatal(string(data))
	}
	chat, _ := json.Marshal(BuildRequest(s, messages, false))
	if strings.Contains(string(chat), "provider_identity") || strings.Contains(string(chat), "thinking") || strings.Contains(string(chat), "private provider") {
		t.Fatal(string(chat))
	}
	if NormalizeBaseURL("https://relay.example/v1/chat/completions") != "https://relay.example/v1" {
		t.Fatal("relay path stripped")
	}
}

func TestChatToolStreamCompleteAndInterrupted(t *testing.T) {
	frame := func(v any) string { b, _ := json.Marshal(v); return "data: " + string(b) + "\n\n" }
	chunk := func(delta any, finish string) any {
		return map[string]any{"id": "chat_1", "choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}}}
	}
	first := frame(chunk(map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": "call_1", "type": "function", "function": map[string]any{"name": "toolbox", "arguments": "{\"action\":"}}}}, ""))
	last := frame(chunk(map[string]any{"tool_calls": []any{map[string]any{"index": 0, "function": map[string]any{"arguments": "\"list\"}"}}}}, "tool_calls"))
	for _, complete := range []bool{true, false} {
		input := first + last
		if complete {
			input += "data: [DONE]\n\n"
		}
		var message *Message
		err := readChatTools(strings.NewReader(input), func(e Event) error {
			if e.Kind == EventResponse {
				message = e.Message
			}
			return nil
		})
		if complete {
			if err != nil || message == nil || message.ToolCalls[0].Function.Arguments != `{"action":"list"}` {
				t.Fatal(err, message)
			}
		} else if err == nil || message != nil {
			t.Fatal("interrupted tool executed")
		}
	}
}

func TestChatToolStreamGatewayFraming(t *testing.T) {
	frame := func(v any) string { b, _ := json.Marshal(v); return "data: " + string(b) + "\n" }
	chunk := func(delta any, finish string, extra map[string]any) any {
		v := map[string]any{"id": "chat_1", "choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}}}
		for k, x := range extra {
			v[k] = x
		}
		return v
	}
	first := frame(chunk(map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": "call_1", "type": "function", "function": map[string]any{"name": "toolbox", "arguments": "{\"action\":"}}}}, "", map[string]any{"error": nil}))
	last := frame(chunk(map[string]any{"tool_calls": []any{map[string]any{"index": 0, "function": map[string]any{"arguments": "\"list\"}"}}}}, "tool_calls", map[string]any{"usage": map[string]any{"prompt_tokens": "12"}}))
	run := func(input string) (*Message, error) {
		var message *Message
		err := readChatTools(strings.NewReader(input), func(e Event) error {
			if e.Kind == EventResponse {
				message = e.Message
			}
			return nil
		})
		return message, err
	}
	// Single-newline framing, "error": null and an odd usage shape still complete.
	if m, err := run(first + last + "data: [DONE]\n\n"); err != nil || m == nil || m.ToolCalls[0].Function.Arguments != `{"action":"list"}` {
		t.Fatal(err, m)
	}
	if _, err := run(first + "data: {\"error\":{\"code\":\"Throttling\",\"message\":\"rate limited\"}}\n\n"); err == nil || !strings.Contains(err.Error(), "rate limited") {
		t.Fatal("provider stream error must carry its message", err)
	}
	if _, err := run(first + "data: {not json\n\n"); err == nil || !strings.Contains(err.Error(), "无效分片") {
		t.Fatal("broken chunk must still stop execution", err)
	}
}
