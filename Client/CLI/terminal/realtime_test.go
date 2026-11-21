// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestAPIViewFitsEveryViewportAndKeepsFocusedCaret; TestAPIFieldViewportKeepsCombinedGlyphsWhole; TestRealtimeShortViewportPrioritizesBodyAndKeepsCurrentCalls; TestAPIAsyncCancellationAndEpochIsolation; TestAPIModelFilterAndConnectionProvenance; TestRealtimeToolBudgetAndExpandedAttention; TestLongPlanCollapsesAndOldExpandedPlanRetires; TestUsageEstimatesAndIdleRendererCost; TestThoughtStreamingRespectsGraphemeBoundaries; BenchmarkIdleRealtimeView; BenchmarkStreamingRealtimeView
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/realtime_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/aieyra/aieyra-os/contracts/protocol"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
	"github.com/rivo/uniseg"
)

func TestAPIViewFitsEveryViewportAndKeepsFocusedCaret(t *testing.T) {
	m := testModel()
	prepareAPIForm(m)
	m.api.fields[1].SetValue("secret-NEVER-RENDER-this-value")
	for _, size := range [][2]int{{1, 1}, {2, 2}, {10, 3}, {18, 5}, {32, 8}, {80, 24}, {120, 40}} {
		m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		for group := 0; group < 5; group++ {
			m.api.group = group
			for focus := 0; focus < m.api.focusCount(); focus++ {
				m.api.focus = focus
				m.focusAPI()
				view := m.View()
				if strings.Contains(view, "NEVER-RENDER") || strings.Contains(view, "secret-") {
					t.Fatal("API Key rendered in cleartext")
				}
				rows := strings.Split(view, "\n")
				if len(rows) != size[1] {
					t.Fatalf("size %v group %d focus %d: got %d rows", size, group, focus, len(rows))
				}
				for _, row := range rows {
					if ansi.StringWidth(row) > size[0] {
						t.Fatalf("size %v group %d focus %d: row overflow %q", size, group, focus, row)
					}
				}
				up, col := m.caretCell()
				row := m.height - 1 - up
				if row < 0 || row >= size[1] || col < 0 || col >= size[0] {
					t.Fatalf("size %v group %d focus %d: cursor (%d,%d) outside viewport", size, group, focus, row, col)
				}
			}
		}
	}
}

func TestAPIFieldViewportKeepsCombinedGlyphsWhole(t *testing.T) {
	value := "A👩‍💻é❤️中XYZ"
	g := uniseg.NewGraphemes(value)
	var clusters []string
	for g.Next() {
		clusters = append(clusters, g.Str())
	}
	valid := map[string]bool{"": true}
	for from := range clusters {
		for to := from + 1; to <= len(clusters); to++ {
			valid[strings.Join(clusters[from:to], "")] = true
		}
	}
	field := textinput.New()
	field.SetValue(value)
	for width := 1; width <= 14; width++ {
		for at := 0; at <= len([]rune(value)); at++ {
			field.SetCursor(at)
			view, caret := apiFieldView(field, width)
			if !valid[view] || !utf8.ValidString(view) {
				t.Fatalf("width %d cursor %d split a glyph: %q", width, at, view)
			}
			if ansi.StringWidth(view) > width || caret < 0 || caret >= width {
				t.Fatalf("width %d cursor %d overflowed field: %q caret %d", width, at, view, caret)
			}
		}
	}
}

func TestRealtimeShortViewportPrioritizesBodyAndKeepsCurrentCalls(t *testing.T) {
	m := testModel()
	m.taskStarted = true
	m.shownThought = strings.Repeat("older thought\n", 40)
	m.shownText = "CURRENT BODY"
	m.activities = []activityView{{activity: activity{ID: "new", Tool: "NEW CALL", State: "running"}, appeared: time.Now().Add(-time.Second)}}
	for _, size := range [][2]int{{28, 8}, {48, 9}, {80, 12}, {100, 30}} {
		m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		view := m.View()
		if !strings.Contains(view, "CURRENT BODY") || !strings.Contains(view, "NEW CALL") {
			t.Fatalf("size %v hid current body or tool behind thoughts: %q", size, view)
		}
		rows := strings.Split(view, "\n")
		if len(rows) != size[1] {
			t.Fatalf("size %v produced %d rows", size, len(rows))
		}
		for _, row := range rows {
			if ansi.StringWidth(row) > size[0] {
				t.Fatalf("size %v overflowed row %q", size, row)
			}
		}
	}
	m.pinned = &activity{ID: "old", Tool: "OLDER DETAIL", Input: strings.Repeat("older output\n", 100)}
	view := m.View()
	if !strings.Contains(view, "OLDER DETAIL") || !strings.Contains(view, "NEW CALL") {
		t.Fatal("expanded detail hides new calls")
	}
	m.key(key(tea.KeyPgDown))
	view = m.View()
	if !strings.Contains(view, "NEW CALL") || !strings.Contains(view, "\x1b[38;5;240m") {
		t.Fatal("scrolled detail lost current calls or soft boundary")
	}
}

func TestAPIAsyncCancellationAndEpochIsolation(t *testing.T) {
	m := testModel()
	entered := make(chan struct{}, 2)
	m.opts.Settings = func(ctx context.Context, request protocol.TerminalSettingsRequest) (protocol.TerminalSettingsResponse, error) {
		entered <- struct{}{}
		<-ctx.Done()
		return protocol.TerminalSettingsResponse{}, ctx.Err()
	}
	load := m.openAPI()
	epoch := m.apiEpoch
	done := make(chan tea.Msg, 1)
	go func() { done <- load() }()
	<-entered
	m.apiKey(key(tea.KeyEsc))
	select {
	case msg := <-done:
		m.Update(msg)
	case <-time.After(time.Second):
		t.Fatal("closing API did not cancel load")
	}
	prepareAPIForm(m)
	m.api.fields[0].SetValue("fresh")
	m.api.request = 1
	m.Update(apiMsg{epoch: epoch, request: 1, action: "load", result: sharedResultForUI()})
	m.Update(apiPasteMsg{epoch: epoch, index: 0, text: "stale-key"})
	if m.api.fields[0].Value() != "fresh" {
		t.Fatal("stale async API result changed reopened form")
	}
	m.Update(apiPasteMsg{epoch: m.apiEpoch, schema: m.api.schema, index: 0, err: errors.New("clipboard unavailable")})
	if m.api.notice != "clipboard unavailable" {
		t.Fatal("clipboard error was hidden")
	}
	if m.api.cancel != nil {
		m.api.cancel()
	}
	prepareAPIForm(m)
	test := m.runAPI("test")
	go func() { done <- test() }()
	<-entered
	m.apiKey(key(tea.KeyEsc))
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("closing API did not cancel test")
	}
}

func TestAPIModelFilterAndConnectionProvenance(t *testing.T) {
	m := testModel()
	prepareAPIForm(m)
	m.api.group, m.api.focus = 1, 0
	m.apiKey(key(tea.KeyRight))
	if m.api.fields[2].Value() != "" || m.api.fields[1].Value() != "" || m.api.draft.ProfileID != "" {
		t.Fatal("provider switch retained stale profile identity or credential")
	}
	models := []settingsModel{{ID: "fixture-a", Name: "Alpha", Protocol: "responses", ContextWindow: json.RawMessage("32768")}, {ID: "fixture-q", Name: "Qwen Test", Protocol: "chat_completions", ContextWindow: json.RawMessage("1000000"), ReferenceOnly: true}}
	m.api.pending, m.api.request = true, 1
	m.completeAPI(apiMsg{epoch: m.apiEpoch, request: 1, action: "catalog", result: settingsResult{OK: true, Version: "fixture-v1", Models: models, Total: len(models)}})
	m.apiKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("QWEN")})
	if len(m.api.choices) != 1 || m.api.choices[0].ID != "fixture-q" {
		t.Fatal("model filter must match names case-insensitively")
	}
	m.apiKey(key(tea.KeyEnter))
	if m.api.fields[2].Value() != "fixture-q" || m.api.fields[3].Value() != "chat_completions" {
		t.Fatal("selected catalog protocol was lost")
	}
	m.api.pending, m.api.request = true, 2
	m.completeAPI(apiMsg{epoch: m.apiEpoch, request: 2, action: "catalog", result: settingsResult{OK: true, Version: "fixture-v1", Models: models, Total: len(models)}})
	m.apiKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("unmatched")})
	m.apiKey(key(tea.KeyDown))
	m.apiKey(key(tea.KeyEnter))
	if !strings.Contains(m.View(), "没有匹配模型") || m.api.selected < 0 {
		t.Fatal("empty model search is not usable")
	}
	m.apiKey(key(tea.KeyCtrlU))
	if len(m.api.choices) != len(models) {
		t.Fatal("clear search did not restore catalog")
	}
}

func TestRealtimeToolBudgetAndExpandedAttention(t *testing.T) {
	m := testModel()
	m.taskStarted, m.taskGeneration = true, 3
	var roles []role
	for i := 0; i < 2; i++ {
		r := role{ID: fmt.Sprintf("worker%d", i), Generation: 3}
		for n := 0; n < 4; n++ {
			r.Activity.Items = append(r.Activity.Items, activity{ID: fmt.Sprintf("call%d", 2*n+i), Tool: "shell", State: "running", Generation: 3, StartedAt: int64(2*n + i), Sequence: int64(2*n + i), Command: "echo detail"})
		}
		r.Activity.Items = append(r.Activity.Items, activity{ID: "hidden", Hidden: true, Generation: 3, StartedAt: 100}, activity{ID: "old", Generation: 2, StartedAt: 200})
		roles = append(roles, r)
	}
	m.snapshot.Roles = roles
	m.syncActivities()
	items := m.activeActivities()
	if len(items) != 3 || items[0].ID != "call5" || items[2].ID != "call7" {
		t.Fatal("tools not limited globally to latest three", items)
	}
	m.key(tea.KeyMsg{Type: tea.KeyRunes, Alt: true, Runes: []rune{'1'}})
	if m.pinned == nil || m.pinned.ID != "call5" {
		t.Fatal("tool detail could not be expanded")
	}
	for i := range m.snapshot.Roles {
		for j := range m.snapshot.Roles[i].Activity.Items {
			if m.snapshot.Roles[i].Activity.Items[j].ID == "call5" {
				m.snapshot.Roles[i].Activity.Items[j].State = "completed"
			}
		}
	}
	m.syncActivities()
	if m.pinned.State != "completed" {
		t.Fatal("expanded activity status stopped updating")
	}
	m.snapshot.Roles = nil
	m.syncActivities()
	m.clearLive()
	if m.pinned == nil || !strings.Contains(m.View(), "echo detail") {
		t.Fatal("user attention detail retired before close")
	}
	m.snapshot.Busy = true
	m.session.Call = func(context.Context, string, any, any) error { t.Fatal("closing detail canceled task"); return nil }
	if cmd := m.key(key(tea.KeyEsc)); cmd != nil || m.pinned != nil {
		t.Fatal("Esc did not close only expanded detail")
	}
}

func TestLongPlanCollapsesAndOldExpandedPlanRetires(t *testing.T) {
	m := testModel()
	m.taskStarted, m.taskGeneration = true, 1
	var s snapshot
	if err := json.Unmarshal([]byte(`{"plan":{"objective":"旧计划","status":"running","phases":[{"steps":[{"text":"第一行\n第二行很长的计划","status":"in_progress"}]}]},"plan_scope":{"generation":1}}`), &s); err != nil {
		t.Fatal(err)
	}
	m.snapshot = s
	m.snapshot.Busy = true
	if line := m.planLine(); strings.Contains(line, "\n") || !strings.Contains(line, "第一行 第二行") {
		t.Fatal("plan is not one line", line)
	}
	m.key(tea.KeyMsg{Type: tea.KeyRunes, Alt: true, Runes: []rune{'p'}})
	s.Plan = &livePlan{Objective: "新计划"}
	s.PlanScope.Generation = 2
	s.Busy = true
	m.applySnapshot(pollMsg{data: s})
	if m.planExpanded || m.pinnedPlan != nil || strings.Contains(m.View(), "旧计划") {
		t.Fatal("old expanded plan survived new generation")
	}
	m.key(key(tea.KeyEsc))
	if m.planExpanded || m.pinnedPlan != nil {
		t.Fatal("expanded plan was not dismissed")
	}
}

func TestUsageEstimatesAndIdleRendererCost(t *testing.T) {
	m := testModel()
	m.snapshot.Model = "qwen3.8-flash"
	m.snapshot.Roles = []role{{ID: "matrix", Usage: usage{Estimated: 1, Input: 680000, Output: 15000}}}
	line := ansi.Strip(m.metricsLine())
	if !strings.Contains(line, "QWEN3.8-FLASH") || !strings.Contains(line, "680.0k~") || !strings.Contains(line, "缓存 —") {
		t.Fatal("estimated usage lost its provenance or unknown cache", line)
	}
	m.snapshot.Roles[0].Usage = usage{Reported: 1, Complete: true, Input: 20, Output: 5, CacheKnown: true, CacheInput: 20, Cached: 0}
	if line = ansi.Strip(m.metricsLine()); !strings.Contains(line, "缓存 0%") || strings.Contains(line, "~") {
		t.Fatal("known zero cache rendered as unknown", line)
	}
	out := &capture{}
	s := &screen{model: m, out: out}
	m.shownThought = strings.Repeat("👩‍💻 smooth thought é ❤️\n", 1600)
	m.shownText = strings.Repeat("Current body\n", 200)
	s.draw()
	count := len(out.text())
	for i := 0; i < 100; i++ {
		m.frame++
		s.draw()
	}
	if len(out.text()) != count {
		t.Fatal("idle renderer wrote unchanged terminal bytes")
	}
}

func TestThoughtStreamingRespectsGraphemeBoundaries(t *testing.T) {
	target := strings.Repeat("👩‍💻 é ❤️ 🐈 中文", 600)
	boundaries := map[int]bool{0: true}
	g := uniseg.NewGraphemes(target)
	for g.Next() {
		_, end := g.Positions()
		boundaries[end] = true
	}
	shown := ""
	for n := 0; shown != target && n < 120; n++ {
		previous := shown
		shown = advanceText(shown, target, 32*time.Millisecond)
		if shown == previous || !boundaries[len(shown)] || !utf8.ValidString(shown) {
			t.Fatal("streaming paused or split a grapheme")
		}
		if n == 0 && len(target)-len(shown) > 4096 {
			t.Fatal("large chunk retained excessive animation backlog")
		}
	}
	if shown != target {
		t.Fatal("stream did not catch up")
	}
	large := strings.Repeat("👩‍💻 é ❤️", 10000)
	bounded := boundedText(large)
	if len(bounded) > (48<<10)+4 || !utf8.ValidString(bounded) {
		t.Fatal("display tail exceeded its byte budget")
	}
	tail := strings.TrimPrefix(bounded, "…\n")
	cutoff := len(large) - len(tail)
	g = uniseg.NewGraphemes(large)
	found := false
	for g.Next() {
		left, _ := g.Positions()
		if left == cutoff {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("bounded display starts inside grapheme")
	}
}

func BenchmarkIdleRealtimeView(b *testing.B) {
	m := testModel()
	m.shownText = strings.Repeat("正文 current body 中文\n", 1300)
	m.shownThought = strings.Repeat("thought é 👩‍💻 中文\n", 1300)
	m.View()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.View()
	}
}

func BenchmarkStreamingRealtimeView(b *testing.B) {
	m := testModel()
	base := strings.Repeat("thought é 👩‍💻 中文\n", 1300)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.shownThought = base + fmt.Sprint(i)
		m.View()
	}
}
