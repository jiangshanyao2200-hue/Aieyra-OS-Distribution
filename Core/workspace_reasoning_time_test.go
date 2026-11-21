// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestReasoningCancelledRequestClosesPrimaryAndSplitSpans; TestReasoningBoundariesUseFirstEventAndDoNotInventPublicText; TestReasoningSpanClosingAndBoundedSnapshot
// Impact: python -B scripts/code-atlas.py show Core/workspace_reasoning_time_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"errors"
	"io"
	"net/http"
	"testing"
	"time"
)

func TestReasoningCancelledRequestClosesPrimaryAndSplitSpans(t *testing.T) {
	for _, role := range []string{WorkspaceMatrix, ""} {
		t.Run(map[string]string{WorkspaceMatrix: "primary", "": "split"}[role], func(t *testing.T) {
			w, _ := testWorkspace(t, func(rw http.ResponseWriter, req *http.Request) {
				rw.Header().Set("Content-Type", "text/event-stream")
				io.WriteString(rw, responseFrame(map[string]any{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"type": "reasoning", "id": "opaque", "summary": []any{}, "encrypted_content": "private"}}))
				rw.(http.Flusher).Flush()
				<-req.Context().Done()
			})
			s, err := w.manager.settings("local-model")
			if err != nil {
				t.Fatal(err)
			}
			s.Stream = boolRef(true)
			job := &agentJob{record: AgentRecord{ID: workspaceID(), Parent: w.state.ID, Depth: 1, Generation: 4, Spec: AgentSpec{WorkspaceRole: role, MaxTokens: 100000}}}
			view := role
			if view == "" {
				view = job.record.ID
			}
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			done := make(chan error, 1)
			go func() {
				_, _, err := w.manager.agentRequest(ctx, job, s, []Message{{Role: RoleUser, Content: "cancel during reasoning"}}, nil, "model")
				done <- err
			}()
			for {
				w.mu.Lock()
				live := w.live[view]
				w.mu.Unlock()
				if live.ReasoningStartedAt != 0 {
					break
				}
				select {
				case err := <-done:
					t.Fatalf("request ended before reasoning: %v", err)
				case <-ctx.Done():
					t.Fatal("reasoning event not received")
				case <-time.After(5 * time.Millisecond):
				}
			}
			cancel()
			if err := <-done; !errors.Is(err, context.Canceled) {
				t.Fatal(err)
			}
			w.mu.Lock()
			live := w.live[view]
			w.mu.Unlock()
			if live.ReasoningStartedAt != 0 || len(live.ReasoningHistory) != 1 || live.Phase != "error" || live.Thought != "" {
				t.Fatal(live)
			}
		})
	}
}

func TestReasoningBoundariesUseFirstEventAndDoNotInventPublicText(t *testing.T) {
	w, _ := testWorkspace(t, nil)
	w.taskRequestStart(WorkspaceMatrix, 3, false)
	w.taskStream(WorkspaceMatrix, 3, Event{Kind: EventReasoningStart})
	first := w.live[WorkspaceMatrix]
	if first.ReasoningStartedAt == 0 || first.Thought != "" {
		t.Fatal(first)
	}
	w.taskStream(WorkspaceMatrix, 3, Event{Kind: EventReasoningStart})
	w.taskStream(WorkspaceMatrix, 3, Event{Kind: EventReasoning, Text: "private", ReasoningKind: "summary"})
	if v := w.live[WorkspaceMatrix]; v.ReasoningStartedAt != first.ReasoningStartedAt || v.Thought != "" {
		t.Fatal(v)
	}
	w.taskStream(WorkspaceMatrix, 3, Event{Kind: EventToolPreparing})
	v := w.live[WorkspaceMatrix]
	if v.ReasoningStartedAt != 0 || len(v.ReasoningHistory) != 1 || v.ReasoningHistory[0].FinishedAt < first.ReasoningStartedAt {
		t.Fatal(v)
	}
	w.taskStream(WorkspaceMatrix, 3, Event{Kind: EventReasoningDone})
	w.taskStream(WorkspaceMatrix, 3, Event{Kind: EventReasoningStart})
	if len(w.live[WorkspaceMatrix].ReasoningHistory) != 1 || w.live[WorkspaceMatrix].ReasoningStartedAt != 0 {
		t.Fatal("late reasoning created another span")
	}
	w.taskRequestStart(WorkspaceMatrix, 3, true)
	if len(w.live[WorkspaceMatrix].ReasoningHistory) != 1 {
		t.Fatal("request boundary lost history")
	}
	w.taskStream(WorkspaceMatrix, 3, Event{Kind: EventReasoningStart})
	w.taskStream(WorkspaceMatrix, 3, Event{Kind: EventError})
	if len(w.live[WorkspaceMatrix].ReasoningHistory) != 2 || len(v.ReasoningHistory) != 1 {
		t.Fatal("history was lost or an older snapshot mutated")
	}
	w.taskRequestStart(WorkspaceMatrix, 4, true)
	if len(w.live[WorkspaceMatrix].ReasoningHistory) != 0 {
		t.Fatal("generation leaked history")
	}
}

func TestReasoningSpanClosingAndBoundedSnapshot(t *testing.T) {
	v := WorkspaceLive{BodyID: "body"}
	finishWorkspaceReasoning(&v, 100)
	if len(v.ReasoningHistory) != 0 {
		t.Fatal("invented reasoning")
	}
	for i := int64(1); i <= 205; i++ {
		startWorkspaceReasoning(&v, i*1000)
		finishWorkspaceReasoning(&v, i*1000+250)
	}
	if len(v.ReasoningHistory) != 200 || v.ReasoningHistory[0].StartedAt != 6000 {
		t.Fatal(v)
	}
	startWorkspaceReasoning(&v, 300000)
	finishWorkspaceReasoning(&v, 299999)
	if last := v.ReasoningHistory[len(v.ReasoningHistory)-1]; last.FinishedAt != last.StartedAt {
		t.Fatal("negative duration", last)
	}
}
