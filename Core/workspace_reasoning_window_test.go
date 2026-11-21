// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkspaceReasoningWindowRetainsDelayedReaderText; TestWorkspaceReasoningWindowBoundsUTF8AndKeepsCorrections; TestWorkspaceReasoningWindowPreservesVisibilityAndResetBoundaries
// Impact: python -B scripts/code-atlas.py show Core/workspace_reasoning_window_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestWorkspaceReasoningWindowRetainsDelayedReaderText(t *testing.T) {
	for _, indexed := range []bool{false, true} {
		t.Run(fmt.Sprintf("indexed=%v", indexed), func(t *testing.T) {
			w, _ := testWorkspace(t, nil)
			w.taskRequestStart(WorkspaceMatrix, 3, true)
			output, part := 0, 0
			var want strings.Builder
			for i := 0; i < 60; i++ {
				text := fmt.Sprintf("thought-%02d %s\n", i, strings.Repeat("核对画布状态🙂", 8))
				event := Event{Kind: EventReasoning, Text: text, ReasoningKind: "summary"}
				if indexed {
					event.OutputIndex, event.ContentIndex = &output, &part
				}
				w.taskStream(WorkspaceMatrix, 3, event)
				want.WriteString(text)
			}
			// No reader observed the individual chunks. Its first public snapshot
			// must still contain the complete window, rather than the old two lines.
			x, err := w.Snapshot(0)
			if err != nil {
				t.Fatal(err)
			}
			live := x.(map[string]any)["live"].(map[string]WorkspaceLive)[WorkspaceMatrix]
			if live.Thought != want.String() || live.ThoughtKind != "summary" {
				t.Fatalf("late snapshot lost reasoning: got %d bytes, want %d", len(live.Thought), want.Len())
			}
			encoded, err := json.Marshal(live)
			if err != nil {
				t.Fatal(err)
			}
			var public map[string]any
			if err := json.Unmarshal(encoded, &public); err != nil {
				t.Fatal(err)
			}
			if public["thought"] != want.String() || strings.Contains(string(encoded), "StreamThoughtParts") || strings.Contains(string(encoded), "ContentIndex") {
				t.Fatal("public snapshot lost text or exposed internal contributions")
			}
		})
	}
}

func TestWorkspaceReasoningWindowBoundsUTF8AndKeepsCorrections(t *testing.T) {
	for _, indexed := range []bool{false, true} {
		t.Run(fmt.Sprintf("indexed=%v", indexed), func(t *testing.T) {
			w := &Workspace{live: map[string]WorkspaceLive{}}
			w.taskRequestStart(WorkspaceMatrix, 4, true)
			output, part := 0, 0
			chunk, tail := strings.Repeat("核🙂", 7000), "最后一行🙂"
			want := chunk + chunk + chunk + tail
			for _, text := range []string{chunk, chunk, chunk, tail} {
				event := Event{Kind: EventReasoning, Text: text}
				if indexed {
					event.OutputIndex, event.ContentIndex = &output, &part
				}
				w.taskStream(WorkspaceMatrix, 4, event)
			}
			check := func(text, full string) {
				t.Helper()
				if len(text) > 128<<10 || len(text) < (128<<10)-utf8.UTFMax || !utf8.ValidString(text) || !strings.HasSuffix(full, text) {
					t.Fatalf("invalid bounded reading tail: got %d of %d bytes", len(text), len(full))
				}
			}
			previous := w.live[WorkspaceMatrix]
			check(previous.Thought, want)
			if indexed {
				replacement := "改写：" + strings.Repeat("🙂新", 20000) + "完成🙂"
				w.taskStream(WorkspaceMatrix, 4, Event{Kind: EventTextCorrection, CorrectionKind: EventReasoning, OutputIndex: &output, ContentIndex: &part, Text: replacement, ReasoningKind: "summary"})
				check(w.live[WorkspaceMatrix].Thought, replacement)
				if previous.StreamThoughtParts[0].Text != want || w.live[WorkspaceMatrix].ThoughtKind != "summary" {
					t.Fatal("correction mutated a previous snapshot or lost its reasoning kind")
				}
			}
		})
	}
}

func TestWorkspaceReasoningWindowPreservesVisibilityAndResetBoundaries(t *testing.T) {
	w := &Workspace{live: map[string]WorkspaceLive{}}
	w.taskRequestStart(WorkspaceMatrix, 5, true)
	output, part := 0, 0
	old := strings.Repeat("先前公开思考🙂", 200)
	w.taskStream(WorkspaceMatrix, 5, Event{Kind: EventReasoning, OutputIndex: &output, ContentIndex: &part, Text: old})
	output = 1
	w.taskStream(WorkspaceMatrix, 5, Event{Kind: EventDelta, OutputIndex: &output, ContentIndex: &part, Text: "正文"})
	if w.live[WorkspaceMatrix].Thought != old {
		t.Fatal("body arrival discarded the retained public reasoning")
	}
	output = 2
	w.taskStream(WorkspaceMatrix, 5, Event{Kind: EventReasoning, OutputIndex: &output, ContentIndex: &part, Text: "本轮新的公开思考"})
	if v := w.live[WorkspaceMatrix]; v.Thought != "本轮新的公开思考" || v.Text != "" || !v.NewBody || len(v.StreamThoughtParts) != 1 {
		t.Fatal("new reasoning output retained invalidated text")
	}
	output = 0
	w.taskStream(WorkspaceMatrix, 5, Event{Kind: EventTextCorrection, CorrectionKind: EventReasoning, OutputIndex: &output, ContentIndex: &part, Text: old})
	if w.live[WorkspaceMatrix].Thought != "本轮新的公开思考" {
		t.Fatal("old output correction restored invalidated reasoning")
	}
	w.taskRequestStart(WorkspaceMatrix, 6, true)
	w.taskStream(WorkspaceMatrix, 5, Event{Kind: EventReasoning, Text: old})
	if w.live[WorkspaceMatrix].Thought != "" {
		t.Fatal("old generation reasoning leaked into a new turn")
	}
	w.taskStream(WorkspaceMatrix, 6, Event{Kind: EventReasoning, Text: "重试前的思考"})
	w.taskStream(WorkspaceMatrix, 6, Event{Kind: EventRetry})
	if v := w.live[WorkspaceMatrix]; v.Thought != "" || len(v.StreamThoughtParts) != 0 {
		t.Fatal("retry retained the previous reasoning")
	}
	w.taskRequestStart(WorkspaceMatrix, 7, false)
	w.taskStream(WorkspaceMatrix, 7, Event{Kind: EventReasoning, OutputIndex: &output, ContentIndex: &part, Text: "隐藏内容" + old})
	w.taskStream(WorkspaceMatrix, 7, Event{Kind: EventTextCorrection, CorrectionKind: EventReasoning, OutputIndex: &output, ContentIndex: &part, Text: "改写隐藏内容"})
	if v := w.live[WorkspaceMatrix]; v.Thought != "" || len(v.StreamThoughtParts) != 0 || !v.ReasoningSeen {
		t.Fatal("hidden reasoning was exposed or its activity was lost")
	}
}
