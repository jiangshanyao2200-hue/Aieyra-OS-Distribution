// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestLayoutMissingInputReadsBoundedReceiptOnlyAtTransitions; TestLayoutStreamingTableNeverCommitsMutableColumnWidths
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/layout_stream_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/charmbracelet/x/ansi"
)

func TestLayoutMissingInputReadsBoundedReceiptOnlyAtTransitions(t *testing.T) {
	m := testModel()
	m.beginDisplay("补丁测试")
	state, calls := "running", 0
	m.session.Call = func(ctx context.Context, method string, args, out any) error {
		switch method {
		case "workspace.snapshot":
			r := role{ID: "matrix", Role: "matrix", Generation: 1}
			r.Activity.Items = []activity{{ID: "patch", Tool: "apply_patch", State: state, Generation: 1, Detail: "REAL_OUTPUT"}}
			*out.(*snapshot) = snapshot{Roles: []role{r}}
		case "workspace.receipt":
			calls++
			if d, ok := ctx.Deadline(); !ok || time.Until(d) > time.Second {
				t.Fatal("unbounded automatic preview read")
			}
			a := args.(map[string]any)
			if a["agent_id"] != "matrix" || a["id"] != "patch" || a["input_offset"] != 0 || a["output_offset"] != 0 {
				t.Fatal("preview changed tool binding or fetched extra pages", a)
			}
			*out.(*toolReceipt) = toolReceipt{Input: "REAL_INPUT_HEAD\n" + strings.Repeat("👩‍💻", 20000) + "WRONG_TAIL", NextInput: 65536}
		}
		return nil
	}
	for i := 0; i < 8; i++ {
		m.applySnapshot(m.poll(0)().(pollMsg))
	}
	if calls != 1 || len(m.inputPreviews) != 1 || len(m.activities) != 1 {
		t.Fatal("idle polling repeated the first receipt page", calls)
	}
	input := m.activities[0].Input
	if !strings.HasPrefix(input, "REAL_INPUT_HEAD") || strings.Contains(input, "WRONG_TAIL") || strings.ContainsRune(input, '�') || len(input) > 2051 {
		t.Fatal("input preview lost the beginning/UTF-8 or exceeded budget", input)
	}
	state = "completed"
	for i := 0; i < 8; i++ {
		m.applySnapshot(m.poll(0)().(pollMsg))
	}
	if calls != 2 {
		t.Fatal("completion did not get exactly one final input read", calls)
	}
	view := m.activities[0]
	view.shown = view.details + strings.Repeat("\nREAL_OUTPUT_TAIL", 20)
	preview := strings.Join(m.activityPreviewLines(view, 8), "\n")
	if !strings.Contains(preview, "输入") || !strings.Contains(preview, "输出") {
		t.Fatal("preview lost input/output landmarks", preview)
	}
	view.shown = "输出  FIRST\n" + strings.Repeat("REAL_OUTPUT_TAIL\n", 20)
	if !strings.Contains(strings.Join(m.activityPreviewLines(view, 8), "\n"), "输出") {
		t.Fatal("output-only tail lost its label")
	}
	m.clearLive()
	if m.inputPreviews != nil {
		t.Fatal("input preview crossed task/generation boundary")
	}
}

func TestLayoutStreamingTableNeverCommitsMutableColumnWidths(t *testing.T) {
	m := testModel()
	m.height = 8
	m.beginDisplay("TABLE_USER")
	m.snapshot.Busy = true
	m.liveID = "table"
	var prefix strings.Builder
	for i := 0; i < 20; i++ {
		fmt.Fprintf(&prefix, "STABLE_%02d\n", i)
	}
	prefix.WriteString("\n| KEY | VALUE |\n|---|---|\n")
	m.liveText = prefix.String() + "| row | x |\n"
	m.shownText = m.liveText
	s := &screen{model: m}
	m.flowRows(3)
	first := ansi.Strip(strings.Join(s.historyRows(false), "\n"))
	if !strings.Contains(first, "STABLE_00") || strings.Contains(first, "KEY") || strings.Contains(first, "row") {
		t.Fatal("streaming table reached irreversible history", first)
	}
	m.liveText += "| row2 | much wider streaming cell |\n"
	m.shownText = m.liveText
	m.flowRows(3)
	second := ansi.Strip(strings.Join(s.historyRows(false), "\n"))
	if strings.Contains(second, "KEY") || strings.Contains(second, "row2") {
		t.Fatal("changing table was committed early", second)
	}
	m.snapshot.Busy = false
	m.flowRows(3)
	final := ansi.Strip(strings.Join(s.historyRows(true), "\n"))
	if strings.Count(first+second+final, "KEY") != 1 || !strings.Contains(final, "much wider streaming cell") {
		t.Fatal("final table was lost or duplicated", final)
	}
}
