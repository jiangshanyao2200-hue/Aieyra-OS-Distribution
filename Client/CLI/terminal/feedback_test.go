// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestFeedbackToolPreviewKeepsReadableRealContent; TestFeedbackMarkdownEmitsSemanticANSI; TestFeedbackToolRowsKeepBriefWithDetail; TestFeedbackLateReplyAndClipboardCannotOverwriteEditedDraft; TestFeedbackPlanBoundaryAndCompletionRetireReading; TestFeedbackIdleBeforeAcceptanceAndFastRoundsKeepReadableUser; TestFeedbackFastTypingEnterSends; TestFeedbackQueuedSendAndLostAckPreserveOrder; TestFeedbackAckDoesNotEraseNewIdenticalDraft; TestFeedbackBusySupplementSendsAndClearsOnlyDisplay
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/feedback_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
)

func TestFeedbackToolPreviewKeepsReadableRealContent(t *testing.T) {
	raw := json.RawMessage(`{"state":"applied","files":[{"path":"中文.go","new_path":"new.go","operation":"update","added":1,"removed":1,"hunks":[{"context":"main","lines":[{"kind":"context","text":"context"},{"kind":"remove","text":"old"},{"kind":"add","text":"👩‍💻 é\tnew"}]}]}],"omitted_lines":3}`)
	got := activityDetails(activity{Preview: raw})
	for _, want := range []string{"状态：applied", "中文.go → new.go · 修改 +1 / -1", "@@ main", "  context", "- old", "+ 👩‍💻 é\tnew", "预览省略 3 行"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing real receipt content %q: %q", want, got)
		}
	}
	if strings.Contains(got, `"kind"`) || strings.Contains(got, `"hunks"`) {
		t.Fatal("raw patch JSON leaked into display", got)
	}
	for _, raw := range []string{`{"output":"actual output"}`, `{"text":"actual output"}`, `{"unknown":["actual output"]}`} {
		if !strings.Contains(previewText(json.RawMessage(raw)), "actual output") {
			t.Fatal("real output discarded", raw)
		}
	}
}

func TestFeedbackMarkdownEmitsSemanticANSI(t *testing.T) {
	var cache wrapCache
	got := strings.Join(cache.markdown("plain **emphasis** `code`", 80), "\n")
	if ansi.Strip(got) != "plain emphasis code" {
		t.Fatal("Markdown changed text", got)
	}
	for _, want := range []string{"38;5;252mplain", "1;38;5;159memphasis", "38;5;147mcode"} {
		if !strings.Contains(got, want) {
			t.Errorf("Markdown lost terminal styling %q: %q", want, got)
		}
	}
}

func TestFeedbackToolRowsKeepBriefWithDetail(t *testing.T) {
	m := testModel()
	old := time.Now().Add(-time.Second)
	for _, id := range []string{"ONE", "TWO", "THREE"} {
		m.activities = append(m.activities, activityView{
			activity: activity{ID: id, Title: "我看看 " + id, State: "running"},
			appeared: old, shown: id + " output\n中文 👩‍💻 é\n" + id + " tail", details: id + " output\n中文 👩‍💻 é\n" + id + " tail remaining",
		})
	}
	for _, width := range []int{1, 8, 40, 100} {
		m.width = width
		for room := 1; room <= 9; room++ {
			rows := m.activityRows(room)
			if len(rows) > room {
				t.Fatal("tool rows exceed available height")
			}
			for _, row := range rows {
				if ansi.StringWidth(row) > width {
					t.Fatal("tool rows exceed available width", width, row)
				}
			}
			if width >= 40 {
				plain := ansi.Strip(strings.Join(rows, "\n"))
				for _, id := range []string{"ONE", "TWO", "THREE"} {
					if strings.Contains(plain, id+" tail") && !strings.Contains(plain, "查看 "+id) {
						t.Fatalf("orphaned tool details: room=%d %q", room, plain)
					}
				}
			}
		}
	}
	m.width = 100
	for i := range m.activities {
		m.activities[i].shown = m.activities[i].details
		m.activities[i].readAt = time.Now().Add(-4 * time.Second)
	}
	rows := m.activityRows(9)
	if len(rows) != 3 || strings.Contains(ansi.Strip(strings.Join(rows, "\n")), "tail") {
		t.Fatal("tool details did not fold to three brief rows", rows)
	}
}

func TestFeedbackLateReplyAndClipboardCannotOverwriteEditedDraft(t *testing.T) {
	for _, edit := range []string{"typing", "paste", "newline", "block-delete", "menu"} {
		t.Run(edit, func(t *testing.T) {
			m := testModel()
			m.input.SetValue("继续")
			m.session.Call = func(context.Context, string, any, any) error { return nil }
			cmd := m.reply(human{}, "继续")
			epoch := m.inputEpoch
			switch edit {
			case "typing":
				m.key(key(tea.KeyBackspace))
				m.key(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("续")})
			case "paste":
				m.key(key(tea.KeyBackspace))
				m.handlePaste("续")
			case "newline":
				m.key(key(tea.KeyCtrlJ))
				m.key(key(tea.KeyBackspace))
			case "block-delete":
				m.handlePaste("\tcode")
				m.key(key(tea.KeyBackspace))
			case "menu":
				m.setInputAt("/a", 2)
				m.key(key(tea.KeyTab))
				m.setInputAt("继续", 2)
			}
			if m.inputEpoch == epoch {
				t.Fatal("draft edit did not advance epoch")
			}
			m.Update(clipboardResult{clipboardTextMsg{"LATE_CLIPBOARD", nil}, m.epoch, epoch})
			m.Update(cmd())
			if m.input.Value() != "继续" {
				t.Fatalf("late result changed edited draft: %q", m.input.Value())
			}
		})
	}
	m := testModel()
	epoch := m.inputEpoch
	m.bufferInput("新")
	m.Update(clipboardResult{clipboardTextMsg{"LATE", nil}, m.epoch, epoch})
	m.settlePaste()
	if m.input.Value() != "新" {
		t.Fatal("unsettled input accepted stale clipboard", m.input.Value())
	}
}

func TestFeedbackPlanBoundaryAndCompletionRetireReading(t *testing.T) {
	m := testModel()
	m.taskStarted, m.taskGeneration = true, 7
	s := snapshot{Busy: true, Roles: []role{{ID: "matrix", Role: "matrix", Generation: 7}}, Plan: &livePlan{ID: "p", Revision: 2, Objective: "旧计划", Status: "running"}}
	s.PlanScope.Generation = 7
	m.applySnapshot(pollMsg{data: s})
	m.key(tea.KeyMsg{Type: tea.KeyRunes, Alt: true, Runes: []rune{'p'}})
	if !m.planExpanded {
		t.Fatal("current plan failed to open")
	}
	m.beginDisplay("补充")
	m.applySnapshot(pollMsg{data: s})
	m.key(tea.KeyMsg{Type: tea.KeyRunes, Alt: true, Runes: []rune{'p'}})
	if m.planExpanded || m.planLine() != "" {
		t.Fatal("old plan survived display boundary")
	}
	s.Plan = &livePlan{ID: "p", Revision: 3, Objective: "新修订", Status: "running"}
	m.applySnapshot(pollMsg{data: s})
	if m.planLine() == "" {
		t.Fatal("new plan revision hidden")
	}
	m.key(tea.KeyMsg{Type: tea.KeyRunes, Alt: true, Runes: []rune{'p'}})
	s.Busy = false
	s.Roles = nil // cleanup must run even before generation early return
	m.applySnapshot(pollMsg{data: s})
	m.key(tea.KeyMsg{Type: tea.KeyRunes, Alt: true, Runes: []rune{'p'}})
	if m.pinnedPlan != nil || m.planExpanded || m.planLine() != "" {
		t.Fatal("completed plan could reopen")
	}
}

func TestFeedbackIdleBeforeAcceptanceAndFastRoundsKeepReadableUser(t *testing.T) {
	m := testModel()
	m.beginDisplay("新任务")
	m.applySnapshot(pollMsg{data: m.snapshot})
	if m.userText != "新任务" {
		t.Fatal("old idle poll cleared pending user")
	}
	s := snapshot{Busy: true, Roles: []role{{ID: "matrix", Role: "matrix", Generation: 1}}, Live: map[string]protocol.WorkspaceLive{"matrix": {BodyID: "a", Text: "第一轮"}}}
	m.applySnapshot(pollMsg{data: s})
	if m.userText == "" {
		t.Fatal("user retired after only one round")
	}
	s.Live["matrix"] = protocol.WorkspaceLive{BodyID: "b", Thought: "第二轮"}
	m.applySnapshot(pollMsg{data: s})
	if m.userText == "" {
		t.Fatal("fast work rounds retired user before readable dwell")
	}
}

func TestFeedbackFastTypingEnterSends(t *testing.T) {
	m := testModel()
	var got string
	m.session.Call = func(_ context.Context, method string, args, out any) error {
		if method == "matrix.send" {
			got = args.(map[string]any)["message"].(string)
		}
		return nil
	}
	for _, r := range "开始检查" {
		m.key(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
	}
	cmd := m.key(key(tea.KeyEnter))
	if cmd == nil {
		t.Fatal("ordinary fast typing swallowed Enter into a paste")
	}
	m.Update(cmd())
	if got != "开始检查" {
		t.Fatalf("sent %q", got)
	}
}

func TestFeedbackQueuedSendAndLostAckPreserveOrder(t *testing.T) {
	m := testModel()
	var texts, ids []string
	m.session.Call = func(_ context.Context, _ string, args, _ any) error {
		a := args.(map[string]any)
		texts = append(texts, a["message"].(string))
		ids = append(ids, a["request_id"].(string))
		if len(texts) == 1 {
			return errors.New("lost acknowledgment")
		}
		return nil
	}
	m.input.SetValue("原目标")
	first := m.submit()
	m.input.SetValue("补充一")
	if m.submit() != nil {
		t.Fatal("second send must wait for first acknowledgment")
	}
	m.input.SetValue("补充二")
	m.submit()
	m.input.SetValue("仍在编辑")
	m.Update(first())
	if m.input.Value() != "仍在编辑" || len(m.queuedSends) != 2 || m.failedSend == nil {
		t.Fatal("failure lost draft or queue")
	}
	m.input.Reset()
	cmd := m.submit()
	for cmd != nil {
		_, cmd = m.Update(cmd())
	}
	if strings.Join(texts, "/") != "原目标/原目标/补充一/补充二" || ids[0] != ids[1] || ids[2] == ids[3] {
		t.Fatalf("retry identity/order: %v %v", texts, ids)
	}
	if m.failedSend != nil || m.sending != nil || len(m.queuedSends) != 0 {
		t.Fatal("queue did not drain")
	}
}

func TestFeedbackAckDoesNotEraseNewIdenticalDraft(t *testing.T) {
	m := testModel()
	m.session.Call = func(context.Context, string, any, any) error { return nil }
	m.input.SetValue("继续")
	cmd := m.submit()
	m.input.SetValue("继续")
	m.Update(cmd())
	if m.input.Value() != "继续" {
		t.Fatal("late ack erased newly typed identical draft")
	}
	cmd = m.submit()
	if cmd == nil {
		t.Fatal("intentional same-text addition swallowed")
	}
}

func TestFeedbackBusySupplementSendsAndClearsOnlyDisplay(t *testing.T) {
	m := testModel()
	m.taskStarted, m.taskGeneration, m.snapshot.Busy = true, 7, true
	m.liveText, m.shownText = "OLD BODY", "OLD BODY"
	m.input.SetValue("补充：保留原目标并检查中文")
	var got string
	m.session.Call = func(_ context.Context, method string, args, out any) error {
		if method == "matrix.send" {
			got = args.(map[string]any)["message"].(string)
		}
		return nil
	}
	cmd := m.submit()
	if cmd == nil {
		t.Fatal("busy workspace rejected supplementary message")
	}
	if m.shownText != "" || !strings.Contains(m.View(), "OLD BODY") {
		t.Fatal("supplement must clear live presentation while retaining prior information flow")
	}
	m.Update(cmd())
	if got != "补充：保留原目标并检查中文" || m.taskGeneration != 7 || m.input.Value() != "" {
		t.Fatalf("supplement changed execution generation or failed: %q generation=%d draft=%q", got, m.taskGeneration, m.input.Value())
	}
}
