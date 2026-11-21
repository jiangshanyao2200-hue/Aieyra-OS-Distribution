// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: cliGoalCreate; cliGoalState; cliGoalComplete; TestCLIGoalFinalRequiresOriginalAcceptance; TestCLIGoalUnchangedFinalFailsWithinBound; TestCLIGoalCanReportExplicitStopBoundary
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/goal_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package cli

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	agent "github.com/aieyra/aieyra-os/CORE"
)

func cliGoalCreate() map[string]any {
	return map[string]any{"action": "create", "mode": "goal", "objective": "Verify an explicit goal", "acceptance": []string{"The original criterion is verified"}, "phases": []any{map[string]any{"id": "A", "title": "Verify", "steps": []any{map[string]any{"id": "proof", "text": "Observe the result", "status": "in_progress"}}}}}
}

func cliGoalState(t *testing.T, input json.RawMessage) *agent.PlanState {
	t.Helper()
	var items []struct{ Type, Output string }
	if err := json.Unmarshal(input, &items); err != nil {
		t.Fatal(err)
	}
	var state *agent.PlanState
	for _, item := range items {
		if item.Type != "function_call_output" {
			continue
		}
		var result agent.PlanToolResult
		if json.Unmarshal([]byte(item.Output), &result) != nil || !result.OK {
			continue
		}
		if result.State != nil {
			state = result.State
		} else if state != nil && result.PlanID == state.ID {
			state.Revision, state.Status = result.Revision, result.Status
		}
	}
	if state == nil {
		t.Fatal("no actual plan receipt returned by Core")
	}
	return state
}

func cliGoalComplete(p *agent.PlanState, alreadyDone bool) map[string]any {
	args := map[string]any{"action": "complete", "plan_id": p.ID, "expected_revision": p.Revision, "completion": []any{map[string]any{"criterion": p.Acceptance[0], "evidence": []string{"Local fixture observed the criterion"}}}}
	if !alreadyDone {
		args["changes"] = []any{map[string]any{"op": "set_status", "step_id": "proof", "status": "completed", "reason": "Observed the local fixture", "evidence": []string{"Local fixture observed the result"}}}
	}
	return args
}

func TestCLIGoalFinalRequiresOriginalAcceptance(t *testing.T) {
	for _, awaiting := range []bool{false, true} {
		name := "active"
		if awaiting {
			name = "awaiting_acceptance"
		}
		t.Run(name, func(t *testing.T) {
			var calls atomic.Int32
			config, project := fixture(t, func(w http.ResponseWriter, r *http.Request) {
				var body struct{ Input json.RawMessage }
				_ = json.NewDecoder(r.Body).Decode(&body)
				n := int(calls.Add(1))
				if n == 1 {
					callTool(w, "goal-create", "update_plan", cliGoalCreate())
					return
				}
				p := cliGoalState(t, body.Input)
				if awaiting && n == 2 {
					callTool(w, "goal-step-done", "update_plan", map[string]any{"action": "update", "plan_id": p.ID, "expected_revision": p.Revision, "changes": []any{map[string]any{"op": "set_status", "step_id": "proof", "status": "completed", "reason": "Observed locally", "evidence": []string{"Local fixture observed the result"}}}})
					return
				}
				finalAttempt := 2
				if awaiting {
					finalAttempt++
				}
				if n == finalAttempt {
					if p.Status != name {
						t.Error("wrong pre-final domain state", p.Status)
					}
					answer(w, "premature-final", "PREMATURE_GOAL_COMPLETION", nil)
				} else if n == finalAttempt+1 {
					hasBoundary := bytes.Contains(body.Input, []byte("has not passed acceptance"))
					hasReply := bytes.Contains(body.Input, []byte("PREMATURE_GOAL_COMPLETION"))
					noWorkflow := bytes.Contains(body.Input, []byte("No workspace delivery action is required."))
					if !hasBoundary || !hasReply || !noWorkflow {
						t.Errorf("goal boundary=%v preserved reply=%v independent of retired workflow=%v", hasBoundary, hasReply, noWorkflow)
					}
					callTool(w, "goal-accept", "update_plan", cliGoalComplete(p, awaiting))
				} else {
					if p.Status != "complete" || len(p.Acceptance) != 1 || p.Acceptance[0] != "The original criterion is verified" {
						t.Error("final bypassed exact original acceptance", p)
					}
					answer(w, "goal-final", "GOAL_ACCEPTANCE_VERIFIED", nil)
				}
			})
			out, err := runClient(t, activeClient(t, config, project), "explicit-goal", "Complete the explicit goal", true)
			wantCalls := int32(4)
			if awaiting {
				wantCalls++
			}
			if err != nil || !strings.Contains(out, "GOAL_ACCEPTANCE_VERIFIED") || calls.Load() != wantCalls {
				t.Fatal("explicit goal boundary failed", err, calls.Load(), out)
			}
		})
	}
}

func TestCLIGoalUnchangedFinalFailsWithinBound(t *testing.T) {
	var calls atomic.Int32
	config, project := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			callTool(w, "goal-create", "update_plan", cliGoalCreate())
			return
		}
		answer(w, "goal-still-active", "UNVERIFIED_GOAL", nil)
	})
	out, err := runClient(t, activeClient(t, config, project), "unverified-goal", "Do the explicit goal", true)
	if err == nil || calls.Load() != 4 || strings.Contains(out, `"state":"completed"`) {
		t.Fatal("unverified goal completed or retried without a bound", calls.Load(), err, out)
	}
}

func TestCLIGoalCanReportExplicitStopBoundary(t *testing.T) {
	for _, status := range []string{"paused", "blocked", "cancelled"} {
		t.Run(status, func(t *testing.T) {
			var calls atomic.Int32
			config, project := fixture(t, func(w http.ResponseWriter, r *http.Request) {
				var body struct{ Input json.RawMessage }
				_ = json.NewDecoder(r.Body).Decode(&body)
				switch calls.Add(1) {
				case 1:
					callTool(w, "goal-create", "update_plan", cliGoalCreate())
				case 2:
					p := cliGoalState(t, body.Input)
					changes := []any{}
					if status == "blocked" {
						// The actual remaining step is blocked, so no independent work
						// remains runnable. A lifecycle label alone cannot stop work.
						changes = append(changes, map[string]any{"op": "set_status", "step_id": "proof", "status": "blocked", "reason": "External observation unavailable"})
					}
					changes = append(changes, map[string]any{"op": "set_lifecycle", "status": status, "reason": "The user or external dependency requires this boundary"})
					callTool(w, "goal-stop", "update_plan", map[string]any{"action": "update", "plan_id": p.ID, "expected_revision": p.Revision, "changes": changes})
				default:
					if p := cliGoalState(t, body.Input); p.Status != status {
						t.Error("stop boundary was not persisted", p.Status)
					}
					answer(w, "goal-stopped", "GOAL_STOP_RECORDED", nil)
				}
			})
			out, err := runClient(t, activeClient(t, config, project), "stopped-goal", "Work on this goal", true)
			if err != nil || calls.Load() != 3 || !strings.Contains(out, "GOAL_STOP_RECORDED") {
				t.Fatal("explicit stop boundary did not settle", status, err, calls.Load(), out)
			}
		})
	}
}
