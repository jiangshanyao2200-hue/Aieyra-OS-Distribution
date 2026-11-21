// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/codec/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: chatFramingProbe; Read; chatFramingChunk; TestChatSingleNewlineStreamsBeforeNextChunk; TestChatMultilineSSEPreservesPayloadAndRequiresTerminal
// Impact: python -B scripts/code-atlas.py show API/codec/chat_framing_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package codec

import (
	"encoding/json"
	"io"
	"strings"
	"testing"
)

// A read boundary is a deterministic latency probe: output from the preceding
// chunk must be delivered before the decoder asks the network for more bytes.
type chatFramingProbe struct {
	chunks []string
	read   int
	before func(int)
}

func (r *chatFramingProbe) Read(p []byte) (int, error) {
	if r.before != nil {
		r.before(r.read)
	}
	if r.read == len(r.chunks) {
		return 0, io.EOF
	}
	chunk := r.chunks[r.read]
	n := copy(p, chunk)
	if n != len(chunk) {
		r.chunks[r.read] = chunk[n:]
	} else {
		r.read++
	}
	return n, nil
}

func chatFramingChunk(delta any, finish string) map[string]any {
	return map[string]any{"id": "chat_framing", "choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}}}
}

func TestChatSingleNewlineStreamsBeforeNextChunk(t *testing.T) {
	frame := func(v any) string { b, _ := json.Marshal(v); return "data: " + string(b) + "\n" }
	reader := &chatFramingProbe{chunks: []string{
		frame(chatFramingChunk(map[string]any{"reasoning_content": "先想一想。"}, "")),
		frame(chatFramingChunk(map[string]any{"content": "我来检查。"}, "")),
		frame(chatFramingChunk(map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": "call_framing", "function": map[string]any{"name": "inspect", "arguments": "{\"path\":"}}}}, "")),
		frame(chatFramingChunk(map[string]any{"tool_calls": []any{map[string]any{"index": 0, "function": map[string]any{"arguments": "\"file.txt\"}"}}}}, "tool_calls")),
		"data: [DONE]\n",
	}}
	var thought, body string
	preparing := 0
	var response *Message
	reader.before = func(next int) {
		if next >= 1 && thought != "先想一想。" {
			t.Error("reasoning waited for another network chunk", next, thought)
		}
		if next >= 2 && body != "我来检查。" {
			t.Error("body waited for another network chunk", next, body)
		}
		if next >= 3 && preparing == 0 {
			t.Error("tool activity waited for another network chunk", next)
		}
		if response != nil {
			t.Error("tool response was released before the terminal marker")
		}
	}
	err := ReadChatTools(reader, func(e Event) error {
		switch e.Kind {
		case EventReasoning:
			thought += e.Text
		case EventDelta:
			body += e.Text
		case EventToolPreparing:
			preparing++
		case EventResponse:
			response = e.Message
		}
		return nil
	})
	if err != nil || response == nil || len(response.ToolCalls) != 1 || response.ToolCalls[0].Function.Arguments != `{"path":"file.txt"}` || response.Content != body || response.ReasoningContent != thought {
		t.Fatal("single-newline stream lost or repeated content", response, err)
	}
}

func TestChatMultilineSSEPreservesPayloadAndRequiresTerminal(t *testing.T) {
	chunk := chatFramingChunk(map[string]any{"content": "正文\n第二行"}, "stop")
	b, _ := json.MarshalIndent(chunk, "", "  ")
	multiline := "data: " + strings.ReplaceAll(string(b), "\n", "\ndata: ") + "\n\n"
	for _, ending := range []string{"data: [DONE]\n", "", "data: {broken\n\n"} {
		t.Run(map[string]string{"data: [DONE]\n": "complete", "": "interrupted", "data: {broken\n\n": "invalid-next-frame"}[ending], func(t *testing.T) {
			var body string
			var response *Message
			err := ReadChatTools(strings.NewReader(multiline+ending), func(e Event) error {
				if e.Kind == EventDelta {
					body += e.Text
				}
				if e.Kind == EventResponse {
					response = e.Message
				}
				return nil
			})
			if body != "正文\n第二行" {
				t.Fatal("multi-line JSON changed the text", body, err)
			}
			if ending == "data: [DONE]\n" {
				if err != nil || response == nil || response.Content != body {
					t.Fatal(response, err)
				}
			} else if err == nil || response != nil {
				t.Fatal("incomplete or invalid stream released a usable response", response, err)
			}
		})
	}
}
