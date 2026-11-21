// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/request/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: wire; TestChatNormalizesHistoryBeforeImagesAndPreservesToolBatch; TestProviderContinuationAndCacheAreRequestLocal; TestResponsesRuntimeUpdatesKeepRelayInstructionsAndToolHistoryStable; TestNativeReplayRepairsLegacyIDsAndCombinesResults
// Impact: python -B scripts/code-atlas.py show API/request/request_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package request_test

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/api/request"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

func wire(t *testing.T, value any) map[string]any {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err = json.Unmarshal(data, &body); err != nil {
		t.Fatal(err)
	}
	return body
}

func TestChatNormalizesHistoryBeforeImagesAndPreservesToolBatch(t *testing.T) {
	p := request.Profile{Protocol: request.ProtocolChat, Provider: "fixture", Generic: true, SupportsImages: true, ReasoningField: "reasoning_content", IncludeUsage: true}
	call := func(id string) protocol.ToolCall {
		return protocol.ToolCall{ID: id, Type: "function", Function: protocol.FunctionCall{Name: "inspect", Arguments: `{}`}}
	}
	messages := []protocol.Message{
		{Role: "system", Content: "identity"}, {Role: "system", Content: "rules"},
		{Role: "user", Content: "inspect", Images: []protocol.ImageAttachment{{Name: "user.png"}}},
		{Role: "assistant", Provider: "fixture", ToolCalls: []protocol.ToolCall{call("a"), call("b")}},
		{Role: "tool", ToolCallID: "a", Name: "inspect", Content: "result a", Images: []protocol.ImageAttachment{{Name: "tool.png"}}},
		{Role: "tool", ToolCallID: "b", Name: "inspect", Content: "result b"},
		{Role: "system", Content: "time changed"},
	}
	original, _ := json.Marshal(messages)
	reads := 0
	resolve := func(m protocol.Message) []request.Image {
		reads++
		return []request.Image{{DataURL: "data:image/png;base64,c25hcHNob3Q=", Detail: "high", Label: m.Images[0].Name}}
	}
	r := request.BuildChat(p, messages, true, resolve)
	body := wire(t, r)
	rows := body["messages"].([]any)
	roles := []string{}
	for _, row := range rows {
		roles = append(roles, row.(map[string]any)["role"].(string))
	}
	if !reflect.DeepEqual(roles, []string{"system", "user", "assistant", "tool", "tool", "user", "user"}) {
		t.Fatal(roles)
	}
	if rows[0].(map[string]any)["content"] != "identity\n\nrules" || rows[2].(map[string]any)["reasoning_content"] != "" {
		t.Fatal(body)
	}
	if rows[6].(map[string]any)["content"] != "[Aieyra runtime context]\ntime changed" {
		t.Fatal("unstable system prefix", body)
	}
	encoded, _ := json.Marshal(r)
	if reads != 2 || strings.Count(string(encoded), "data:image/png;base64,") != 2 || strings.Contains(string(encoded), `"detail"`) || strings.Contains(string(encoded), "image_attachments") {
		t.Fatal("image encoding", reads, string(encoded))
	}
	if !reflect.DeepEqual(body, wire(t, r)) || reads != 2 {
		t.Fatal("marshal reread assets")
	}
	after, _ := json.Marshal(messages)
	if !bytes.Equal(original, after) {
		t.Fatal("archive changed")
	}
	if _, ok := wire(t, request.BuildChat(p, nil, false, nil))["stream_options"]; ok {
		t.Fatal("nonstream request carries stream options")
	}
}

func TestProviderContinuationAndCacheAreRequestLocal(t *testing.T) {
	opaque := json.RawMessage(`{"type":"reasoning","id":"r1","encrypted_content":"opaque"}`)
	m := protocol.Message{Role: "assistant", Provider: "first", Content: "answer", ResponseItems: []json.RawMessage{opaque}, NativeContent: json.RawMessage(`[{"type":"thinking","signature":"native"}]`), ReasoningContent: "thought", ReasoningDetails: json.RawMessage(`[{"signature":"router"}]`), ToolCalls: []protocol.ToolCall{{ID: "a", Function: protocol.FunctionCall{Name: "inspect", Arguments: `{}`}, ExtraContent: json.RawMessage(`{"signature":"tool"}`)}}}
	p := request.Profile{Model: "gpt-fixture", Protocol: request.ProtocolResponses, Provider: "first", Generic: true, Extra: map[string]any{"reasoning": map[string]any{"effort": "low"}}}
	r := request.BuildResponses(p, []protocol.Message{m}, true, nil, nil)
	r.SetPromptCacheKey("session-a")
	other := request.BuildResponses(p, []protocol.Message{m}, true, nil, nil)
	other.SetPromptCacheKey("session-b")
	if string(r.Input[0]) != string(opaque) || wire(t, r)["prompt_cache_key"] != "session-a" || wire(t, other)["prompt_cache_key"] != "session-b" {
		t.Fatal("continuation or cache crossed requests")
	}
	r.SetPromptCacheKey("replacement")
	if wire(t, r)["prompt_cache_key"] != "session-a" || p.Extra["prompt_cache_key"] != nil {
		t.Fatal("cache changed explicit setting or profile")
	}
	p.Provider = "second"
	p.Protocol = request.ProtocolChat
	chat, _ := json.Marshal(request.BuildChat(p, []protocol.Message{m}, false, nil))
	for _, field := range []string{"opaque", "native_content", "router", "extra_content", "thought", "provider_identity", "response_items"} {
		if strings.Contains(string(chat), field) {
			t.Fatal("cross-provider payload", field, string(chat))
		}
	}
	responses, _ := json.Marshal(request.BuildResponses(p, []protocol.Message{m}, false, nil, nil))
	if strings.Contains(string(responses), "opaque") || !strings.Contains(string(responses), "function_call") {
		t.Fatal(string(responses))
	}
}

func TestResponsesRuntimeUpdatesKeepRelayInstructionsAndToolHistoryStable(t *testing.T) {
	for _, model := range []string{"gpt-6.1-sol", "openai/gpt-fixture", "relay-fixture"} {
		t.Run(model, func(t *testing.T) {
			messages := []protocol.Message{
				{Role: "system", Content: "editable personality"},
				{Role: "system", Content: "stable tool protocol"},
				{Role: "user", Content: "read the file"},
				{Role: "assistant", ToolCalls: []protocol.ToolCall{{ID: "read-1", Function: protocol.FunctionCall{Name: "terminal", Arguments: `{"action":"exec","cmd":"read"}`}}}},
				{Role: "tool", ToolCallID: "read-1", Content: "the actual file contents"},
				{Role: "system", Name: "aieyra_clock", Content: "10:01"},
			}
			before, _ := json.Marshal(messages)
			profile := request.Profile{Model: model, Provider: "relay", Generic: true}
			first := request.BuildResponses(profile, messages, true, nil, nil)
			changed := append([]protocol.Message(nil), messages...)
			changed[len(changed)-1].Content = "10:02"
			second := request.BuildResponses(profile, changed, true, nil, nil)
			instructions := func(r *request.ResponsesRequest) string {
				var parts []string
				for _, item := range r.Input {
					var v map[string]any
					_ = json.Unmarshal(item, &v)
					if v["role"] == "system" || v["role"] == "developer" {
						parts = append(parts, v["content"].(string))
					}
				}
				return strings.Join(parts, "\n")
			}
			if instructions(first) != "editable personality\nstable tool protocol" || instructions(first) != instructions(second) {
				t.Fatal("a transient update changed relay instructions")
			}
			for i := 0; i < len(first.Input)-1; i++ {
				if !bytes.Equal(first.Input[i], second.Input[i]) {
					t.Fatal("runtime update rewrote history", i)
				}
			}
			var tail map[string]any
			_ = json.Unmarshal(second.Input[len(second.Input)-1], &tail)
			if tail["role"] != "user" || tail["content"] != "[Aieyra runtime context]\n10:02" {
				t.Fatal("runtime information was lost", tail)
			}
			after, _ := json.Marshal(messages)
			if !bytes.Equal(before, after) || !bytes.Contains(first.Input[4], []byte(`"call_id":"read-1"`)) {
				t.Fatal("archive or tool result identity changed")
			}
		})
	}
}

func TestNativeReplayRepairsLegacyIDsAndCombinesResults(t *testing.T) {
	call := protocol.ToolCall{ID: "recovered", Function: protocol.FunctionCall{Name: "inspect", Arguments: `{}`}}
	messages := []protocol.Message{
		{Role: "system", Content: "fixed"},
		{Role: "assistant", Provider: "fixture", ToolCalls: []protocol.ToolCall{call}, NativeContent: json.RawMessage(`[{"type":"thinking","thinking":"plan","signature":"opaque"},{"type":"tool_use","name":"inspect","input":{}}]`)},
		{Role: "tool", ToolCallID: "recovered", Content: "done"}, {Role: "tool", ToolCallID: "second", Content: "also done"},
	}
	p := request.Profile{Protocol: request.ProtocolMessages, Provider: "fixture", Model: "fixture", OutputLimit: 123, Extra: map[string]any{"thinking": map[string]any{"budget_tokens": 42}}}
	body := wire(t, request.BuildNative(p, messages, false, nil))
	turns := body["messages"].([]any)
	parts := turns[0].(map[string]any)["content"].([]any)
	if parts[0].(map[string]any)["signature"] != "opaque" || parts[1].(map[string]any)["id"] != "recovered" || len(turns) != 2 || len(turns[1].(map[string]any)["content"].([]any)) != 2 || body["max_tokens"] != float64(123) {
		t.Fatal(body)
	}
	if strings.Contains(string(messages[1].NativeContent), "recovered") {
		t.Fatal("archive was repaired in place")
	}
	p.Protocol = request.ProtocolGoogle
	p.MaxTokens = 321
	p.Extra = map[string]any{"generationConfig": map[string]any{"maxOutputTokens": 999, "thinkingConfig": map[string]any{"includeThoughts": true}}}
	messages[1].NativeContent = json.RawMessage(`[{"text":""},{"text":"","thoughtSignature":"signed"},{"functionCall":{"name":"inspect","args":{}}}]`)
	google := wire(t, request.BuildNative(p, messages, true, nil))
	parts = google["contents"].([]any)[0].(map[string]any)["parts"].([]any)
	config := google["generationConfig"].(map[string]any)
	if len(parts) != 2 || parts[0].(map[string]any)["thoughtSignature"] != "signed" || config["maxOutputTokens"] != float64(321) || config["thinkingConfig"] == nil {
		t.Fatal(google)
	}
}
