// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestContextCheckpointPreservesDisplayedHistory
// Impact: python -B scripts/code-atlas.py show Core/context_checkpoint_history_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"
	"testing"
)

func TestContextCheckpointPreservesDisplayedHistory(t *testing.T) {
	for _, trigger := range []string{"manual", "automatic", "recovery", "cancelled", "failed"} {
		t.Run(trigger, func(t *testing.T) {
			w, id, archive := historyFixture(t)
			w.mu.Lock()
			w.state.HistorySegment = workspaceID()
			w.state.HistoryAfter = "2020-01-01T00:00:00Z"
			segment, after, revision := w.state.HistorySegment, w.state.HistoryAfter, w.state.Revision
			w.mu.Unlock()
			for i := 0; i < 21; i++ {
				if err := archive.Append("message", Message{Role: RoleAssistant, Content: fmt.Sprintf("visible-before-checkpoint-%02d", i)}); err != nil {
					t.Fatal(err)
				}
			}
			page := func() map[string]string {
				t.Helper()
				r, err := w.historyPage(rawJSON(map[string]any{"segment": segment, "limit": 50}))
				if err != nil {
					t.Fatal(err)
				}
				result := r.(map[string]any)
				if result["reset"] == true {
					t.Fatal("checkpoint invalidated reader's history segment")
				}
				rows := map[string]string{}
				for _, row := range result["entries"].([]historyEntry) {
					if row.Kind == "message" {
						rows[row.ID] = row.Text
					}
				}
				return rows
			}
			before := page()
			w.manager.mu.Lock()
			job := w.manager.jobs[id]
			job.record.Depth = 1
			job.record.Spec.WorkspaceRole = WorkspaceMatrix
			w.manager.mu.Unlock()
			c := &contextCompaction{}
			c.set(&CompactionState{RequestID: "checkpoint-history", Trigger: "manual", State: "running", Covered: 21})
			cp := &Checkpoint{Covered: 21}
			ctx := context.Background()
			target := archive
			actualTrigger := trigger
			if trigger == "cancelled" {
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
				actualTrigger = "manual"
			}
			if trigger == "failed" {
				target = &SessionArchive{Path: t.TempDir()}
				actualTrigger = "manual"
			}
			err := w.manager.commitContextCheckpoint(ctx, job, target, cp, c, actualTrigger)
			failed := trigger == "cancelled" || trigger == "failed"
			if (err != nil) != failed {
				t.Fatal("unexpected checkpoint result", err)
			}
			wantState := "completed"
			if failed {
				wantState = "running"
			}
			if c.snapshot().State != wantState {
				t.Fatal("checkpoint publication boundary changed", c.snapshot())
			}
			w.mu.Lock()
			changed := w.state.HistorySegment != segment || w.state.HistoryAfter != after || w.state.Revision != revision
			w.mu.Unlock()
			if changed {
				t.Fatal("model checkpoint changed display identity or lower bound")
			}
			rows := page()
			if len(before) != 21 || len(rows) != len(before) {
				t.Fatal("displayed messages disappeared", len(before), len(rows))
			}
			for key, text := range before {
				if rows[key] != text {
					t.Fatal("checkpoint changed original message identity or text", key)
				}
			}
		})
	}
}
