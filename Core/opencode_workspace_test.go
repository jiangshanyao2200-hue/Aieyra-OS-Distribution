// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestOpenCodeThinkingReceiptKindsAndUnknownUsage; TestOpenCodeChatToggleMapping; TestOpenCodeSummaryIdentityFromResponsePayload; TestOpenCodeChatOmitsInternalNamesWithoutMutatingHistory
// Impact: python -B scripts/code-atlas.py show Core/opencode_workspace_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"github.com/aieyra/aieyra-os/api/codec"
	"testing"
	"time"
)

func TestOpenCodeThinkingReceiptKindsAndUnknownUsage(t *testing.T) {
	for _, sample := range []struct {
		protocol string
		body     string
		want     int
	}{
		{"messages", `{"input_tokens":2,"output_tokens":9,"output_tokens_details":{"thinking_tokens":6}}`, 6},
		{"google", `{"promptTokenCount":2,"candidatesTokenCount":3,"thoughtsTokenCount":6}`, 6},
		{"messages", `{"input_tokens":2,"output_tokens":9,"output_tokens_details":{"reasoning_tokens":0}}`, 0},
	} {
		var raw map[string]any
		_ = json.Unmarshal([]byte(sample.body), &raw)
		usage := anthropicUsage(raw)
		if sample.protocol == "google" {
			usage = googleUsage(raw)
		}
		row := agentUsage(1, "model", time.Second, usage)
		if row.Reasoning == nil || *row.Reasoning != sample.want {
			t.Fatal("thinking usage lost", row)
		}
		report := workspaceUsage([]AgentUsage{row})
		if report["reasoning_known"] != true || report["reasoning_tokens"] != sample.want {
			t.Fatal(report)
		}
		report = workspaceUsage([]AgentUsage{row, {Reported: true}})
		if report["reasoning_known"] != false || report["reasoning_tokens"] != sample.want {
			t.Fatal(report)
		}
	}
	if anthropicUsage(nil) != nil || googleUsage(nil) != nil {
		t.Fatal("missing usage fabricated")
	}
	var got []Event
	assembly := codec.NewResponseDecoder(func(e Event) error { got = append(got, e); return nil })
	if _, err := assembly.Feed(`{"type":"response.reasoning_summary_text.delta","output_index":0,"item_id":"summary","summary_index":0,"delta":"public summary"}`, ""); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Kind != EventReasoning || got[0].ReasoningKind != "summary" {
		t.Fatal(got)
	}
	w := &Workspace{live: map[string]WorkspaceLive{WorkspaceMatrix: {}}}
	w.stream(WorkspaceMatrix, got[0])
	if w.live[WorkspaceMatrix].ThoughtKind != "summary" {
		t.Fatal(w.live)
	}
	w.stream(WorkspaceMatrix, Event{Kind: EventDelta, Text: "answer"})
	if w.live[WorkspaceMatrix].Thought != "public summary" || w.live[WorkspaceMatrix].Phase != "body" {
		t.Fatal("公开摘要应短暂停留，同时正文立即显示")
	}
	w.stream(WorkspaceMatrix, Event{Kind: EventReasoning, Text: "late reasoning"})
	if w.live[WorkspaceMatrix].Thought != "public summary" {
		t.Fatal("迟到的思考分片不应覆盖正文阶段保留的摘要")
	}
}

func TestOpenCodeChatToggleMapping(t *testing.T) {
	for _, enabled := range []bool{true, false} {
		s := Defaults()
		s.Adapter = "openai"
		s.BaseURL = "https://opencode.ai/zen/go/v1"
		s.APIProtocol = ProtocolChat
		s.ModelOptions = map[string]any{"reasoning_enabled": enabled}
		body := map[string]any{}
		genericOptions(s, body)
		want := "disabled"
		if enabled {
			want = "enabled"
		}
		if body["thinking"].(map[string]any)["type"] != want {
			t.Fatal(body)
		}
	}
}

func TestOpenCodeSummaryIdentityFromResponsePayload(t *testing.T) {
	item := rawJSON(map[string]any{"id": "reasoning-1", "type": "reasoning", "summary": []any{map[string]string{"type": "summary_text", "text": "Public summary"}}, "encrypted_content": "opaque-token"})
	for _, stream := range []string{terminalFrame("completed", item, responseTextItem("answer")), responseFrame(map[string]any{"type": "response.reasoning_summary_text.delta", "output_index": 0, "item_id": "reasoning-1", "summary_index": 0, "delta": "Public summary"}) + terminalFrame("completed", item, responseTextItem("answer"))} {
		events, err := parseResponseFixture(stream)
		if err != nil {
			t.Fatal(err)
		}
		seen := 0
		for _, e := range events {
			if e.Kind == EventReasoning && e.Text != "" {
				seen++
				if e.ReasoningKind != "summary" || e.Text != "Public summary" {
					t.Fatal(e)
				}
			}
		}
		if seen != 1 {
			t.Fatalf("summary emitted %d times", seen)
		}
	}
	env := responseEnvelope{Output: []json.RawMessage{item}}
	events := env.reasoningEvents()
	if len(events) != 1 || events[0].ReasoningKind != "summary" || events[0].Text != "Public summary" {
		t.Fatal(events)
	}
}

func TestOpenCodeChatOmitsInternalNamesWithoutMutatingHistory(t *testing.T) {
	s := Defaults()
	s.Adapter = "openai"
	s.BaseURL = "https://opencode.ai/zen/go/v1"
	s.APIProtocol = ProtocolChat
	messages := []Message{{Role: RoleSystem, Name: "matrix_assignment", Content: "instructions"}, {Role: RoleTool, Name: "exec_command", ToolCallID: "call-1", Content: "result"}}
	r := BuildRequest(s, messages, false)
	for _, m := range r.Messages {
		if m.Name != "" {
			t.Fatal("internal name leaked")
		}
	}
	if r.Messages[1].ToolCallID != "call-1" || messages[0].Name != "matrix_assignment" {
		t.Fatal("tool identity or history changed")
	}
	s.BaseURL = "https://other.invalid/v1"
	if BuildRequest(s, messages, false).Messages[0].Name != "matrix_assignment" {
		t.Fatal("other provider changed")
	}
}
