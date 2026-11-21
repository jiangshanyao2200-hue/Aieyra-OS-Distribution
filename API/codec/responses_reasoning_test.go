// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/codec/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestResponsesPublicReasoningArchiveRoundtrip; TestPublicReasoningLegacyAndMismatchedItemsRemainUnclassified
// Impact: python -B scripts/code-atlas.py show API/codec/responses_reasoning_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package codec

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestResponsesPublicReasoningArchiveRoundtrip(t *testing.T) {
	for _, tc := range []struct {
		name, item  string
		kinds, text []string
	}{
		{"summary", `{"type":"reasoning","id":"r","summary":[{"type":"summary_text","text":"摘要"}],"encrypted_content":"opaque"}`, []string{"summary"}, []string{"摘要"}},
		{"text", `{"type":"reasoning","id":"r","content":[{"type":"reasoning_text","text":"公开文本"}]}`, []string{"text"}, []string{"公开文本"}},
		{"opaque", `{"type":"reasoning","id":"r","encrypted_content":"opaque","summary":[]}`, nil, nil},
		{"mixed", `{"type":"reasoning","id":"r","content":[{"type":"reasoning_text","text":"公开文本"}],"summary":[{"type":"summary_text","text":"摘要一"},{"type":"summary_text","text":"摘要二"}]}`, []string{"text", "summary", "summary"}, []string{"公开文本", "摘要一", "摘要二"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env := ResponseEnvelope{ID: "response-fixture", Status: "completed", Output: []json.RawMessage{json.RawMessage(tc.item)}}
			m, err := env.Message()
			if err != nil {
				t.Fatal(err)
			}
			verify := func(m Message) {
				t.Helper()
				before, err := json.Marshal(m)
				if err != nil {
					t.Fatal(err)
				}
				var restored Message
				if err := json.Unmarshal(before, &restored); err != nil {
					t.Fatal(err)
				}
				var kinds, texts []string
				for _, part := range restored.PublicReasoning() {
					kinds, texts = append(kinds, part.Kind), append(texts, part.Text)
				}
				if !reflect.DeepEqual(kinds, tc.kinds) || !reflect.DeepEqual(texts, tc.text) {
					t.Fatal("archive categories or public text changed", kinds, texts)
				}
				if string(restored.ResponseItems[0]) != tc.item {
					t.Fatal("provider continuation data changed")
				}
				after, err := json.Marshal(m)
				if err != nil || string(before) != string(after) {
					t.Fatal("public projection mutated message", err)
				}
			}
			verify(m)
			var streamed *Message
			var kinds, texts []string
			decoder := NewResponseDecoder(func(e Event) error {
				if e.Kind == EventResponse {
					streamed = e.Message
				}
				if e.Kind == EventReasoning && e.Text != "" {
					kinds, texts = append(kinds, e.ReasoningKind), append(texts, e.Text)
				}
				return nil
			})
			wire, _ := json.Marshal(map[string]any{"type": "response.completed", "response": env})
			if done, err := decoder.Feed(string(wire), ""); err != nil || !done || streamed == nil {
				t.Fatal("stream did not finish", done, err)
			}
			verify(*streamed)
			if !reflect.DeepEqual(kinds, tc.kinds) || !reflect.DeepEqual(texts, tc.text) {
				t.Fatal("live and archived reasoning differ", kinds, texts)
			}
		})
	}
}

func TestPublicReasoningLegacyAndMismatchedItemsRemainUnclassified(t *testing.T) {
	for _, items := range [][]json.RawMessage{
		nil,
		{json.RawMessage(`{"type":"reasoning","summary":[{"type":"summary_text","text":"partial"}]}`)},
		{json.RawMessage(`{"type":"reasoning","encrypted_content":"opaque"}`)},
		{json.RawMessage(`invalid`)},
	} {
		parts := (Message{ReasoningContent: "original text", ResponseItems: items}).PublicReasoning()
		if len(parts) != 1 || parts[0].Kind != "unknown" || parts[0].Text != "original text" {
			t.Fatal("unclassified original was lost or relabeled", parts)
		}
	}
}
