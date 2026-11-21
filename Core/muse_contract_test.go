// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: museCoreTransport; TestMuseRuntimeDescribesActualTextOnlyTransport; RoundTrip; TestMuseChatUsesMinimalWireAndUnverifiedUsageCannotBecomeRealZero; TestMuseMediaAndUnsupportedProtocolCannotEnterChatTransport
// Impact: python -B scripts/code-atlas.py show Core/muse_contract_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

type museCoreTransport func(*http.Request) (*http.Response, error)

func TestMuseRuntimeDescribesActualTextOnlyTransport(t *testing.T) {
	s := Defaults()
	s.Model, s.BaseURL, s.Adapter, s.APIProtocol = "muse-spark", "https://fast.aieyra.cn/v1", "openai", ProtocolChat
	prefix := []Message{{Role: RoleSystem, Name: "matrix_assignment", Content: "editable work/personality"}, {Role: RoleSystem, Name: "aieyra_shell_runtime", Content: "execute shell"}, {Role: RoleSystem, Name: "aieyra_toolbox_catalogue", Content: "call tools"}, {Role: RoleSystem, Name: "workspace_role_contract", Content: "delegate locally"}, {Role: RoleSystem, Name: "memory_runtime_contract", Content: "call memory"}, {Role: RoleUser, Name: "pac_memory", Content: "real existing memory"}}
	tools := []ToolDefinition{{Name: "apply_patch"}}
	request, actual := modelRuntimePrefix(s, prefix, tools)
	text := string(rawJSON(request))
	if len(actual) != 0 || strings.Contains(text, "execute shell") || strings.Contains(text, "call tools") || strings.Contains(text, "call memory") || strings.Contains(text, "delegate locally") {
		t.Fatal("unavailable local capabilities advertised", text)
	}
	for _, want := range []string{"editable work/personality", "real existing memory", "text_only", "local_filesystem_access", "remote_environment"} {
		if !strings.Contains(text, want) {
			t.Fatal("missing accurate context", want)
		}
	}
	if len(prefix) != 6 || len(tools) != 1 {
		t.Fatal("caller data changed")
	}
	s.Model = "muse-spark-1.3-contributor"
	request, actual = modelRuntimePrefix(s, prefix, tools)
	if len(actual) != 1 || len(request) != len(prefix) {
		t.Fatal("different model lost capabilities")
	}
}

func (f museCoreTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestMuseChatUsesMinimalWireAndUnverifiedUsageCannotBecomeRealZero(t *testing.T) {
	for _, streaming := range []bool{false, true} {
		for _, badTool := range []bool{false, true} {
			s := Defaults()
			s.Model, s.BaseURL, s.Adapter, s.APIProtocol = "muse-spark", "https://fast.aieyra.cn/v1", "openai", ProtocolChat
			s.APIKey, s.Stream, s.MaxTokens = "fixture-only", boolRef(streaming), 300
			client := New(s)
			calls := 0
			client.http = &http.Client{Transport: museCoreTransport(func(r *http.Request) (*http.Response, error) {
				calls++
				var body map[string]any
				if e := json.NewDecoder(r.Body).Decode(&body); e != nil {
					t.Fatal(e)
				}
				want := 3
				if streaming {
					want = 4
				}
				if len(body) != want || r.URL.Path != "/v1/chat/completions" {
					t.Fatal(body, r.URL.Path)
				}
				message := map[string]any{"role": "assistant", "content": "hello"}
				if badTool {
					message["tool_calls"] = []any{map[string]any{"id": "call", "type": "function", "function": map[string]string{"name": "apply_patch", "arguments": `{}`}}}
				}
				var raw []byte
				if streaming {
					raw, _ = json.Marshal(map[string]any{"id": "fixture", "choices": []any{map[string]any{"index": 0, "delta": message, "finish_reason": "stop"}}, "usage": map[string]int{"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}})
					raw = []byte("data: " + string(raw) + "\n\ndata: [DONE]\n\n")
				} else {
					raw, _ = json.Marshal(map[string]any{"choices": []any{map[string]any{"message": message, "finish_reason": "stop"}}, "usage": map[string]int{"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}})
				}
				return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(string(raw))), Request: r}, nil
			})}
			answer, usage, e := completeAgent(context.Background(), client, s, []Message{{Role: RoleUser, Content: "hi"}}, []ToolDefinition{{Type: "function", Name: "apply_patch", Parameters: map[string]any{"type": "object"}}})
			if badTool {
				if e == nil || len(answer.ToolCalls) > 0 {
					t.Fatal("pure text model acquired executable tools", e)
				}
			} else if e != nil || answer.Content != "hello" || usage != nil {
				t.Fatal(answer.Content, usage, e)
			}
			if calls != 1 {
				t.Fatal("unexpected request replay", calls)
			}
		}
	}
}

func TestMuseMediaAndUnsupportedProtocolCannotEnterChatTransport(t *testing.T) {
	for _, model := range []string{"muse-spark", "muse-image", "muse-video"} {
		s := Defaults()
		s.Model, s.BaseURL, s.Adapter, s.APIProtocol = model, "https://fast.aieyra.cn/v1", "openai", ProtocolResponses
		if e := s.ValidatePoolRequest(); e == nil {
			t.Fatal("unsupported route admitted", model)
		}
	}
	s := Defaults()
	s.ModelPoolVersion, s.ActiveProfile = 1, "image"
	s.APIProfiles = []APIProfile{{ID: "image", Kind: "image", Model: "muse-image"}}
	if s.rolePoolProfile("image") != nil {
		t.Fatal("image profile became a role model")
	}
	if e := s.ValidatePoolRequest(); e == nil {
		t.Fatal("media kind was ignored")
	}
}
