// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestResponsesNewReasoningReplacesEarlierLiveBody; TestResponsesLateReasoningPreservesCurrentBodyAndCompleteTranscript; TestResponsesNewBodyAfterReasoningStartsFreshLiveText
// Impact: python -B scripts/code-atlas.py show Core/responses_live_order_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"github.com/aieyra/aieyra-os/api/codec"
	"strings"
	"testing"
)

// 同一响应可以先汇报再思考；不能把更后输出项与旧摘要的迟到分片混为一谈。
func TestResponsesNewReasoningReplacesEarlierLiveBody(t *testing.T) {
	for _, sample := range []struct {
		name, phase  string
		opaque, hide bool
	}{
		{name: "public-after-body", phase: "body"},
		{name: "hidden-after-body", phase: "body", hide: true},
		{name: "opaque-after-body", phase: "body", opaque: true},
		{name: "public-after-tool", phase: "tool"},
		{name: "opaque-after-tool", phase: "tool", opaque: true},
	} {
		t.Run(sample.name, func(t *testing.T) {
			w := &Workspace{live: map[string]WorkspaceLive{}}
			w.taskRequestStart(WorkspaceMatrix, 7, !sample.hide)
			a := codec.NewResponseDecoder(func(e Event) error {
				w.taskStream(WorkspaceMatrix, 7, e)
				return nil
			})
			feed := func(payload string) {
				t.Helper()
				if _, err := a.Feed(payload, ""); err != nil {
					t.Fatal(err)
				}
			}
			feed(`{"type":"response.output_text.delta","output_index":0,"item_id":"body","delta":"old progress"}`)
			if v := w.live[WorkspaceMatrix]; v.Phase != "body" || v.Text != "old progress" {
				t.Fatal("fixture did not reach body", v)
			}
			index := 1
			if sample.phase == "tool" {
				feed(`{"type":"response.function_call_arguments.delta","output_index":1,"item_id":"tool","delta":"{"}`)
				index = 2
			}
			item := map[string]any{"type": "reasoning", "id": "new-reason", "summary": []any{}, "encrypted_content": "opaque-test-value"}
			if sample.opaque {
				feed(string(rawJSON(map[string]any{"type": "response.output_item.added", "output_index": index, "item": item})))
			} else {
				feed(string(rawJSON(map[string]any{"type": "response.reasoning_summary_text.delta", "output_index": index, "item_id": "new-reason", "summary_index": 0, "delta": "current public summary"})))
				item["summary"] = []any{map[string]any{"type": "summary_text", "text": "current public summary"}}
			}
			v := w.live[WorkspaceMatrix]
			if v.Phase != "thinking" || !v.ReasoningSeen || v.Text != "" || v.ReasoningStartedAt == 0 {
				t.Fatalf("new reasoning left the earlier body live: %+v", v)
			}
			if sample.opaque || sample.hide {
				if v.Thought != "" {
					t.Fatal("invented or exposed reasoning", v)
				}
			} else if v.Thought != "current public summary" || v.ThoughtKind != "summary" {
				t.Fatal("lost current public summary", v)
			}
			feed(`{"type":"response.output_text.done","output_index":0,"item_id":"body","text":"old progress plus delayed suffix"}`)
			if v := w.live[WorkspaceMatrix]; v.Phase != "thinking" || v.Text != "" {
				t.Fatal("late earlier body displaced current reasoning", v)
			}
			feed(string(rawJSON(map[string]any{"type": "response.output_item.done", "output_index": index, "item": item})))
			if v := w.live[WorkspaceMatrix]; v.Phase != "waiting" || v.Text != "" || v.ReasoningStartedAt != 0 || len(v.ReasoningHistory) != 1 {
				t.Fatal("reasoning without a new body restored old progress", v)
			}
		})
	}
}

func TestResponsesLateReasoningPreservesCurrentBodyAndCompleteTranscript(t *testing.T) {
	w := &Workspace{live: map[string]WorkspaceLive{}}
	w.taskRequestStart(WorkspaceMatrix, 3, true)
	var allBody strings.Builder
	var complete *Message
	reason := rawJSON(map[string]any{"id": "reason", "type": "reasoning", "summary": []any{map[string]any{"type": "summary_text", "text": "late summary"}}})
	body := responseTextItem("current body")
	stream := responseFrame(map[string]any{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"id": "reason", "type": "reasoning", "summary": []any{}}})
	stream += responseFrame(map[string]any{"type": "response.output_text.delta", "output_index": 1, "item_id": "item_text", "delta": "current body"})
	stream += responseFrame(map[string]any{"type": "response.reasoning_summary_text.delta", "output_index": 0, "item_id": "reason", "delta": "late summary"})
	stream += terminalFrame("completed", reason, body)
	if err := readResponseStream(strings.NewReader(stream), func(e Event) error {
		w.taskStream(WorkspaceMatrix, 3, e)
		if e.Kind == EventDelta {
			allBody.WriteString(e.Text)
		}
		if e.Kind == EventResponse {
			complete = e.Message
		}
		if e.Kind == EventReasoning && e.Text != "" {
			if v := w.live[WorkspaceMatrix]; v.Phase != "body" || v.Thought != "" || v.Text != "current body" {
				t.Fatal("late older reasoning replaced current body", v)
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if complete == nil || len(complete.ResponseItems) != 2 || allBody.String() != "current body" || !strings.Contains(complete.ReasoningContent, "late summary") {
		t.Fatal("live ordering damaged the verified transcript", complete, allBody.String())
	}
	if v := w.live[WorkspaceMatrix]; v.Phase != "settled" || v.Text != "current body" {
		t.Fatal(v)
	}
}

func TestResponsesNewBodyAfterReasoningStartsFreshLiveText(t *testing.T) {
	w := &Workspace{live: map[string]WorkspaceLive{}}
	w.taskRequestStart(WorkspaceMatrix, 4, true)
	a := codec.NewResponseDecoder(func(e Event) error { w.taskStream(WorkspaceMatrix, 4, e); return nil })
	for _, payload := range []string{
		`{"type":"response.output_text.delta","output_index":0,"item_id":"first","delta":"old progress"}`,
		`{"type":"response.output_item.done","output_index":0,"item":{"id":"first","type":"message","content":[{"type":"output_text","text":"old progress"}]}}`,
		`{"type":"response.reasoning_summary_text.delta","output_index":1,"item_id":"reason","delta":"new thought"}`,
		`{"type":"response.reasoning_summary_text.done","output_index":1,"item_id":"reason","text":"new thought"}`,
		`{"type":"response.output_text.delta","output_index":2,"item_id":"last","delta":"new body"}`,
	} {
		if _, err := a.Feed(payload, ""); err != nil {
			t.Fatal(err)
		}
	}
	if v := w.live[WorkspaceMatrix]; v.Phase != "body" || v.Text != "new body" || v.NewBody || v.ReasoningStartedAt != 0 {
		t.Fatal("new live body was joined to invalidated progress", v)
	}
	// 请求/代际边界不得继承上一响应的输出索引，内部游标也不进入协议。
	w.taskRequestStart(WorkspaceMatrix, 5, true)
	payload := `{"type":"response.reasoning_summary_text.delta","output_index":0,"item_id":"fresh","delta":"fresh generation"}`
	a = codec.NewResponseDecoder(func(e Event) error { w.taskStream(WorkspaceMatrix, 5, e); return nil })
	if _, err := a.Feed(payload, ""); err != nil {
		t.Fatal(err)
	}
	if v := w.live[WorkspaceMatrix]; v.Phase != "thinking" || v.Thought != "fresh generation" {
		t.Fatal(v)
	}
	encoded, err := json.Marshal(w.live[WorkspaceMatrix])
	if err != nil || strings.Contains(strings.ToLower(string(encoded)), "outputindex") || strings.Contains(string(encoded), "stream_output") {
		t.Fatal("internal output ordering leaked into the UI protocol", string(encoded), err)
	}
}
