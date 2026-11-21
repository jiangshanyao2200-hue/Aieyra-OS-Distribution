// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestResponsesOpaqueReasoningActivityLifecycle; TestResponsesReasoningStartDoesNotResurrectLaterPhases; TestResponsesSummaryStartReplacesPriorRequestThought; TestEmptyReasoningPlaceholderDoesNotInventActivity; TestResponsesTerminalOnlyOpaqueItemDoesNotInventActivity; TestResponsesConsecutiveOpaqueItemsHaveIndependentLifetimes; TestReasoningActivityHonorsVisibilityAndGeneration
// Impact: python -B scripts/code-atlas.py show Core/responses_activity_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"github.com/aieyra/aieyra-os/api/codec"
	"testing"
)

func TestResponsesOpaqueReasoningActivityLifecycle(t *testing.T) {
	var events []Event
	w := &Workspace{live: map[string]WorkspaceLive{WorkspaceMatrix: {Phase: "waiting"}}}
	a := codec.NewResponseDecoder(func(e Event) error {
		events = append(events, e)
		w.stream(WorkspaceMatrix, e)
		return nil
	})
	item := rawJSON(map[string]any{"id": "reasoning-opaque", "type": "reasoning", "summary": []any{}, "encrypted_content": "private-ciphertext"})
	if err := a.Item(0, item, false); err != nil {
		t.Fatal(err)
	}
	v := w.live[WorkspaceMatrix]
	if v.Phase != "thinking" || !v.ReasoningSeen || v.Thought != "" {
		t.Fatalf("actual reasoning start without public text was lost: %+v", v)
	}
	count := len(events)
	if err := a.Item(0, item, false); err != nil {
		t.Fatal(err)
	}
	if len(events) != count {
		t.Fatal("repeated item started reasoning twice")
	}
	if err := a.Item(0, item, true); err != nil {
		t.Fatal(err)
	}
	if w.live[WorkspaceMatrix].Phase != "waiting" {
		t.Fatal("opaque reasoning completion did not end thinking")
	}
	count = len(events)
	if err := a.Item(0, item, true); err != nil {
		t.Fatal(err)
	}
	if len(events) != count {
		t.Fatal("final item replayed reasoning end")
	}
	for _, e := range events {
		if e.Text != "" {
			t.Fatal("opaque state exposed as text")
		}
	}
}

func TestResponsesReasoningStartDoesNotResurrectLaterPhases(t *testing.T) {
	for _, phase := range []string{"body", "tool", "settled", "error"} {
		t.Run(phase, func(t *testing.T) {
			w := &Workspace{live: map[string]WorkspaceLive{WorkspaceMatrix: {Phase: phase, Thought: "public summary"}}}
			a := codec.NewResponseDecoder(func(e Event) error { w.stream(WorkspaceMatrix, e); return nil })
			item := rawJSON(map[string]any{"id": "late", "type": "reasoning", "summary": []any{}})
			if err := a.Item(0, item, false); err != nil {
				t.Fatal(err)
			}
			w.stream(WorkspaceMatrix, Event{Kind: EventReasoning, Text: "late text", ReasoningKind: "summary"})
			if v := w.live[WorkspaceMatrix]; v.Phase != phase || v.Thought != "public summary" {
				t.Fatal(v)
			}
		})
	}
}

func TestResponsesSummaryStartReplacesPriorRequestThought(t *testing.T) {
	w := &Workspace{live: map[string]WorkspaceLive{WorkspaceMatrix: {Phase: "waiting", Thought: "prior request", ThoughtKind: "summary"}}}
	a := codec.NewResponseDecoder(func(e Event) error { w.stream(WorkspaceMatrix, e); return nil })
	added := `{"type":"response.reasoning_summary_part.added","output_index":0,"item_id":"current","summary_index":0,"part":{"type":"summary_text","text":""}}`
	if _, err := a.Feed(added, ""); err != nil {
		t.Fatal(err)
	}
	if v := w.live[WorkspaceMatrix]; v.Phase != "thinking" || v.Thought != "" {
		t.Fatal(v)
	}
	delta := `{"type":"response.reasoning_summary_text.delta","output_index":0,"item_id":"current","summary_index":0,"delta":"current summary"}`
	if _, err := a.Feed(delta, ""); err != nil {
		t.Fatal(err)
	}
	if v := w.live[WorkspaceMatrix]; v.Thought != "current summary" || v.ThoughtKind != "summary" {
		t.Fatal(v)
	}
	w.stream(WorkspaceMatrix, Event{Kind: EventToolPreparing})
	if v := w.live[WorkspaceMatrix]; v.Phase != "tool" || v.Thought != "current summary" {
		t.Fatal(v)
	}
}

func TestEmptyReasoningPlaceholderDoesNotInventActivity(t *testing.T) {
	w := &Workspace{live: map[string]WorkspaceLive{WorkspaceMatrix: {Phase: "waiting"}}}
	w.stream(WorkspaceMatrix, Event{Kind: EventReasoning})
	if v := w.live[WorkspaceMatrix]; v.Phase != "waiting" || v.ReasoningSeen {
		t.Fatal(v)
	}
}

func TestResponsesTerminalOnlyOpaqueItemDoesNotInventActivity(t *testing.T) {
	var events []Event
	a := codec.NewResponseDecoder(func(e Event) error { events = append(events, e); return nil })
	item := rawJSON(map[string]any{"id": "completed-only", "type": "reasoning", "summary": []any{}, "encrypted_content": "private-ciphertext"})
	if err := a.Item(0, item, true); err != nil {
		t.Fatal(err)
	}
	if len(events) != 0 {
		t.Fatalf("completion alone invented live activity: %+v", events)
	}
}

func TestResponsesConsecutiveOpaqueItemsHaveIndependentLifetimes(t *testing.T) {
	var kinds []EventKind
	w := &Workspace{live: map[string]WorkspaceLive{WorkspaceMatrix: {Phase: "waiting"}}}
	a := codec.NewResponseDecoder(func(e Event) error {
		kinds = append(kinds, e.Kind)
		w.stream(WorkspaceMatrix, e)
		return nil
	})
	for i, id := range []string{"first", "second"} {
		item := rawJSON(map[string]any{"id": id, "type": "reasoning", "summary": []any{}})
		if err := a.Item(i, item, false); err != nil {
			t.Fatal(err)
		}
		if w.live[WorkspaceMatrix].Phase != "thinking" {
			t.Fatal("consecutive item lost active state")
		}
		if err := a.Item(i, item, true); err != nil {
			t.Fatal(err)
		}
		if w.live[WorkspaceMatrix].Phase != "waiting" {
			t.Fatal("consecutive item failed to settle")
		}
	}
	if len(kinds) != 4 || kinds[0] != EventReasoningStart || kinds[1] != EventReasoningDone || kinds[2] != EventReasoningStart || kinds[3] != EventReasoningDone {
		t.Fatal(kinds)
	}
}

func TestReasoningActivityHonorsVisibilityAndGeneration(t *testing.T) {
	w := &Workspace{live: map[string]WorkspaceLive{WorkspaceMatrix: {Generation: 2, Phase: "waiting", HideThought: true}}}
	w.taskStream(WorkspaceMatrix, 1, Event{Kind: EventReasoningStart})
	if w.live[WorkspaceMatrix].ReasoningSeen {
		t.Fatal("prior generation changed live reasoning")
	}
	w.taskStream(WorkspaceMatrix, 2, Event{Kind: EventReasoningStart})
	w.taskStream(WorkspaceMatrix, 2, Event{Kind: EventReasoning, Text: "hidden summary", ReasoningKind: "summary"})
	if v := w.live[WorkspaceMatrix]; v.Phase != "thinking" || !v.ReasoningSeen || v.Thought != "" {
		t.Fatal(v)
	}
	w.taskStream(WorkspaceMatrix, 2, Event{Kind: EventDone})
	w.taskStream(WorkspaceMatrix, 2, Event{Kind: EventReasoningStart})
	if w.live[WorkspaceMatrix].Phase != "settled" {
		t.Fatal("late start revived a terminal task")
	}
}
