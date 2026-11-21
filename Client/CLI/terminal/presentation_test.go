// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestUserMessageSurvivesFastCompletion; TestThoughtPrecedesBodyAtCompletion; frameFor; TestUserDwellStartsAtVisibleFrameAndSurvivesNarrowResize; TestThoughtShortLongBurstAndResize; TestAppendedThoughtWaitsForNewTail; TestConsecutiveBodiesKeepTheirOwnThoughtTail; TestPresentationDoesNotDelayCancellationOrCoreIdle; TestWhitespaceThoughtNeverBlocksBody; TestWaitingRequestDoesNotReplayPreviousBody; TestRollingThoughtRetainsProgressAndShowsFinalTail; TestHiddenPresentationResumesAfterMenuAndResize
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/presentation_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/aieyra/aieyra-os/contracts/protocol"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
)

func TestUserMessageSurvivesFastCompletion(t *testing.T) {
	m := testModel()
	m.beginDisplay("你好，检查这个任务")
	m.View()
	m.applySnapshot(pollMsg{data: snapshot{Roles: []role{{ID: "matrix", Role: "matrix", Generation: 1}}, Live: map[string]protocol.WorkspaceLive{"matrix": {BodyID: "fast", Text: "完成"}}}})
	if !strings.Contains(m.View(), "你好，检查这个任务") {
		t.Fatal("fast completion erased user before a readable dwell")
	}
}

func TestThoughtPrecedesBodyAtCompletion(t *testing.T) {
	m := testModel()
	m.beginDisplay("检查")
	thought := strings.Repeat("按顺序展示思考内容 ", 30) + "思考尾部"
	m.applySnapshot(pollMsg{data: snapshot{Roles: []role{{ID: "matrix", Role: "matrix", Generation: 1}}, Live: map[string]protocol.WorkspaceLive{"matrix": {BodyID: "fast", Thought: thought, Text: "FINAL_BODY"}}}})
	if strings.Contains(m.View(), "FINAL_BODY") {
		t.Fatal("body appeared before queued thought")
	}
	seenTail := false
	for i := 0; i < 240; i++ {
		m.lastPulse = time.Now().Add(-32 * time.Millisecond)
		m.animate()
		frame := m.View()
		if strings.Contains(frame, "思考尾部") {
			seenTail = true
		}
		if strings.Contains(frame, "FINAL_BODY") {
			if !seenTail {
				t.Fatal("body skipped thought tail")
			}
			return
		}
	}
	t.Fatal("thought backlog did not catch up")
}

func frameFor(m *model, dt time.Duration) string {
	m.animatePresentation(dt)
	return ansi.Strip(m.View())
}

func TestUserDwellStartsAtVisibleFrameAndSurvivesNarrowResize(t *testing.T) {
	m := testModel()
	m.beginDisplay("VISIBLE_USER 窄窗口下仍然可读的用户消息")
	m.height = 2
	m.View()
	for i := 0; i < 100; i++ {
		frameFor(m, 32*time.Millisecond)
	}
	if m.userVisibleFor != 0 || m.userText == "" {
		t.Fatal("hidden time consumed reading dwell")
	}
	m.width, m.height = 22, 18
	m.layout()
	if view := ansi.Strip(m.View()); !strings.Contains(view, "VISIBLE_USER") || !strings.Contains(view, "用户消息") {
		t.Fatal("narrow message not wrapped readably", view)
	}
	for i := 0; i < 77; i++ {
		if !strings.Contains(frameFor(m, 32*time.Millisecond), "VISIBLE_USER") {
			t.Fatal("user vanished before 2.5 seconds")
		}
	}
	if !strings.Contains(frameFor(m, 40*time.Millisecond), "VISIBLE_USER") || m.userText != "" {
		t.Fatal("transient did not retire into persistent information flow")
	}
}

func TestThoughtShortLongBurstAndResize(t *testing.T) {
	for _, thought := range []string{"SHORT_TAIL", strings.Repeat("汉字 👩‍💻 é ", 80) + "LONG_TAIL"} {
		t.Run(thought[len(thought)-10:], func(t *testing.T) {
			m := testModel()
			m.receivePresentation(presentationBody{id: "one", thought: thought, text: "BODY_MARK"})
			seenTail := false
			for i := 0; i < 90; i++ {
				if i == 10 {
					m.width = 24
					m.layout()
				}
				view := ansi.Strip(m.View())
				if strings.Contains(view, "_TAIL") {
					seenTail = true
				}
				if strings.Contains(view, "BODY_MARK") {
					if !seenTail {
						t.Fatal("body bypassed thought tail")
					}
					return
				}
				m.animatePresentation(32 * time.Millisecond)
			}
			t.Fatal("received thought did not catch up within 2.9 seconds")
		})
	}
}

func TestAppendedThoughtWaitsForNewTail(t *testing.T) {
	m := testModel()
	m.receivePresentation(presentationBody{id: "one", thought: "FIRST_TAIL"})
	for i := 0; i < 12; i++ {
		m.View()
		m.animatePresentation(32 * time.Millisecond)
	}
	m.receivePresentation(presentationBody{id: "one", thought: "FIRST_TAIL SECOND_TAIL", text: "BODY_MARK"})
	m.animatePresentation(32 * time.Millisecond)
	if m.shownText != "" {
		t.Fatal("new thought reused old tail receipt")
	}
	seen := false
	for i := 0; i < 30; i++ {
		view := frameFor(m, 32*time.Millisecond)
		seen = seen || strings.Contains(view, "SECOND_TAIL")
		if strings.Contains(view, "BODY_MARK") {
			if !seen {
				t.Fatal("new tail skipped")
			}
			return
		}
	}
	t.Fatal("short appended thought stalled")
}

func TestConsecutiveBodiesKeepTheirOwnThoughtTail(t *testing.T) {
	m := testModel()
	for _, id := range []string{"ONE", "TWO", "THREE"} {
		m.receivePresentation(presentationBody{id: id, thought: strings.Repeat("thinking ", 30) + id + "_TAIL", text: id + "_BODY"})
	}
	tails, seen, bodies := map[string]bool{}, map[string]bool{}, []string{}
	for i := 0; i < 220; i++ {
		view := ansi.Strip(m.View())
		for _, id := range []string{"ONE", "TWO", "THREE"} {
			if strings.Contains(view, id+"_TAIL") {
				tails[id] = true
			}
			if strings.Contains(view, id+"_BODY") && !seen[id] {
				if !tails[id] {
					t.Fatal("body skipped its tail", id)
				}
				bodies = append(bodies, id)
				seen[id] = true
			}
		}
		if len(bodies) == 3 {
			if strings.Join(bodies, ",") != "ONE,TWO,THREE" {
				t.Fatal("body order", bodies)
			}
			return
		}
		m.animatePresentation(32 * time.Millisecond)
	}
	t.Fatal("body backlog stalled", bodies)
}

func TestPresentationDoesNotDelayCancellationOrCoreIdle(t *testing.T) {
	m := testModel()
	called := false
	m.session.Call = func(_ context.Context, name string, args, out any) error {
		called = name == "matrix.cancel"
		return nil
	}
	if err := json.Unmarshal([]byte(`{"busy":true,"requests":[{"request_id":"work","state":"running","generation":1}]}`), &m.snapshot); err != nil {
		t.Fatal(err)
	}
	m.receivePresentation(presentationBody{id: "one", thought: strings.Repeat("待显示的思考", 200), text: "BODY_MARK"})
	cmd := m.cancelTask()
	if cmd == nil {
		t.Fatal("presentation blocked cancellation")
	}
	m.Update(cmd())
	if !called {
		t.Fatal("cancel not dispatched immediately")
	}
	m.snapshot.Busy = false
	if strings.Contains(ansi.Strip(m.statusLine()), "工作中") {
		t.Fatal("presentation impersonates execution")
	}
	if !m.presentationPending() {
		t.Fatal("idle stopped pending presentation")
	}
	m.beginDisplay("NEW_USER")
	if len(m.pendingBodies) != 0 || m.liveText != "" || m.liveThought != "" {
		t.Fatal("new user retained old presentation")
	}
	m.Update(tea.WindowSizeMsg{Width: 40, Height: 15})
}

func TestWhitespaceThoughtNeverBlocksBody(t *testing.T) {
	for _, thought := range []string{"", " \t\n\r ", "\u3000\u00a0"} {
		m := testModel()
		m.receivePresentation(presentationBody{id: "one", thought: thought, text: "BODY_MARK"})
		if !strings.Contains(ansi.Strip(m.View()), "BODY_MARK") || m.presentationPending() {
			t.Fatalf("empty normalized thought blocked body: %q", thought)
		}
	}
}

func TestWaitingRequestDoesNotReplayPreviousBody(t *testing.T) {
	m := testModel()
	roles := []role{{ID: "matrix", Role: "matrix", Generation: 1}}
	m.applySnapshot(pollMsg{data: snapshot{Roles: roles, Live: map[string]protocol.WorkspaceLive{"matrix": {BodyID: "one", Text: "FIRST_BODY"}}}})
	m.View()
	m.animatePresentation(200 * time.Millisecond)
	m.applySnapshot(pollMsg{data: snapshot{Busy: true, Roles: roles, Live: map[string]protocol.WorkspaceLive{"matrix": {BodyID: "two", NewBody: true, Text: "FIRST_BODY", Thought: "OLD_TAIL"}}}})
	if m.liveID != "one" || len(m.pendingBodies) != 0 || m.liveThought != "" {
		t.Fatal("waiting request replayed retained text/thought", m.liveID, m.pendingBodies, m.liveThought)
	}
	m.applySnapshot(pollMsg{data: snapshot{Busy: true, Roles: roles, Live: map[string]protocol.WorkspaceLive{"matrix": {BodyID: "two", NewBody: true, ReasoningSeen: true, Text: "FIRST_BODY", Thought: "FRESH_TAIL"}}}})
	if m.liveText != "" || m.liveThought != "FRESH_TAIL" {
		t.Fatal("fresh thought inherited old body", m.liveText, m.liveThought)
	}
}

func TestRollingThoughtRetainsProgressAndShowsFinalTail(t *testing.T) {
	r := thoughtRibbon{}
	r.render("0123456789ABCDEFGHIJ", 5)
	r.index = 10
	r.render("56789ABCDEFGHIJKLMNOP", 5)
	if r.index != 5 {
		t.Fatal("rolling suffix restarted instead of retaining progress", r.index)
	}
	m := testModel()
	m.width = 24
	m.layout()
	for i := 0; i < 30; i++ {
		m.receivePresentation(presentationBody{id: "one", thought: strings.Repeat("stream ", 100) + strings.Repeat("更新", i)})
		frameFor(m, 32*time.Millisecond)
	}
	m.receivePresentation(presentationBody{id: "one", thought: strings.Repeat("stream ", 100) + "FINAL_TAIL", text: "BODY_MARK"})
	seen := false
	for i := 0; i < 90; i++ {
		view := frameFor(m, 32*time.Millisecond)
		seen = seen || strings.Contains(view, "FINAL_TAIL")
		if strings.Contains(view, "BODY_MARK") {
			if !seen {
				t.Fatal("rolling thought final tail skipped")
			}
			return
		}
	}
	t.Fatal("rolling thought did not catch up")
}

func TestHiddenPresentationResumesAfterMenuAndResize(t *testing.T) {
	m := testModel()
	m.receivePresentation(presentationBody{id: "one", thought: "READ_TAIL", text: "BODY_MARK"})
	m.height = 2
	m.View()
	for i := 0; i < 100; i++ {
		frameFor(m, 32*time.Millisecond)
	}
	if m.shownText != "" {
		t.Fatal("hidden thought released body")
	}
	m.width, m.height = 80, 24
	m.layout()
	seen := false
	for i := 0; i < 30; i++ {
		view := frameFor(m, 32*time.Millisecond)
		seen = seen || strings.Contains(view, "READ_TAIL")
		if strings.Contains(view, "BODY_MARK") {
			if !seen {
				t.Fatal("resize skipped tail")
			}
			return
		}
	}
	t.Fatal("resize did not resume presentation")
}
