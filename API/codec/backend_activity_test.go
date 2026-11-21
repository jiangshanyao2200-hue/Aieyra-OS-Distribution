// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/codec/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestBodyStreamsBeforeReasoningItemCloses; TestReasoningEndNotBlockedByAnotherOutput; TestBodyActivityDoesNotReorderBodyOrReleaseTools
// Impact: python -B scripts/code-atlas.py show API/codec/backend_activity_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package codec

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBodyStreamsBeforeReasoningItemCloses(t *testing.T) {
	for _, donePart := range []bool{false, true} {
		t.Run(map[bool]string{false: "reasoning-part-open", true: "reasoning-item-open"}[donePart], func(t *testing.T) {
			var events []Event
			a := NewResponseDecoder(func(e Event) error { events = append(events, e); return nil })
			run := func(v any) {
				t.Helper()
				b, _ := json.Marshal(v)
				if _, err := a.Feed(string(b), ""); err != nil {
					t.Fatal(err)
				}
			}
			run(map[string]any{"type": "response.reasoning_text.delta", "output_index": 0, "item_id": "r", "delta": "真实思考。"})
			if donePart {
				run(map[string]any{"type": "response.reasoning_text.done", "output_index": 0, "item_id": "r", "text": "真实思考。"})
			}
			run(map[string]any{"type": "response.output_text.delta", "output_index": 1, "item_id": "b", "delta": "正文已经到达。"})
			var body strings.Builder
			for _, e := range events {
				if e.Kind == EventDelta {
					body.WriteString(e.Text)
				}
			}
			if body.String() != "正文已经到达。" {
				t.Fatal("正文被尚未关闭的思考输出项阻挡", events)
			}
			run(map[string]any{"type": "response.completed", "response": map[string]any{"id": "r1", "status": "completed", "output": []any{
				map[string]any{"type": "reasoning", "id": "r", "content": []any{map[string]any{"type": "reasoning_text", "text": "真实思考。"}}},
				map[string]any{"type": "message", "id": "b", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "正文已经到达。"}}},
			}}})
			body.Reset()
			for _, e := range events {
				if e.Kind == EventDelta {
					body.WriteString(e.Text)
				}
			}
			if body.String() != "正文已经到达。" {
				t.Fatal("最终响应重复输出正文", body.String())
			}
		})
	}
}

func TestReasoningEndNotBlockedByAnotherOutput(t *testing.T) {
	var events []Event
	a := NewResponseDecoder(func(e Event) error { events = append(events, e); return nil })
	run := func(v any) {
		t.Helper()
		b, _ := json.Marshal(v)
		if _, err := a.Feed(string(b), ""); err != nil {
			t.Fatal(err)
		}
	}
	run(map[string]any{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"id": "b", "type": "message", "content": []any{}}})
	run(map[string]any{"type": "response.reasoning_text.delta", "output_index": 1, "item_id": "r", "delta": "已经结束。"})
	run(map[string]any{"type": "response.reasoning_text.done", "output_index": 1, "item_id": "r", "text": "已经结束。"})
	found := false
	for _, e := range events {
		found = found || e.Kind == EventReasoningDone
	}
	if !found {
		t.Fatal("真实思考结束信号被其他输出项阻挡")
	}
}

func TestBodyActivityDoesNotReorderBodyOrReleaseTools(t *testing.T) {
	var events []Event
	a := NewResponseDecoder(func(e Event) error { events = append(events, e); return nil })
	run := func(v any) {
		t.Helper()
		b, _ := json.Marshal(v)
		if _, err := a.Feed(string(b), ""); err != nil {
			t.Fatal(err)
		}
	}
	run(map[string]any{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"type": "message", "id": "first", "content": []any{}}})
	run(map[string]any{"type": "response.output_text.delta", "output_index": 1, "item_id": "second", "delta": "后文"})
	started := 0
	for _, e := range events {
		if e.Kind == EventDelta {
			t.Fatal("正文乱序", events)
		}
		if e.Kind == EventBodyPreparing {
			started++
		}
	}
	if started != 1 {
		t.Fatal("正文到达未立即改变活动状态", events)
	}
	run(map[string]any{"type": "response.output_item.done", "output_index": 0, "item": map[string]any{"type": "message", "id": "first", "content": []any{map[string]any{"type": "output_text", "text": "前文"}}}})
	run(map[string]any{"type": "response.function_call_arguments.delta", "output_index": 2, "item_id": "call", "delta": "{}"})
	var body strings.Builder
	for _, e := range events {
		if e.Kind == EventDelta {
			body.WriteString(e.Text)
		}
		if e.Kind == EventResponse || e.Kind == EventDone {
			t.Fatal("尚未校验完整响应就放行工具")
		}
	}
	if body.String() != "前文后文" {
		t.Fatal(body.String())
	}
}
