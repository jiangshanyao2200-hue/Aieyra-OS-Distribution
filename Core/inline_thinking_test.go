// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestInlineThinkingFragmentation; TestInlineThinkingLiteralAndIncomplete; TestInlineThinkingResponsesWorkspaceStagesAndCorrection
// Impact: python -B scripts/code-atlas.py show Core/inline_thinking_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"github.com/aieyra/aieyra-os/api/codec"
	"strings"
	"testing"
)

func TestInlineThinkingFragmentation(t *testing.T) {
	for _, input := range []string{"<think>分析中文🙂</think>你好", "\n<THINKING>analysis</THINKING>hello", "<think>one</think><think>two</think>answer"} {
		whole := normalizeInlineThinking(&Message{Content: input})
		for width := 1; width <= len(input); width++ {
			var body, thought strings.Builder
			var completed *Message
			send := inlineThinkingEvents(func(e Event) error {
				if e.Kind == EventDelta {
					body.WriteString(e.Text)
				}
				if e.Kind == EventReasoning {
					thought.WriteString(e.Text)
				}
				if e.Kind == EventResponse {
					completed = e.Message
				}
				return nil
			})
			for start := 0; start < len(input); start += width {
				end := start + width
				if end > len(input) {
					end = len(input)
				}
				if err := send(Event{Kind: EventDelta, Text: input[start:end]}); err != nil {
					t.Fatal(err)
				}
			}
			original := &Message{Content: input, NativeContent: []byte(`{"signature":"preserved"}`)}
			if err := send(Event{Kind: EventResponse, Message: original}); err != nil {
				t.Fatal(err)
			}
			if body.String() != whole.Content || thought.String() != whole.ReasoningContent || completed.Content != whole.Content || completed.ReasoningContent != whole.ReasoningContent {
				t.Fatalf("width %d: body=%q thought=%q full=%+v", width, body.String(), thought.String(), completed)
			}
			if original.Content != input || string(completed.NativeContent) != string(original.NativeContent) {
				t.Fatal("wire continuation was modified")
			}
		}
	}
}

func TestInlineThinkingLiteralAndIncomplete(t *testing.T) {
	for _, input := range []string{"show <think>example</think>", "```xml\n<think>example</think>\n```", "<thing>literal", "<thi", "  hello"} {
		m := normalizeInlineThinking(&Message{Content: input})
		if m.Content != input || m.ReasoningContent != "" {
			t.Fatalf("literal changed: %+v", m)
		}
	}
	m := normalizeInlineThinking(&Message{Content: "<think>still thinking</thi", ReasoningContent: "native"})
	if m.Content != "" || m.ReasoningContent != "native\nstill thinking</thi" {
		t.Fatalf("incomplete thinking leaked: %+v", m)
	}
}

func TestInlineThinkingResponsesWorkspaceStagesAndCorrection(t *testing.T) {
	w := &Workspace{live: map[string]WorkspaceLive{}}
	w.taskRequestStart(WorkspaceMatrix, 1, true)
	a := codec.NewResponseDecoder(inlineThinkingEvents(func(e Event) error {
		w.taskStream(WorkspaceMatrix, 1, e)
		return nil
	}))
	feed := func(kind, text string) {
		t.Helper()
		field := "delta"
		if kind == "done" {
			field = "text"
		}
		payload := map[string]any{"type": "response.output_text." + kind, "output_index": 0, "content_index": 0, "item_id": "inline", field: text}
		if _, err := a.Feed(string(rawJSON(payload)), ""); err != nil {
			t.Fatal(err)
		}
	}
	feed("delta", "<thi")
	feed("delta", "nk>正在核对🧠")
	if v := w.live[WorkspaceMatrix]; v.Phase != "thinking" || v.Thought != "正在核对🧠" || v.Text != "" {
		t.Fatalf("inline reasoning hidden by early body activity: %+v", v)
	}
	feed("delta", "</think>旧正文")
	if v := w.live[WorkspaceMatrix]; v.Phase != "body" || v.Text != "旧正文" {
		t.Fatalf("body transition: %+v", v)
	}
	feed("done", "<think>已修正的思考</think>最终正文")
	if v := w.live[WorkspaceMatrix]; v.Text != "最终正文" || v.Thought != "已修正的思考" {
		t.Fatalf("authoritative text correction leaked XML: %+v", v)
	}
}
