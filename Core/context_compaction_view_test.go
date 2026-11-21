// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestCompactionActivityCommittedContentAndHistoryPages; TestCompactionFailureAndForeignActorNeverBecomeCompletion; TestIdentityActivityProjectsTaskWithoutPrivatePrompt
// Impact: python -B scripts/code-atlas.py show Core/context_compaction_view_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestCompactionActivityCommittedContentAndHistoryPages(t *testing.T) {
	for _, ephemeral := range []bool{false, true} {
		t.Run(fmt.Sprint(ephemeral), func(t *testing.T) {
			m, id, a := activityFixture(t)
			a.ephemeral = ephemeral
			m.jobs[id].archive = a
			write := func(kind string, value any) {
				t.Helper()
				if err := a.Append(kind, value); err != nil {
					t.Fatal(err)
				}
			}
			write("meta", map[string]any{"workspace_generation": 1, "workspace_agent": id})
			write("message", Message{Role: RoleUser, Content: "不在压缩范围内"})
			original := strings.Repeat("保留原文🙂\n", 15000)
			write("message", Message{Role: RoleUser, Content: original})
			call := ToolCall{ID: "read", Function: FunctionCall{Name: "project", Arguments: `{"action":"read","path":"pelican.svg"}`}}
			write("tool_turn", ToolTurn{InvocationID: "view", Messages: []Message{{Role: RoleAssistant, ToolCalls: []ToolCall{call}}, {Role: RoleTool, ToolCallID: "read", Content: "独立检查通过"}}})
			state := CompactionState{RequestID: "test-compact", Trigger: "manual", State: "running", First: 1, Covered: 4, Updated: time.Now().UTC().Format(time.RFC3339Nano)}
			write("compaction_state", state)
			page, rows := activityPage(t, m, id, 0)
			var active AgentActivity
			for _, v := range rows {
				if v.ID == compactionKey(state.RequestID) {
					active = v
				}
			}
			if active.State != "running" || strings.Contains(string(active.Preview), `"after"`) {
				t.Fatal("scheduled compression fabricated completion", active)
			}
			var pending map[string]any
			if err := json.Unmarshal(active.Preview, &pending); err != nil || !strings.Contains(fmt.Sprint(pending["before"]), "保留原文") || strings.Contains(fmt.Sprint(pending["before"]), "不在压缩范围内") {
				t.Fatal("running compression must show the selected source range", err)
			}
			state.State = "completed"
			cp := &Checkpoint{First: 1, Covered: 4, Packet: "real-packet", PacketText: "鹈鹕SVG已生成；独立检查通过。", Compaction: &state, LastUser: "保留任务原话"}
			write("checkpoint", cp)
			next, delta := activityPage(t, m, id, int64(page["cursor"].(float64)))
			if len(delta) != 1 || delta[0].ID != active.ID || delta[0].State != "completed" {
				t.Fatal("checkpoint did not update the actual operation", delta)
			}
			var detail map[string]any
			_ = json.Unmarshal(delta[0].Preview, &detail)
			if !strings.Contains(fmt.Sprint(detail["before"]), "保留原文") || strings.Contains(fmt.Sprint(detail["before"]), "不在压缩范围内") || !strings.Contains(fmt.Sprint(detail["after"]), cp.PacketText) || detail["before_more"] != true {
				t.Fatal("not original-to-committed-summary", detail)
			}
			_, delta = activityPage(t, m, id, int64(next["cursor"].(float64)))
			if len(delta) != 0 {
				t.Fatal("empty poll replayed compaction")
			}
			if strings.Contains(cp.Message().Content, cp.PacketText) {
				t.Fatal("display snapshot leaked into model checkpoint")
			}
			// Independent history index recovers the same completed record after reopen.
			h := workspaceHistory{entries: map[string]historyEntry{}, generations: map[string]int{}, runtimeAgents: map[string]string{}, terminals: map[historyTerminalKey]historyTerminalState{}}
			source := historySource{key: "test", agent: id, path: a.Path, archive: a}
			budget := 8 << 20
			if _, _, err := historyScan(source, 0, &budget, h.visit); err != nil {
				t.Fatal(err)
			}
			v := h.entries[id+":"+active.ID]
			if !v.Compaction || v.State != "completed" {
				t.Fatal("historical completion missing", v)
			}
			var full strings.Builder
			offset := 0
			for {
				part, err := compactionSourcePage(v.input, 1, 4, offset, 64<<10, func(s string) string { return strings.ReplaceAll(s, "独立检查通过", "[redacted]") })
				if err != nil {
					t.Fatal(err)
				}
				if !utf8.ValidString(part.Text) || len(part.Text) > 64<<10 {
					t.Fatal("invalid page")
				}
				full.WriteString(part.Text)
				if part.Next == 0 {
					if full.Len() != part.Size {
						t.Fatal("page size mismatch")
					}
					break
				}
				if part.Next <= offset {
					t.Fatal("no progress")
				}
				offset = part.Next
			}
			want := fmt.Sprintf("压缩的原文 · 第 %d—%d 条\n\n", 2, 4) + compactionMessageText(Message{Role: RoleUser, Content: original}, 1) + compactionMessageText(Message{Role: RoleAssistant, ToolCalls: []ToolCall{call}}, 2) + compactionMessageText(Message{Role: RoleTool, Content: "[redacted]"}, 3)
			if full.String() != want {
				t.Fatal("pagination lost, repeated, or leaked original text")
			}
			write("message", Message{Role: RoleUser, Content: "后来补充不应混入"})
			part, err := compactionSourcePage(v.input, 1, 4, 0, 12000, func(s string) string { return s })
			if err != nil || strings.Contains(part.Text, "后来补充") {
				t.Fatal("historical boundary moved", err)
			}
		})
	}
}

func TestCompactionFailureAndForeignActorNeverBecomeCompletion(t *testing.T) {
	m, id, a := activityFixture(t)
	m.jobs[id].archive = a
	write := func(kind string, v any) {
		t.Helper()
		if err := a.Append(kind, v); err != nil {
			t.Fatal(err)
		}
	}
	write("meta", map[string]any{"workspace_generation": 1, "workspace_agent": id})
	state := CompactionState{RequestID: "failed", State: "failed", Code: "PROVIDER_ERROR"}
	write("compaction_state", state)
	_, rows := activityPage(t, m, id, 0)
	if len(rows) != 1 || rows[0].State != "failed" || strings.Contains(string(rows[0].Preview), `"after"`) {
		t.Fatal(rows)
	}
	write("meta", map[string]any{"workspace_generation": 1, "workspace_agent": "other-owner"})
	state.RequestID = "foreign"
	state.State = "completed"
	write("checkpoint", Checkpoint{Compaction: &state})
	_, rows = activityPage(t, m, id, 0)
	if len(rows) != 1 {
		t.Fatal("foreign checkpoint crossed runtime boundary", rows)
	}
}

func TestIdentityActivityProjectsTaskWithoutPrivatePrompt(t *testing.T) {
	v := activityPreview(ToolCall{Function: FunctionCall{Name: "agents", Arguments: `{"action":"identity_enter","task":"绘制并验证SVG","reason":"多阶段实现","prompt":"private-personality","command":{"plan":["绘图","检查"],"success":"文件可打开","exit":"验证后返回","hidden":"private-boundary"}}`}}, "identity", "")
	text := string(v.InputPreview)
	if !strings.Contains(text, "绘制并验证SVG") || !strings.Contains(text, "检查") || strings.Contains(text, "private-") {
		t.Fatal(text)
	}
}
