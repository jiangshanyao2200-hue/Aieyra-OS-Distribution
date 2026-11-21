// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestToolOriginalReceiptPagesOnlyOnUserRequest; TestToolReceiptCloseCancelsAndRejectsLateResult; TestToolDetailFallbackShowsNonShellPreview; TestToolReceiptCompletesOnceWithoutMovingReadingPosition; TestToolReceiptCompletionWaitsForPendingRead; TestToolDetailCacheAndNarrowPagingHint; TestToolIDsFromDifferentAgentsRemainDistinct; BenchmarkExpandedReceiptView
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/receipt_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
)

func TestToolOriginalReceiptPagesOnlyOnUserRequest(t *testing.T) {
	m := testModel()
	m.pinned = &activity{ID: "call", AgentID: "agent", Tool: "exec", State: "completed"}
	m.resetReceipt()
	calls := 0
	m.session.Call = func(ctx context.Context, method string, input, reply any) error {
		calls++
		if method != "workspace.receipt" {
			t.Fatal(method)
		}
		r := input.(map[string]any)
		if r["agent_id"] != "agent" || r["id"] != "call" {
			t.Fatal("receipt target changed", r)
		}
		if deadline, ok := ctx.Deadline(); !ok || time.Until(deadline) > 6*time.Second {
			t.Fatal("receipt read has no bounded deadline")
		}
		at := r["output_offset"].(int)
		v := reply.(*toolReceipt)
		switch at {
		case 0:
			if r["input_offset"] != 0 {
				t.Fatal(r)
			}
			*v = toolReceipt{Input: "original args", Output: "FIRST OUTPUT", InputSize: 13, OutputSize: 120000, NextOutput: 65536}
		case 65536:
			if r["input_offset"] != 13 {
				t.Fatal("completed input repeated", r)
			}
			*v = toolReceipt{Output: "SECOND OUTPUT", InputSize: 13, OutputSize: 120000}
		default:
			t.Fatal("unexpected offset", r)
		}
		return nil
	}
	m.Update(m.loadReceipt()())
	if calls != 1 || !strings.Contains(m.View(), "original args") || !strings.Contains(m.View(), "FIRST OUTPUT") {
		t.Fatal("original receipt not shown")
	}
	for i := 0; i < 10; i++ {
		m.Update(pulseMsg{})
		m.View()
	}
	if calls != 1 {
		t.Fatal("idle display automatically fetched receipt")
	}
	next := m.key(tea.KeyMsg{Type: tea.KeyRight, Alt: true})
	if next == nil || !m.receiptPending || m.receipt != nil {
		t.Fatal("next segment not requested explicitly")
	}
	m.Update(next())
	if calls != 2 || !strings.Contains(m.View(), "SECOND OUTPUT") || strings.Contains(m.View(), "FIRST OUTPUT") {
		t.Fatal("segment not replaced")
	}
	if cmd := m.key(tea.KeyMsg{Type: tea.KeyRight, Alt: true}); cmd != nil {
		t.Fatal("read beyond last segment")
	}
	previous := m.key(tea.KeyMsg{Type: tea.KeyLeft, Alt: true})
	if previous == nil {
		t.Fatal("previous segment unavailable")
	}
	m.Update(previous())
	if calls != 3 || !strings.Contains(m.View(), "FIRST OUTPUT") {
		t.Fatal("previous segment not restored")
	}
	refresh := m.key(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'r'}, Alt: true})
	if refresh == nil {
		t.Fatal("explicit refresh unavailable")
	}
	m.Update(refresh())
	if calls != 4 {
		t.Fatal("refresh skipped")
	}
}

func TestToolReceiptCloseCancelsAndRejectsLateResult(t *testing.T) {
	m := testModel()
	m.pinned = &activity{ID: "call", AgentID: "agent", Tool: "exec"}
	m.resetReceipt()
	entered := make(chan context.Context, 1)
	m.session.Call = func(ctx context.Context, _ string, _, _ any) error { entered <- ctx; <-ctx.Done(); return ctx.Err() }
	cmd := m.loadReceipt()
	oldEpoch := m.receiptEpoch
	done := make(chan tea.Msg, 1)
	go func() { done <- cmd() }()
	<-entered
	m.key(key(tea.KeyEsc))
	select {
	case msg := <-done:
		m.Update(msg)
	case <-time.After(time.Second):
		t.Fatal("close did not cancel read")
	}
	m.pinned = &activity{ID: "call", AgentID: "agent", Tool: "exec"}
	m.Update(receiptMsg{epoch: oldEpoch, session: m.epoch, id: "call", agent: "agent", data: toolReceipt{Output: "STALE"}})
	if m.receipt != nil || strings.Contains(m.View(), "STALE") {
		t.Fatal("late data revived dismissed detail")
	}
	m.session.Call = func(context.Context, string, any, any) error { return errors.New("receipt unavailable") }
	m.Update(m.loadReceipt()())
	if !strings.Contains(m.View(), "receipt unavailable") || m.receiptPending {
		t.Fatal("read error not visible or retry blocked")
	}
	m.session.Call = func(_ context.Context, _ string, _, reply any) error {
		*reply.(*toolReceipt) = toolReceipt{Pending: true}
		return nil
	}
	m.Update(m.loadReceipt()())
	if !strings.Contains(m.View(), "收据尚未写入") {
		t.Fatal("pending receipt misreported as complete")
	}
}

func TestToolDetailFallbackShowsNonShellPreview(t *testing.T) {
	m := testModel()
	m.pinned = &activity{ID: "call", Tool: "read_file", Preview: []byte(`{"text":"file contents 中文"}`)}
	if !strings.Contains(m.View(), "file contents 中文") {
		t.Fatal("non-shell output hidden")
	}
	m.pinned.Preview = []byte(`{"ok":true,"files":["source.go"]}`)
	if !strings.Contains(m.View(), "source.go") {
		t.Fatal("structured output hidden")
	}
}

func TestToolReceiptCompletesOnceWithoutMovingReadingPosition(t *testing.T) {
	m := testModel()
	m.taskStarted, m.taskGeneration = true, 1
	m.pinned = &activity{ID: "call", AgentID: "agent", Tool: "exec", State: "running", Generation: 1}
	m.resetReceipt()
	calls := 0
	m.session.Call = func(_ context.Context, method string, _, reply any) error {
		if method != "workspace.receipt" {
			t.Fatal(method)
		}
		calls++
		*reply.(*toolReceipt) = toolReceipt{Output: strings.Repeat("original output\n", 80), OutputSize: 1280}
		return nil
	}
	m.Update(m.loadReceipt()())
	m.detailOffset = 12
	r := role{ID: "agent", Generation: 1}
	r.Activity.Items = []activity{{ID: "call", State: "completed", Generation: 1}}
	m.snapshot.Roles = []role{r}
	m.syncActivities()
	refresh := m.refreshCompletedReceipt()
	if refresh == nil {
		t.Fatal("running detail missed final receipt")
	}
	m.Update(refresh())
	if calls != 2 || m.detailOffset != 12 {
		t.Fatal("completion read moved reading position", calls, m.detailOffset)
	}
	m.syncActivities()
	if m.refreshCompletedReceipt() != nil {
		t.Fatal("completed tool fetched repeatedly")
	}
	m.clearLive()
	if m.receipt == nil || m.pinned == nil {
		t.Fatal("task transition discarded user attention")
	}
}

func TestToolReceiptCompletionWaitsForPendingRead(t *testing.T) {
	m := testModel()
	m.pinned = &activity{ID: "call", AgentID: "agent", Tool: "exec", State: "running"}
	m.resetReceipt()
	calls := 0
	m.session.Call = func(_ context.Context, _ string, _, reply any) error {
		calls++
		*reply.(*toolReceipt) = toolReceipt{Output: "receipt"}
		return nil
	}
	first := m.loadReceipt()
	m.receiptRefresh = true
	if m.refreshCompletedReceipt() != nil {
		t.Fatal("concurrent duplicate receipt read")
	}
	_, follow := m.Update(first())
	if follow == nil {
		t.Fatal("pending final refresh lost")
	}
	m.Update(follow())
	if calls != 2 || m.receiptRefresh {
		t.Fatal("completion refresh loop", calls)
	}
}

func TestToolDetailCacheAndNarrowPagingHint(t *testing.T) {
	m := testModel()
	m.pinned = &activity{ID: "call", AgentID: "agent", Tool: "exec", State: "completed"}
	m.receipt = &toolReceipt{Input: strings.Repeat("input\t👩‍💻\n", 3000), Output: strings.Repeat("output 中文\n", 4000), NextOutput: 65536}
	first := m.detailLines()
	for i := 0; i < 100; i++ {
		rows := m.detailLines()
		if &rows[0] != &first[0] {
			t.Fatal("unchanged large receipt was rewrapped")
		}
	}
	m.pinned.State = "timed_out"
	if !strings.Contains(m.detailLines()[0], "已超时") {
		t.Fatal("changed execution state left stale detail")
	}
	m.receipt = &toolReceipt{Output: "replacement", NextOutput: 65536}
	if !strings.Contains(strings.Join(m.detailLines(), "\n"), "replacement") {
		t.Fatal("new receipt did not invalidate detail")
	}
	m.receiptPage = 1
	for _, width := range []int{24, 32, 52, 80, 120} {
		m.width = width
		hint := m.detailHint()
		if ansi.StringWidth(hint) > width || !strings.Contains(hint, "Alt+←") || !strings.Contains(hint, "Alt+→") {
			t.Fatal("paging keys truncated", width, hint)
		}
		for _, row := range m.detailLines() {
			if ansi.StringWidth(row) > width-2 {
				t.Fatal("detail failed resize", width, row)
			}
		}
	}
}

func TestToolIDsFromDifferentAgentsRemainDistinct(t *testing.T) {
	m := testModel()
	m.taskStarted, m.taskGeneration = true, 1
	m.snapshot.Busy = true
	for _, id := range []string{"agent-one", "agent-two"} {
		r := role{ID: id, Generation: 1}
		r.Activity.Items = []activity{{ID: "same-call", Tool: id, State: "completed", Generation: 1}}
		m.snapshot.Roles = append(m.snapshot.Roles, r)
	}
	m.syncActivities()
	m.key(tea.KeyMsg{Type: tea.KeyRunes, Alt: true, Runes: []rune{'1'}})
	if m.pinned == nil || m.pinned.AgentID != "agent-one" {
		t.Fatal("first agent not selected")
	}
	m.key(tea.KeyMsg{Type: tea.KeyRunes, Alt: true, Runes: []rune{'2'}})
	if m.pinned == nil || m.pinned.AgentID != "agent-two" {
		t.Fatal("shared call ID toggled wrong tool")
	}
}

func BenchmarkExpandedReceiptView(b *testing.B) {
	m := testModel()
	m.pinned = &activity{ID: "call", AgentID: "agent", Tool: "exec", State: "completed"}
	m.receipt = &toolReceipt{Input: strings.Repeat("input 👩‍💻\n", 4000), Output: strings.Repeat("output 中文\n", 4000)}
	m.View()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.View()
	}
}
