// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestLayoutThoughtReplacesBodyInSameSlot; TestLayoutSpacingToolsFoldAndKeepOrder; TestMainBufferLongBodyAndAnimationsDoNotDuplicateHistory; TestLayoutCompletedToolDoesNotReplayOnIdlePoll; TestMainBufferTaskSwitchRetainsUnplayedTailOnce
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/layout_history_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"fmt"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
	"strings"
	"testing"
	"time"
)

func TestLayoutThoughtReplacesBodyInSameSlot(t *testing.T) {
	m := testModel()
	m.beginDisplay("USER_SLOT")
	m.receivePresentation(presentationBody{id: "slot", thought: "THOUGHT_SLOT", text: "BODY_SLOT"})
	before := strings.Split(ansi.Strip(m.View()), "\n")
	slot := -1
	for i, row := range before {
		if strings.Contains(row, "THOUGHT_SLOT") {
			slot = i
		}
	}
	if slot < 0 {
		t.Fatal("thinking not shown", before)
	}
	for i := 0; i < 100; i++ {
		m.View()
		m.animatePresentation(32 * time.Millisecond)
	}
	after := strings.Split(ansi.Strip(m.View()), "\n")
	if !strings.Contains(after[slot], "BODY_SLOT") || strings.Contains(strings.Join(after, "\n"), "THOUGHT_SLOT") {
		t.Fatal("body did not replace thinking", before, after)
	}
}

func TestLayoutSpacingToolsFoldAndKeepOrder(t *testing.T) {
	m := testModel()
	m.beginDisplay("USER_SPACING")
	m.receivePresentation(presentationBody{id: "intro", text: "BODY_INTRO"})
	m.syncFlowBody()
	m.taskGeneration = 1
	m.snapshot.Busy = true
	r := role{ID: "matrix", Generation: 1}
	r.Activity.Items = []activity{{ID: "one", Title: "检查文件", Tool: "exec_command", State: "completed", Command: "INPUT_ONE", Detail: "OUTPUT_ONE", Generation: 1}, {ID: "two", Title: "写入结果", Tool: "apply_patch", State: "failed", Input: "INPUT_TWO", Detail: "OUTPUT_TWO", Generation: 1}}
	m.snapshot.Roles = []role{r}
	m.syncActivities()
	m.captureFlow()
	for i := range m.activities {
		m.activities[i].shown = m.activities[i].details
		m.activities[i].readAt = time.Now()
	}
	expanded := ansi.Strip(m.View())
	for _, want := range []string{"输入", "INPUT_ONE", "输出", "OUTPUT_TWO"} {
		if !strings.Contains(expanded, want) {
			t.Fatal("lost tool input/output", expanded)
		}
	}
	for i := range m.activities {
		m.activities[i].readAt = time.Now().Add(-4 * time.Second)
	}
	m.snapshot.Busy = false
	m.bodyVisibleFor = time.Second
	m.receivePresentation(presentationBody{id: "end", text: "BODY_END"})
	view := ansi.Strip(m.View())
	for _, want := range []string{"● USER_SPACING\n\n○ BODY_INTRO", "✓ 检查文件\n! 写入结果 · 失败\n\n○ BODY_END"} {
		if !strings.Contains(view, want) {
			t.Fatal("message/tool spacing or sequence wrong", view)
		}
	}
	if strings.Contains(view, "INPUT_ONE") || strings.Contains(view, "Enter 发送") {
		t.Fatal("details did not fold or old footer remained", view)
	}
	if activityBrief(activity{Tool: "exec_command"}) != "执行命令" || activityBrief(activity{Title: "我现在开始编辑文件"}) != "编辑文件" {
		t.Fatal("invented tool narrative")
	}
}

func TestMainBufferLongBodyAndAnimationsDoNotDuplicateHistory(t *testing.T) {
	m := testModel()
	v := newVTerm(m.width, m.height)
	v.archiveOnErase = true
	v.Write([]byte("SHELL_PRESERVED\r\n"))
	s := &screen{model: m, out: v}
	m.screen = s
	m.beginDisplay("USER_NATIVE")
	m.snapshot.Busy = true
	var body strings.Builder
	for batch := 0; batch < 30; batch++ {
		for i := 0; i < 60; i++ {
			fmt.Fprintf(&body, "LINE_%04d 完整正文保留，中间以及结尾均可读取。\n", batch*60+i)
		}
		m.liveID = "long"
		m.liveText = body.String()
		m.shownText = m.liveText
		s.draw()
		if batch == 4 {
			v.resize(52, 18)
			m.Update(tea.WindowSizeMsg{Width: 52, Height: 18})
			s.draw()
		}
		if batch == 10 {
			v.resize(100, 30)
			m.Update(tea.WindowSizeMsg{Width: 100, Height: 30})
			s.draw()
		}
	}
	if len(m.liveText) < 48<<10 {
		t.Fatal("fixture must exceed old truncation cap")
	}
	m.input.SetValue("UNSENT_PRIVATE_DRAFT")
	m.growInput()
	for i := 0; i < 100; i++ {
		m.frame = i
		m.notice = fmt.Sprintf("DYNAMIC_STATUS_%03d", i)
		s.draw()
	}
	if strings.Contains(strings.Join(v.scrollback, "\n"), "UNSENT_PRIVATE_DRAFT") || strings.Contains(strings.Join(v.scrollback, "\n"), "DYNAMIC_STATUS") {
		t.Fatal("transient frames polluted history")
	}
	m.snapshot.Busy = false
	if err := s.close(); err != nil {
		t.Fatal(err)
	}
	all := strings.Join(v.scrollback, "\n") + "\n" + strings.Join(v.snapshot(), "\n")
	for i := 0; i < 1800; i++ {
		token := fmt.Sprintf("LINE_%04d", i)
		if strings.Count(all, token) != 1 {
			t.Fatalf("missing/duplicate %s: %d", token, strings.Count(all, token))
		}
	}
	if strings.Count(all, "USER_NATIVE") != 1 || !strings.Contains(all, "SHELL_PRESERVED") || v.alternate {
		t.Fatal("lost main history/user/shell")
	}
}

func TestLayoutCompletedToolDoesNotReplayOnIdlePoll(t *testing.T) {
	m := testModel()
	m.beginDisplay("查看文件")
	r := role{ID: "matrix", Role: "matrix", Generation: 1}
	r.Activity.Items = []activity{{ID: "idle-tool", Tool: "exec_command", Generation: 1, State: "completed", Command: "INPUT_IDLE", Detail: "OUTPUT_IDLE"}}
	v := pollMsg{data: snapshot{Roles: []role{r}}}
	m.applySnapshot(v)
	if len(m.activities) != 1 {
		t.Fatal("completed preview not available")
	}
	m.activities[0].shown = m.activities[0].details
	m.activities[0].readAt = time.Now().Add(-4 * time.Second)
	readAt := m.activities[0].readAt
	for i := 0; i < 10; i++ {
		m.applySnapshot(v)
		if m.activities[0].readAt != readAt || strings.Contains(ansi.Strip(m.View()), "OUTPUT_IDLE") {
			t.Fatal("idle poll restarted completed details")
		}
	}
	if len(m.activeActivities()) != 0 {
		t.Fatal("completed tool became a live shortcut")
	}
	a := m.activities[0]
	a.readAt = time.Time{}
	a.shown = a.details + strings.Repeat("\nLONG_OUTPUT", 30)
	preview := strings.Join(m.activityPreviewLines(a, 8), "\n")
	if !strings.Contains(preview, "INPUT_IDLE") || !strings.Contains(preview, "输出") || strings.Count(preview, "\n") >= 8 {
		t.Fatal("large preview lost its input/output landmarks", preview)
	}
}

func TestMainBufferTaskSwitchRetainsUnplayedTailOnce(t *testing.T) {
	m := testModel()
	v := newVTerm(m.width, m.height)
	s := &screen{model: m, out: v}
	m.screen = s
	s.draw()
	m.beginDisplay("FIRST_USER")
	m.liveID, m.liveText, m.shownText = "first", "FIRST_COMPLETE_TAIL", "FIRST"
	s.draw()
	original := m.session.ID
	m.switchFlow("second")
	m.session.ID = "second"
	m.clearLive()
	m.beginDisplay("SECOND_USER")
	m.liveID, m.liveText, m.shownText = "second", "SECOND_COMPLETE_TAIL", "SECOND"
	s.draw()
	m.switchFlow(original)
	m.session.ID = original
	m.clearLive()
	s.draw()
	s.close()
	all := strings.Join(v.scrollback, "\n") + "\n" + strings.Join(v.snapshot(), "\n")
	for _, token := range []string{"FIRST_USER", "FIRST_COMPLETE_TAIL", "SECOND_USER", "SECOND_COMPLETE_TAIL"} {
		if strings.Count(all, token) != 1 {
			t.Fatalf("switched tail lost/repeated %s: %d", token, strings.Count(all, token))
		}
	}
}
