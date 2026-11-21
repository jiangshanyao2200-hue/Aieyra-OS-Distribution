// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestHumanDecisionsStayWithinSelectedTaskAndGeneration
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/human_scope_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	agent "github.com/aieyra/aieyra-os/CORE"
)

func TestHumanDecisionsStayWithinSelectedTaskAndGeneration(t *testing.T) {
	for _, recover := range []bool{false, true} {
		t.Run(map[bool]string{false: "wait", true: "recover"}[recover], func(t *testing.T) {
			var replies atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body struct {
					Action    string
					Arguments json.RawMessage
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				var args map[string]any
				_ = json.Unmarshal(body.Arguments, &args)
				data := any(map[string]any{})
				switch body.Action {
				case "workspace.task_snapshot":
					if args["task_id"] != "child" {
						t.Error("snapshot escaped selected task", args)
					}
					state := "waiting_user"
					humans := []agent.HumanRequest{
						{ID: "foreign", AgentID: "sibling", SessionID: "owner", Generation: 7, State: "waiting_user", HumanQuestion: agent.HumanQuestion{Question: "FOREIGN_DECISION"}},
						{ID: "stale", AgentID: "child", SessionID: "owner", Generation: 6, State: "waiting_user", HumanQuestion: agent.HumanQuestion{Question: "STALE_DECISION"}},
						{ID: "finished", AgentID: "child", SessionID: "owner", Generation: 7, State: "answered", HumanQuestion: agent.HumanQuestion{Question: "FINISHED_DECISION"}},
						{ID: "current", AgentID: "child", SessionID: "owner", Generation: 7, State: "waiting_user", HumanQuestion: agent.HumanQuestion{Question: "CURRENT_DECISION"}, Version: 3, RequestTokenSHA256: "binding"},
					}
					if replies.Load() != 0 {
						state, humans = "completed", nil
					}
					data = map[string]any{"roles": []any{map[string]any{"id": "child", "state": state, "generation": 7, "human_requests": humans}}}
				case "workspace.task_status":
					if args["task_id"] != "child" {
						t.Error("status escaped selected task", args)
					}
					state := "running"
					if replies.Load() != 0 {
						state = "completed"
					}
					if args["request_id"] == nil {
						data = map[string]any{"requests": []any{map[string]any{"request_id": "original", "generation": 7, "state": state}}}
					} else {
						if args["request_id"] != "original" {
							t.Error("wrong request", args)
						}
						data = map[string]any{"state": state, "generation": 7, "reply": "done"}
					}
				case "humans.reply":
					var reply agent.HumanReply
					if err := json.Unmarshal(body.Arguments, &reply); err != nil {
						t.Error(err)
					}
					if reply.SessionID != "owner" || reply.AgentID != "child" || reply.Generation != 7 || reply.HumanID != "current" || reply.ExpectedRequestVersion != 3 || reply.RequestTokenSHA256 != "binding" || reply.Decision.Text != "approved current task" {
						t.Error("decision lost exact task binding", reply)
					}
					replies.Add(1)
				default:
					t.Error("unexpected action", body.Action)
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": data})
			}))
			defer server.Close()
			c := &client{url: server.URL, session: "child", http: server.Client()}
			lines := make(chan inputLine, 1)
			lines <- inputLine{text: "approved current task"}
			close(lines)
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			var out, diagnostic bytes.Buffer
			var err error
			if recover {
				err = c.recoverHuman(ctx, lines, &out, &diagnostic, false)
			} else {
				err = c.wait(ctx, "original", &out, &diagnostic, false, lines)
			}
			if err != nil || replies.Load() != 1 || !strings.Contains(out.String(), "done") {
				t.Fatal("current decision did not complete", err, replies.Load(), out.String())
			}
			for _, forbidden := range []string{"FOREIGN_DECISION", "STALE_DECISION", "FINISHED_DECISION"} {
				if strings.Contains(diagnostic.String(), forbidden) {
					t.Error("unrelated decision displayed", diagnostic.String())
				}
			}
		})
	}
}
