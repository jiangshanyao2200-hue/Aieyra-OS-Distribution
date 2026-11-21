// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkspaceHistoryRestoresPublicReasoningCategories
// Impact: python -B scripts/code-atlas.py show Core/workspace_reasoning_history_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestWorkspaceHistoryRestoresPublicReasoningCategories(t *testing.T) {
	for _, tool := range []bool{false, true} {
		name := "message"
		if tool {
			name = "tool-intent"
		}
		t.Run(name, func(t *testing.T) {
			w, _, archive := historyFixture(t)
			m := Message{Role: RoleAssistant, ReasoningContent: "公开文本摘要一摘要二", ResponseItems: []json.RawMessage{
				json.RawMessage(`{"type":"reasoning","id":"mixed","content":[{"type":"reasoning_text","text":"公开文本"}],"summary":[{"type":"summary_text","text":"摘要一"},{"type":"summary_text","text":"摘要二"}],"encrypted_content":"opaque-stays-private"}`),
			}}
			if tool {
				m.ToolCalls = []ToolCall{{ID: "reasoning-call", Function: FunctionCall{Name: "update_plan", Arguments: `{}`}}}
				if err := archive.Append("tool_intent", ToolIntent{InvocationID: "reasoning-turn", Response: m}); err != nil {
					t.Fatal(err)
				}
				if err := archive.Append("tool_turn", ToolTurn{InvocationID: "reasoning-turn", Messages: []Message{m}}); err != nil {
					t.Fatal(err)
				}
			} else if err := archive.Append("message", m); err != nil {
				t.Fatal(err)
			}
			if err := archive.Append("message", Message{Role: RoleAssistant, ResponseItems: []json.RawMessage{json.RawMessage(`{"type":"reasoning","encrypted_content":"not-public"}`)}}); err != nil {
				t.Fatal(err)
			}
			if err := archive.Append("message", Message{Role: RoleAssistant, ReasoningContent: "legacy-original"}); err != nil {
				t.Fatal(err)
			}
			var previous []string
			for pass := 0; pass < 2; pass++ {
				if pass > 0 {
					// Rebuild the projection from archived bytes, as after reopening.
					w.history = workspaceHistory{}
				}
				r, err := w.historyPage(rawJSON(map[string]any{"limit": 30}))
				if err != nil {
					t.Fatal(err)
				}
				var texts, kinds, titles, ids []string
				for _, row := range r.(map[string]any)["entries"].([]historyEntry) {
					if row.Kind != "thinking" {
						continue
					}
					receipt, err := w.historyReceipt(rawJSON(map[string]any{"entry_id": row.ID}))
					if err != nil {
						t.Fatal(err)
					}
					original := receipt.(map[string]any)["input"].(string)
					if row.Text != original {
						t.Fatal("view and original receipt disagree", row.ID)
					}
					texts, kinds = append(texts, row.Text), append(kinds, row.ReasoningKind)
					titles, ids = append(titles, row.Title), append(ids, row.ID)
				}
				if !reflect.DeepEqual(texts, []string{"公开文本", "摘要一", "摘要二", "legacy-original"}) ||
					!reflect.DeepEqual(kinds, []string{"text", "summary", "summary", "unknown"}) ||
					!reflect.DeepEqual(titles, []string{"公开思考", "思考摘要", "思考摘要", "思考（来源类别未知）"}) {
					t.Fatal("public reasoning was lost, merged, relabeled or duplicated", texts, kinds, titles)
				}
				if pass > 0 && !reflect.DeepEqual(ids, previous) {
					t.Fatal("history rebuild changed reasoning identities")
				}
				previous = ids
			}
		})
	}
}
