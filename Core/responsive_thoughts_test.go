// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestResponsesReasoningDoneBeforeCompletion; TestResponsesToolItemImmediatelySignalsPreparation
// Impact: python -B scripts/code-atlas.py show Core/responsive_thoughts_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"github.com/aieyra/aieyra-os/api/codec"
	"testing"
)

func TestResponsesReasoningDoneBeforeCompletion(t *testing.T) {
	for _, signal := range []string{"response.reasoning_text.done", "response.content_part.done", "response.output_item.done"} {
		t.Run(signal, func(t *testing.T) {
			var events []Event
			a := codec.NewResponseDecoder(func(e Event) error { events = append(events, e); return nil })
			run := func(event any) {
				t.Helper()
				data, _ := json.Marshal(event)
				if _, err := a.Feed(string(data), ""); err != nil {
					t.Fatal(err)
				}
			}
			run(map[string]any{"type": "response.reasoning_text.delta", "output_index": 0, "item_id": "r", "delta": "真实思考。"})
			part := map[string]any{"type": "reasoning_text", "text": "真实思考。"}
			end := map[string]any{"type": signal, "output_index": 0, "item_id": "r", "text": "真实思考。", "part": part, "item": map[string]any{"type": "reasoning", "id": "r", "content": []any{part}}}
			run(end)
			run(end)
			if len(events) != 2 || events[0].Kind != EventReasoning || events[1].Kind != EventReasoningDone {
				t.Fatalf("reasoning end missing, duplicated, or delayed: %+v", events)
			}
		})
	}
}

func TestResponsesToolItemImmediatelySignalsPreparation(t *testing.T) {
	stream := responseFrame(map[string]any{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"type": "function_call", "id": "tool", "call_id": "call", "name": "apply_patch", "arguments": ""}})
	events, err := parseResponseFixture(stream)
	if err == nil || len(events) != 1 || events[0].Kind != EventToolPreparing {
		t.Fatal("tool item arrival failed to switch phase before arguments/completion")
	}
}
