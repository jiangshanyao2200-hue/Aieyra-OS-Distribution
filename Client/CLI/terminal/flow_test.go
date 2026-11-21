// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestFlowRetainsBodiesAndUserAfterDwell; TestFlowScrollAnchorsWhileNewOutputArrives; TestFlowFoldReopenFailuresAndOriginalReceipt; TestFlowCacheBoundsAndTaskIsolation; TestFlowTaskCacheCountsActiveTaskAndEvictsOldest; TestFlowEmptyIdleSnapshotClosesCurrentThought; TestFlowPinnedComposerWithRendererAndResize; TestFlowLongBodyAppendedThoughtDoesNotStall; BenchmarkFlowFullDisplayCache
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/flow_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/aieyra/aieyra-os/contracts/protocol"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
)

func TestFlowRetainsBodiesAndUserAfterDwell(t *testing.T) {
	m := testModel()
	m.beginDisplay("FIRST_USER", "request-one")
	m.receivePresentation(presentationBody{id: "first", text: "FIRST_BODY"})
	m.View()
	m.animatePresentation(3 * time.Second)
	m.beginDisplay("SECOND_USER", "request-two")
	m.receivePresentation(presentationBody{id: "second", text: "SECOND_BODY"})
	view := ansi.Strip(m.View())
	last := -1
	for _, s := range []string{"FIRST_USER", "FIRST_BODY", "SECOND_USER", "SECOND_BODY"} {
		index := strings.Index(view, s)
		if index <= last {
			t.Fatalf("information flow order %q: %s", s, view)
		}
		last = index
	}
	m.beginDisplay("SECOND_USER", "request-two")
	if view = ansi.Strip(m.View()); strings.Count(view, "SECOND_USER") != 1 {
		t.Fatal("lost ACK duplicated user", view)
	}
}

func TestFlowScrollAnchorsWhileNewOutputArrives(t *testing.T) {
	m := testModel()
	m.beginDisplay("SCROLL_USER")
	var b strings.Builder
	for i := 0; i < 90; i++ {
		fmt.Fprintf(&b, "ROW-%03d 中文\n", i)
	}
	m.receivePresentation(presentationBody{id: "long", text: b.String()})
	m.View()
	m.key(key(tea.KeyPgUp))
	m.key(key(tea.KeyPgUp))
	before := strings.Split(ansi.Strip(m.View()), "\n")[0]
	m.receivePresentation(presentationBody{id: "long", text: b.String() + "NEW_OUTPUT\n"})
	if after := strings.Split(ansi.Strip(m.View()), "\n")[0]; after != before {
		t.Fatalf("new output stole reading anchor %q -> %q", before, after)
	}
	m.input.SetValue("DRAFT_STAYS")
	m.growInput()
	view := ansi.Strip(m.View())
	if !strings.Contains(view, "DRAFT_STAYS") || !strings.Contains(view, "正在回看") || strings.Contains(view, "NEW_OUTPUT") {
		t.Fatal("scroll broke composer/follow", view)
	}
	m.key(tea.KeyMsg{Type: tea.KeyCtrlEnd})
	if view = ansi.Strip(m.View()); !strings.Contains(view, "NEW_OUTPUT") || m.flow.reading {
		t.Fatal("return to latest failed", view)
	}
}

func TestFlowFoldReopenFailuresAndOriginalReceipt(t *testing.T) {
	m := testModel()
	m.beginDisplay("检查")
	m.taskGeneration = 3
	var r role
	r.ID, r.Role, r.Generation = "matrix", "matrix", 3
	r.Activity.Items = []activity{{ID: "success", Tool: "apply_patch", Title: "修改文件", State: "completed", Generation: 3}, {ID: "failure", Tool: "exec_command", Title: "运行检查", State: "failed", Generation: 3, Detail: "EXIT 1"}, {ID: "stopped", Tool: "exec_command", State: "cancelled", Generation: 3}}
	m.snapshot = snapshot{Roles: []role{r}, Busy: false}
	m.flowThought("body", "检查代码与结果")
	m.captureFlow()
	m.receivePresentation(presentationBody{id: "body", text: "报告正文"})
	for i := range m.flow.entries {
		if m.flow.entries[i].kind == "process" {
			m.flow.entries[i].finished = time.Now().Add(-4 * time.Second)
		}
	}
	view := ansi.Strip(m.View())
	if !strings.Contains(view, "运行检查 · 失败") || !strings.Contains(view, "执行命令 · 已停止") || strings.Contains(view, "2 项已处理") || strings.Contains(view, "EXIT 1") {
		t.Fatal("failure should remain in its folded brief", view)
	}
	m.key(tea.KeyMsg{Type: tea.KeyRunes, Alt: true, Runes: []rune{'h'}})
	if view = ansi.Strip(m.View()); !strings.Contains(view, "检查代码与结果") || !strings.Contains(view, "EXIT 1") {
		t.Fatal("reopen lost thought/tool details", view)
	}
	m.key(tea.KeyMsg{Type: tea.KeyDown, Alt: true})
	var got map[string]any
	m.session.Call = func(_ context.Context, method string, args, out any) error {
		if method == "workspace.receipt" {
			got = args.(map[string]any)
		}
		return nil
	}
	cmd := m.key(tea.KeyMsg{Type: tea.KeyRunes, Alt: true, Runes: []rune{'r'}})
	if cmd == nil || m.pinned == nil || m.pinned.ID != "failure" {
		t.Fatal("selected historical tool wasn't pinned")
	}
	cmd()
	if got == nil || got["id"] != "failure" || got["agent_id"] != "matrix" || m.pinned.Generation != 3 {
		t.Fatal("receipt lost original binding", got)
	}
	m.clearCompletedTools()
	if m.pinned == nil {
		t.Fatal("idle polling closed an explicitly opened historical receipt")
	}
	if m.key(key(tea.KeyEsc)) != nil || m.pinned != nil || m.flow.inspect == "" {
		t.Fatal("first escape must return to process")
	}
	if m.key(key(tea.KeyEsc)) != nil || m.flow.inspect != "" {
		t.Fatal("second escape must return to flow, not cancel")
	}
}

func TestFlowCacheBoundsAndTaskIsolation(t *testing.T) {
	m := testModel()
	for i := 0; i < 80; i++ {
		m.beginDisplay(fmt.Sprintf("USER_%d", i))
		m.receivePresentation(presentationBody{id: fmt.Sprint(i), text: strings.Repeat("汉字 👩‍💻 ", 3000)})
		m.View()
	}
	if m.flow.bytes() > flowByteLimit || len(m.flow.entries) > flowEntryLimit || !m.flow.trimmed {
		t.Fatal("unbounded display cache", m.flow.bytes(), len(m.flow.entries))
	}
	original := m.session.ID
	m.completeAction(actionMsg{epoch: m.epoch, kind: "open", data: protocol.TerminalSession{ID: "different-task"}})
	m.beginDisplay("OTHER_TASK")
	m.receivePresentation(presentationBody{id: "other", text: "OTHER_BODY"})
	if view := ansi.Strip(m.View()); strings.Contains(view, "USER_79") {
		t.Fatal("task history leaked", view)
	}
	m.completeAction(actionMsg{epoch: m.epoch, kind: "open", data: protocol.TerminalSession{ID: original}})
	if view := ansi.Strip(m.View()); strings.Contains(view, "OTHER_TASK") || m.flow.bytes() == 0 {
		t.Fatal("original task cache was not restored", view)
	}
}

func TestFlowTaskCacheCountsActiveTaskAndEvictsOldest(t *testing.T) {
	m := testModel()
	for i := 0; i < 8; i++ {
		m.beginDisplay(fmt.Sprintf("TASK_%d", i))
		id := fmt.Sprintf("task-%d", i+1)
		m.completeAction(actionMsg{epoch: m.epoch, kind: "open", data: protocol.TerminalSession{ID: id}})
		if len(m.flows) > 3 || len(m.flowTasks) > 3 {
			t.Fatal("active task exceeded four-task cache budget", len(m.flows), m.flowTasks)
		}
		if _, duplicate := m.flows[m.session.ID]; duplicate {
			t.Fatal("active task retained in parked cache")
		}
	}
	m.completeAction(actionMsg{epoch: m.epoch, kind: "open", data: protocol.TerminalSession{ID: "task-7"}})
	if len(m.flow.entries) == 0 || m.flow.entries[1].text != "TASK_7" {
		t.Fatal("recent task was not restored", m.flow.entries)
	}
	m.completeAction(actionMsg{epoch: m.epoch, kind: "open", data: protocol.TerminalSession{ID: "task-1"}})
	if len(m.flow.entries) != 0 {
		t.Fatal("evicted task kept stale display cache")
	}
}

func TestFlowEmptyIdleSnapshotClosesCurrentThought(t *testing.T) {
	m := testModel()
	m.beginDisplay("检查")
	m.taskGeneration = 7
	m.snapshot.Busy = true
	m.flowThought("thinking", "检查结果")
	m.captureFlow()
	m.applySnapshot(pollMsg{data: snapshot{}})
	e := m.flow.entry(m.flow.processKey(), "process")
	if e.finished.IsZero() {
		t.Fatal("empty idle snapshot left process active")
	}
}

func TestFlowPinnedComposerWithRendererAndResize(t *testing.T) {
	m := testModel()
	m.beginDisplay("用户消息")
	m.receivePresentation(presentationBody{id: "body", text: strings.Repeat("SCROLL_CONTENT 中文\n", 60)})
	v := newVTerm(80, 24)
	v.Write([]byte("\x1b[?1049h"))
	s := &screen{model: m, out: v}
	m.input.SetValue("FIXED_INPUT 中文")
	m.growInput()
	s.draw()
	m.key(key(tea.KeyPgUp))
	s.draw()
	rows := v.snapshot()
	if !strings.Contains(strings.Join(rows[len(rows)-4:], "\n"), "FIXED_INPUT") {
		t.Fatal("composer scrolled with content", rows)
	}
	for _, size := range [][2]int{{30, 12}, {100, 32}, {80, 24}} {
		m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		frame := strings.Split(ansi.Strip(m.View()), "\n")
		if len(frame) != size[1] || !strings.Contains(strings.Join(frame[len(frame)-4:], "\n"), "FIXED_INPUT") {
			t.Fatal("resize lost pinned composer", size, frame)
		}
	}
}

func TestFlowLongBodyAppendedThoughtDoesNotStall(t *testing.T) {
	m := testModel()
	m.beginDisplay("读取")
	m.receivePresentation(presentationBody{id: "same", text: strings.Repeat("长正文\n", 80)})
	m.View()
	m.receivePresentation(presentationBody{id: "same", text: m.liveText, thought: strings.Repeat("继续确认 ", 60) + "THOUGHT_TAIL"})
	seen := false
	for i := 0; i < 90; i++ {
		view := frameFor(m, 32*time.Millisecond)
		seen = seen || strings.Contains(view, "THOUGHT_TAIL")
	}
	if !seen || !m.thoughtReady() {
		t.Fatal("long body hid and stalled new thought")
	}
}

func BenchmarkFlowFullDisplayCache(b *testing.B) {
	m := testModel()
	for i := 0; i < 40; i++ {
		m.beginDisplay(fmt.Sprintf("第%d轮", i))
		m.receivePresentation(presentationBody{id: fmt.Sprint(i), text: strings.Repeat("已经完成一项检查，接下来继续处理。\n", 280)})
		m.View()
	}
	m.View()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.View()
	}
}
