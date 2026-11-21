// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/context/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestChangedToolArgumentsInvalidateObservedTokenCount; TestMeterPrefixOwnsNestedMessageData
// Impact: python -B scripts/code-atlas.py show Agent/context/budget_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package context

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/contracts/protocol"
)

func TestChangedToolArgumentsInvalidateObservedTokenCount(t *testing.T) {
	messages := []protocol.Message{{Role: protocol.RoleAssistant, ToolCalls: []protocol.ToolCall{{ID: "call", Function: protocol.FunctionCall{Name: "write", Arguments: "old"}}}}}
	meter := TokenMeter{}
	meter.ObserveRequest(messages, 100)
	messages[0].ToolCalls[0].Function.Arguments = strings.Repeat("new content ", 1000)
	if estimate := meter.Estimate(messages); estimate < 2000 {
		t.Fatal("changed request reused an old provider count", estimate)
	}
}

func TestMeterPrefixOwnsNestedMessageData(t *testing.T) {
	cases := map[string]func(*protocol.Message){
		"tool arguments":    func(m *protocol.Message) { m.ToolCalls[0].Function.Arguments = "changed" },
		"tool signature":    func(m *protocol.Message) { m.ToolCalls[0].ExtraContent[1] = 'y' },
		"tool index":        func(m *protocol.Message) { *m.ToolCalls[0].Index = 9 },
		"incomplete call":   func(m *protocol.Message) { m.IncompleteTools[0].Function.Name = "changed" },
		"image":             func(m *protocol.Message) { m.Images[0].Asset = "changed" },
		"response item":     func(m *protocol.Message) { m.ResponseItems[0][1] = 'y' },
		"native content":    func(m *protocol.Message) { m.NativeContent[1] = 'y' },
		"reasoning details": func(m *protocol.Message) { m.ReasoningDetails[1] = 'y' },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			index := 2
			messages := []protocol.Message{{Role: protocol.RoleAssistant, FinishReason: "stop", Content: strings.Repeat("context ", 500),
				ToolCalls:       []protocol.ToolCall{{Index: &index, ID: "call", Function: protocol.FunctionCall{Name: "read", Arguments: "original"}, ExtraContent: json.RawMessage(`"x"`)}},
				IncompleteTools: []protocol.ToolCall{{Function: protocol.FunctionCall{Name: "partial"}}},
				Images:          []protocol.ImageAttachment{{Asset: "original"}}, ResponseItems: []json.RawMessage{json.RawMessage(`"x"`)},
				NativeContent: json.RawMessage(`"x"`), ReasoningDetails: json.RawMessage(`"x"`)}}
			meter := TokenMeter{}
			meter.ObserveRequest(messages, 100)
			before, _ := json.Marshal(meter.Prefix)
			mutate(&messages[0])
			after, _ := json.Marshal(meter.Prefix)
			if string(before) != string(after) {
				t.Fatal("observed prefix changed with caller-owned message data")
			}
			if meter.Prefix[0].FinishReason != "stop" {
				t.Fatal("non-wire message metadata lost while snapshotting")
			}
		})
	}
}
