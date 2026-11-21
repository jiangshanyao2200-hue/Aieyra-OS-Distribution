// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkspaceInternalRequestNeverBecomesChat
// Impact: python -B scripts/code-atlas.py show Core/workspace_internal_stream_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

// Exercise the actual request adapter: compact results are valid JSON, but
// they belong to the checkpoint, never to the user's answer or thoughts.
func TestWorkspaceInternalRequestNeverBecomesChat(t *testing.T) {
	for _, streaming := range []bool{false, true} {
		t.Run(map[bool]string{false: "buffered", true: "streaming"}[streaming], func(t *testing.T) {
			body := `{"source_digest":"internal-digest","goals":["keep working"]}`
			w, _ := testWorkspace(t, func(rw http.ResponseWriter, _ *http.Request) {
				if !streaming {
					fixtureAnswer(rw, "internal-result", body, nil)
					return
				}
				rw.Header().Set("Content-Type", "text/event-stream")
				io.WriteString(rw, responseFrame(map[string]any{"type": "response.output_text.delta", "output_index": 0, "item_id": "item_text", "delta": body}))
				io.WriteString(rw, terminalFrame("completed", responseTextItem(body)))
			})
			s, err := w.manager.settings("local-model")
			if err != nil {
				t.Fatal(err)
			}
			s.Stream = boolRef(streaming)
			job := &agentJob{record: AgentRecord{ID: workspaceID(), Parent: w.state.ID, Depth: 1, Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix, MaxRequests: 4, MaxTokens: 100000}}}
			w.live[WorkspaceMatrix] = WorkspaceLive{BodyID: "actual-progress", Phase: "settled", Text: "正在核对最后一项。"}
			answer, _, err := w.manager.agentRequest(context.Background(), job, s, []Message{{Role: RoleUser, Content: "internal summary"}}, nil, "compact")
			if err != nil || answer.Content != body {
				t.Fatalf("summary lost: %s %v", answer.Content, err)
			}
			w.mu.Lock()
			live := w.live[WorkspaceMatrix]
			w.mu.Unlock()
			if strings.Contains(live.Text+live.Thought, "source_digest") || live.BodyID != "actual-progress" || live.Text != "正在核对最后一项。" {
				t.Fatalf("internal summary leaked or replaced progress: %+v", live)
			}
			if live.Phase != "compacting" {
				t.Fatalf("missing truthful compact status: %s", live.Phase)
			}
			// An explicitly requested JSON answer remains visible, byte for byte.
			_, _, err = w.manager.agentRequest(context.Background(), job, s, []Message{{Role: RoleUser, Content: "return JSON"}}, nil, "model")
			if err != nil {
				t.Fatal(err)
			}
			w.mu.Lock()
			live = w.live[WorkspaceMatrix]
			w.mu.Unlock()
			if live.Text != body || live.Phase != "settled" {
				t.Fatalf("ordinary JSON answer hidden: %+v", live)
			}
			if job.record.Requests != 2 || len(job.record.Usage) != 2 || job.record.Usage[0].Kind != "compact" || job.record.Usage[1].Kind != "model" {
				t.Fatal("internal usage was discarded")
			}
		})
	}
}
