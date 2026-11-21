// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: testModel; key; TestInputWrapAndCaretMatchTextarea; TestCancellationStaysBoundToOriginalTaskGeneration; TestShortPastePreservesUnicodeTabsAndNewlines; TestPasteFoldingRoundTripAndAtomicEdits; TestPasteTimerClearAndClipboardIsolation; TestTerminalControlSanitization; TestSlashMenuKeyboardAndMultiline; TestSessionSwitchRetainsInFlightDraft; TestTaskSwitchPreservesImmediateAPICommand; TestImmediateSwitchMessageWaitsForDestinationGeneration; TestFailedTaskSwitchPreservesInputWithoutSending; TestSubmissionOrderingAndStableRetry; TestCurrentDocumentAndHumanBinding; TestRendererCurrentScreenResizeAndCaret; capture; Write; text; await; TestActualProgramKeyboardPasteAndRestore
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/terminal_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aieyra/aieyra-os/contracts/protocol"
	"github.com/charmbracelet/bubbles/textarea"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
)

func testModel() *model {
	m := newModel(context.Background(), protocol.TerminalOptions{Version: "test", Session: protocol.TerminalSession{ID: "session-one"}})
	m.snapshot.SessionID = m.session.ID
	m.layout()
	return m
}
func key(t tea.KeyType) tea.KeyMsg { return tea.KeyMsg{Type: t} }

func TestInputWrapAndCaretMatchTextarea(t *testing.T) {
	for _, width := range []int{10, 20, 33, 68} {
		for _, text := range []string{"", "短的", strings.Repeat("很长的输入内容", 9), strings.Repeat("x", 45), "中英 mixed content 测试", strings.Repeat("👩‍💻 é ❤️ 🐈 ", 9)} {
			ta := textarea.New()
			ta.ShowLineNumbers, ta.Prompt, ta.CharLimit = false, "", 0
			ta.SetWidth(width)
			ta.SetValue(text)
			want := ta.LineInfo().Height
			if got := len(wrapInputLine([]rune(text), width)); got != want {
				t.Errorf("width=%d text=%q rows=%d want=%d", width, text, got, want)
			}
			m := testModel()
			m.width = width + 4
			m.layout()
			m.input.SetValue(text)
			for i := 0; i <= len([]rune(text)); i++ {
				m.setInputAt(text, i)
				row, col := m.inputCaret()
				li := m.input.LineInfo()
				if row != li.RowOffset || col != li.CharOffset {
					t.Fatal("caret diverged from textarea")
				}
			}
		}
	}
}

func TestCancellationStaysBoundToOriginalTaskGeneration(t *testing.T) {
	m := testModel()
	var method string
	var args any
	m.session.Call = func(_ context.Context, name string, a, reply any) error { method, args = name, a; return nil }
	if err := json.Unmarshal([]byte(`{"session_id":"session-one","busy":true,"requests":[{"request_id":"done","state":"completed"},{"request_id":"bound-request","state":"running","generation":4}]}`), &m.snapshot); err != nil {
		t.Fatal(err)
	}
	cmd := m.cancelTask()
	if cmd == nil {
		t.Fatal("missing cancellation")
	}
	m.session = protocol.TerminalSession{ID: "another", Call: func(context.Context, string, any, any) error { t.Fatal("cancel crossed sessions"); return nil }}
	m.epoch++
	m.Update(cmd())
	if method != "matrix.cancel" || args.(map[string]any)["request_id"] != "bound-request" || args.(map[string]any)["generation"] != 4 {
		t.Fatal(method, args)
	}
	if m.notice != "" {
		t.Fatal("stale cancellation altered new session")
	}
}

func TestShortPastePreservesUnicodeTabsAndNewlines(t *testing.T) {
	for _, text := range []string{"\tif 中文 {\n\t\t👩‍💻 é ❤️\n}\n", "👩‍💻 é ❤️\n", "\t", "\n\n"} {
		m := testModel()
		m.handlePaste(text)
		if got := m.expandPastes(m.input.Value()); got != text {
			t.Fatalf("paste changed: got %q want %q", got, text)
		}
	}
	m := testModel()
	m.handlePaste(strings.Repeat("x", 201))
	literal := m.pastes[0].token
	m.setInputAt(m.input.Value(), 0)
	m.handlePaste(literal)
	if got := m.expandPastes(m.input.Value()); got != literal+strings.Repeat("x", 201) {
		t.Fatalf("literal label expanded: %q", got)
	}
}

func TestPasteFoldingRoundTripAndAtomicEdits(t *testing.T) {
	text := strings.Repeat("汉字 👩‍💻 text\t", 30) + "\n\n"
	m := testModel()
	m.handlePaste(text)
	if len(m.pastes) != 1 || m.expandPastes(m.input.Value()) != text {
		t.Fatal("paste did not roundtrip")
	}
	token := m.input.Value()
	m.key(key(tea.KeyLeft))
	if m.inputOffset() != 0 {
		t.Fatal("left must cross entire block")
	}
	m.key(key(tea.KeyRight))
	if m.inputOffset() != len([]rune(token)) {
		t.Fatal("right must cross entire block")
	}
	m.key(key(tea.KeyBackspace))
	if m.input.Value() != "" || len(m.pastes) != 0 {
		t.Fatal("partial block deletion")
	}
	m.handlePaste(text)
	m.key(key(tea.KeyCtrlW))
	if m.input.Value() != "" || len(m.pastes) != 0 {
		t.Fatal("word deletion left a partial block")
	}
	m.handlePaste(text)
	m.handlePaste("literal " + m.pastes[0].token + strings.Repeat("x", 201))
	if got := m.expandPastes(m.input.Value()); !strings.HasPrefix(got, text+"literal [已粘贴") {
		t.Fatal("nested expansion", got)
	}
}

func TestPasteTimerClearAndClipboardIsolation(t *testing.T) {
	m := testModel()
	m.bufferInput("abc")
	epoch := m.pasteEpoch
	m.key(key(tea.KeyCtrlU))
	m.Update(pasteSettleMsg{epoch: epoch})
	if m.input.Value() != "" {
		t.Fatal("late timer resurrected cleared text")
	}
	m.Update(clipboardResult{clipboardTextMsg{"late", nil}, m.epoch, m.inputEpoch - 1})
	m.Update(clipboardResult{clipboardTextMsg{"late", nil}, m.epoch - 1, m.inputEpoch})
	if m.input.Value() != "" {
		t.Fatal("late clipboard modified new draft")
	}
	m.Update(clipboardResult{clipboardTextMsg{"current", nil}, m.epoch, m.inputEpoch})
	if m.input.Value() != "current" {
		t.Fatal("current clipboard was lost")
	}
}

func TestTerminalControlSanitization(t *testing.T) {
	raw := "A\x1b[2JB\x1b]52;c;bad\aC\x1bPpayload\x1b\\D\u009b31mE\r\n👩‍💻\n"
	clean, ok := sanitizePaste(raw)
	if !ok || clean != "ABCDE\n👩‍💻\n" {
		t.Fatalf("%q", clean)
	}
}

func TestSlashMenuKeyboardAndMultiline(t *testing.T) {
	m := testModel()
	m.snapshot.Tasks = []taskView{{ID: "session-one", Title: "Eyra", Primary: true}, {ID: "split-two", Title: "验证工具", State: "running"}}
	selected := ""
	m.opts.Open = func(_ context.Context, id string) (protocol.TerminalSession, error) {
		selected = id
		return protocol.TerminalSession{ID: id}, nil
	}
	m.handlePaste("/")
	if len(m.menuItems()) != 2 || strings.Contains(m.View(), "API Key") || !strings.Contains(m.View(), "验证工具") {
		t.Fatal("slash must display tasks only")
	}
	m.key(key(tea.KeyDown))
	cmd := m.key(key(tea.KeyTab))
	if cmd == nil {
		t.Fatal("missing task selection")
	}
	m.Update(cmd())
	if selected != "split-two" || m.input.Value() != "" {
		t.Fatal("task selection", selected, m.input.Value())
	}
	m.Update(pollMsg{epoch: m.epoch, version: m.actionVersion, data: snapshot{SessionID: "split-two"}})
	m.key(key(tea.KeyCtrlU))
	m.handlePaste("/ap")
	if len(m.menuItems()) != 0 {
		t.Fatal("API completion appeared in task menu")
	}
	m.key(key(tea.KeyEsc))
	if len(m.menuItems()) != 0 {
		t.Fatal("escape")
	}
	m.key(key(tea.KeyCtrlU))
	m.handlePaste("one")
	m.key(key(tea.KeyCtrlJ))
	m.handlePaste("two")
	if m.input.Value() != "one\ntwo" {
		t.Fatalf("newline: %q", m.input.Value())
	}
}

func TestSessionSwitchRetainsInFlightDraft(t *testing.T) {
	m := testModel()
	m.opts.Open = func(context.Context, string) (protocol.TerminalSession, error) {
		return protocol.TerminalSession{ID: "two"}, nil
	}
	m.handlePaste("draft")
	cmd := m.open("two")
	m.bufferInput(" typed while opening")
	m.Update(cmd())
	if m.drafts["session-one"].value != "draft typed while opening" {
		t.Fatal("late edits lost", m.drafts)
	}
	old := m.epoch
	m.Update(pollMsg{epoch: old - 1, data: snapshot{SessionID: "wrong"}})
	if m.snapshot.SessionID != "" {
		t.Fatal("old poll crossed session")
	}
	m.opts.Open = func(context.Context, string) (protocol.TerminalSession, error) {
		return protocol.TerminalSession{ID: "session-one"}, nil
	}
	cmd = m.open("session-one")
	m.Update(cmd())
	if m.input.Value() != "draft typed while opening" {
		t.Fatal("draft restore")
	}
}

func TestTaskSwitchPreservesImmediateAPICommand(t *testing.T) {
	m := testModel()
	m.opts.Open = func(context.Context, string) (protocol.TerminalSession, error) {
		return protocol.TerminalSession{ID: "split-two"}, nil
	}
	cmd := m.open("split-two")
	m.key(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("/")})
	m.Update(cmd())
	for _, r := range "api" {
		m.key(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
	}
	m.key(key(tea.KeyEnter))
	m.Update(pollMsg{epoch: m.epoch, version: m.actionVersion, data: snapshot{SessionID: "split-two"}})
	if m.api == nil || m.session.ID != "split-two" || m.drafts["session-one"].value != "" {
		t.Fatalf("command crossed tasks: api=%v task=%s drafts=%v", m.api != nil, m.session.ID, m.drafts)
	}
}

func TestImmediateSwitchMessageWaitsForDestinationGeneration(t *testing.T) {
	m := testModel()
	m.opts.Open = func(context.Context, string) (protocol.TerminalSession, error) {
		return protocol.TerminalSession{ID: "split-two"}, nil
	}
	cmd := m.open("split-two")
	m.key(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("for split only"), Paste: true})
	m.key(key(tea.KeyEnter))
	m.Update(cmd())
	if m.sending != nil || !m.opening {
		t.Fatal("input acted before destination snapshot")
	}
	m.Update(pollMsg{epoch: m.epoch, version: m.actionVersion, data: snapshot{SessionID: "split-two", Roles: []role{{Role: "matrix", Generation: 7}}}})
	if m.opening || m.session.ID != "split-two" || m.sending == nil || m.sending.text != "for split only" || m.taskGeneration != 7 {
		t.Fatalf("input lost destination: task=%s generation=%d sending=%v", m.session.ID, m.taskGeneration, m.sending)
	}
}

func TestFailedTaskSwitchPreservesInputWithoutSending(t *testing.T) {
	m := testModel()
	calls := 0
	m.session.Call = func(context.Context, string, any, any) error { calls++; return nil }
	m.opts.Open = func(context.Context, string) (protocol.TerminalSession, error) {
		return protocol.TerminalSession{}, errors.New("task unavailable")
	}
	cmd := m.open("split-two")
	m.key(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("task-specific message"), Paste: true})
	m.key(key(tea.KeyEnter))
	m.key(key(tea.KeyEsc))
	m.Update(cmd())
	if calls != 0 || m.session.ID != "session-one" || m.input.Value() != "task-specific message" || m.opening {
		t.Fatalf("failed switch dispatched or lost input: calls=%d task=%s draft=%q", calls, m.session.ID, m.input.Value())
	}
}

func TestSubmissionOrderingAndStableRetry(t *testing.T) {
	m := testModel()
	var ids []string
	m.session.Call = func(_ context.Context, method string, args, reply any) error {
		ids = append(ids, args.(map[string]any)["request_id"].(string))
		if len(ids) == 1 {
			return errors.New("uncertain transport")
		}
		return nil
	}
	m.handlePaste("message")
	old := pollMsg{epoch: m.epoch, version: m.actionVersion, data: snapshot{SessionID: m.session.ID}}
	cmd := m.submit()
	if cmd == nil {
		t.Fatal("missing send")
	}
	m.Update(cmd())
	if m.input.Value() != "message" {
		t.Fatal("failed send discarded draft")
	}
	cmd = m.submit()
	m.Update(cmd())
	if len(ids) != 2 || ids[0] != ids[1] {
		t.Fatal("retry used a new identity", ids)
	}
	m.Update(old)
	if !m.snapshot.Busy {
		t.Fatal("old idle poll reopened submission")
	}
	m.handlePaste("next")
	next := m.submit()
	if next == nil {
		t.Fatal("supplement rejected while core busy")
	}
	m.Update(next())
	m.Update(pollMsg{epoch: m.epoch, version: m.actionVersion, data: snapshot{SessionID: m.session.ID}})
	if m.snapshot.Busy {
		t.Fatal("fresh idle snapshot ignored")
	}
}

func TestCurrentDocumentAndHumanBinding(t *testing.T) {
	m := testModel()
	m.taskStarted = true
	m.applySnapshot(pollMsg{data: snapshot{SessionID: m.session.ID, Messages: []message{{ID: "a", From: "matrix", DocumentID: "full"}}}, docs: map[string]string{"full": "full document\nbody"}})
	if m.shownText != "full document\nbody" {
		t.Fatal("current document omitted")
	}
	m.applySnapshot(pollMsg{data: snapshot{SessionID: m.session.ID, Messages: []message{{ID: "b", From: "matrix", Text: "new body"}}}})
	for i := 0; i < 8; i++ {
		m.View()
		m.animatePresentation(32 * time.Millisecond)
	}
	if m.shownText != "new body" || len(m.documents) != 0 || len(m.messages) != 1 {
		t.Fatal("old body retained")
	}
	var got map[string]any
	m.session.Call = func(_ context.Context, _ string, args, reply any) error { got = args.(map[string]any); return nil }
	h := human{ID: "question", SessionID: "bound", AgentID: "matrix", Version: 7, Generation: 3, Token: "token"}
	cmd := m.reply(h, "answer")
	m.Update(cmd())
	for k, v := range map[string]any{"human_id": "question", "session_id": "bound", "agent_id": "matrix", "expected_request_version": 7, "generation": 3, "request_token_sha256": "token"} {
		if got[k] != v {
			t.Fatalf("%s = %#v", k, got[k])
		}
	}
}

func TestRendererCurrentScreenResizeAndCaret(t *testing.T) {
	m := testModel()
	m.taskStarted = true
	v := newVTerm(80, 24)
	_, _ = v.Write([]byte("\x1b[?1049h"))
	s := &screen{model: m, out: v}
	m.screen = s
	for i := 0; i < 120; i++ {
		m.shownText += fmt.Sprintf("LIVE%03d current content\n", i)
	}
	s.draw()
	check := func() {
		t.Helper()
		all := strings.Join(v.snapshot(), "\n")
		if !strings.Contains(all, "LIVE119") || strings.Contains(all, "LIVE000") || v.scrollbackText() != "" {
			t.Fatal("current screen leaked history", all)
		}
	}
	check()
	m.handlePaste("abcdef")
	s.draw()
	before := v.col
	m.key(key(tea.KeyLeft))
	s.draw()
	if v.col != before-1 {
		t.Fatal("caret did not move on unchanged text")
	}
	for _, size := range [][2]int{{45, 15}, {110, 32}, {70, 20}} {
		v.resize(size[0], size[1])
		m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		s.draw()
		check()
	}
	for _, size := range [][2]int{{1, 1}, {2, 2}, {10, 3}} {
		v.resize(size[0], size[1])
		m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		s.draw()
		if v.row < 0 || v.row >= size[1] || v.col < 0 || v.col >= size[0] {
			t.Fatal("caret outside tiny viewport")
		}
	}
}

type capture struct {
	mu sync.Mutex
	strings.Builder
}

func (c *capture) Write(p []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.Builder.Write(p)
}
func (c *capture) text() string { c.mu.Lock(); defer c.mu.Unlock(); return c.Builder.String() }
func await(t *testing.T, f func() bool) {
	t.Helper()
	until := time.Now().Add(5 * time.Second)
	for time.Now().Before(until) {
		if f() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("timed out")
}

func TestActualProgramKeyboardPasteAndRestore(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	m := testModel()
	m.ctx = ctx
	sent := make(chan string, 1)
	m.session.Call = func(_ context.Context, name string, args, out any) error {
		var value any = map[string]any{}
		switch name {
		case "workspace.snapshot":
			value = map[string]any{"session_id": "session-one", "model_name": "fixture", "tasks": []any{map[string]any{"id": "session-one", "title": "Eyra", "primary": true, "state": "idle"}}}
		case "matrix.send":
			sent <- args.(map[string]any)["message"].(string)
		}
		if out != nil {
			b, _ := json.Marshal(value)
			return json.Unmarshal(b, out)
		}
		return nil
	}
	in, writer := io.Pipe()
	defer writer.Close()
	defer in.Close()
	var out capture
	p, s := newProgram(m, in, &out, tea.WithContext(ctx), tea.WithoutSignalHandler())
	done := make(chan error, 1)
	go func() { _, err := p.Run(); s.close(); done <- err }()
	await(t, func() bool { return strings.Contains(out.text(), "FIXTURE") })
	_, _ = io.WriteString(writer, "/")
	await(t, func() bool { return strings.Contains(out.text(), "Eyra · idle") })
	if strings.Contains(out.text(), "Eyra API") {
		t.Fatal("bare slash exposed configuration")
	}
	_, _ = io.WriteString(writer, "\x15")
	text := strings.Repeat("paste line\n", 9)
	_, _ = io.WriteString(writer, "\x1b[200~"+text+"\x1b[201~")
	await(t, func() bool { return strings.Contains(out.text(), "已粘贴") })
	select {
	case <-sent:
		t.Fatal("paste submitted without Enter")
	default:
	}
	_, _ = io.WriteString(writer, "\r")
	select {
	case got := <-sent:
		if got != text {
			t.Fatalf("%q", got)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Enter did not submit")
	}
	_, _ = io.WriteString(writer, "\x11")
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("quit stuck")
	}
	raw := out.text()
	if !strings.Contains(raw, "\x1b[?2004h") || !strings.Contains(raw, "\x1b[?2004l") {
		t.Fatal("bracketed paste mode not restored")
	}
	for _, forbidden := range []string{"\x1b[?3J", "\x1b[?1000h", "\x1b[?1002h", "\x1b[?1003h"} {
		if strings.Contains(raw, forbidden) {
			t.Fatal("terminal selection/scrollback hijacked")
		}
	}
	if strings.Contains(raw, "\x1b[?1049") || strings.Contains(raw, "\x1b[2J") {
		t.Fatal("native scrollback disabled or duplicate frame archived")
	}
	if ansi.Strip(raw) == "" {
		t.Fatal("empty render")
	}
}
