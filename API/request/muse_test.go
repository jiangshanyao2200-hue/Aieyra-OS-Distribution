// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/request/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestTextOnlyWireCannotAcquireToolsFromHistoryOrLateOptions
// Impact: python -B scripts/code-atlas.py show API/request/muse_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package request_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/api/request"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

func TestTextOnlyWireCannotAcquireToolsFromHistoryOrLateOptions(t *testing.T) {
	history := []protocol.Message{{Role: "system", Content: "identity"}, {Role: "assistant", ToolCalls: []protocol.ToolCall{{ID: "call", Type: "function", Function: protocol.FunctionCall{Name: "inspect", Arguments: `{}`}}}}, {Role: "tool", ToolCallID: "call", Content: "actual historical fact"}}
	before, _ := json.Marshal(history)
	for _, stream := range []bool{false, true} {
		r := request.BuildChat(request.Profile{Model: "muse-spark", Protocol: request.ProtocolChat, TextOnly: true, Generic: true, MaxTokens: 123, Extra: map[string]any{"reasoning_effort": "high", "prompt_cache_key": "not-supported", "tools": []any{"injected"}}}, history, stream, nil)
		r.ToolChoice = "auto"
		r.Tools = []request.ChatToolDefinition{{Type: "function", Function: protocol.ToolDefinition{Name: "write"}}}
		body := wire(t, r)
		want := 3
		if stream {
			want = 4
		}
		if len(body) != want || body["stream"] != stream {
			t.Fatal(body)
		}
		for _, raw := range body["messages"].([]any) {
			m := raw.(map[string]any)
			if len(m) != 2 || m["role"] == "tool" {
				t.Fatal(m)
			}
		}
		encoded, _ := json.Marshal(body)
		if !strings.Contains(string(encoded), "actual historical fact") {
			t.Fatal("history lost")
		}
	}
	after, _ := json.Marshal(history)
	if string(before) != string(after) {
		t.Fatal("archive changed")
	}
}
