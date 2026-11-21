// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestPlanOnlyCancelledTurnKeepsStateAndDurableReceipt
// Impact: python -B scripts/code-atlas.py show Core/tool_plan_cancel_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"reflect"
	"testing"
)

func TestPlanOnlyCancelledTurnKeepsStateAndDurableReceipt(t *testing.T) {
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	for _, existing := range []bool{false, true} {
		for _, failSave := range []bool{false, true} {
			name := map[bool]string{false: "create", true: "update"}[existing] + "/" + map[bool]string{false: "saved", true: "save_failed"}[failSave]
			t.Run(name, func(t *testing.T) {
				manager, _ := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected model request") })
				archive, err := NewSessionArchive(filepath.Join(t.TempDir(), "config.json"))
				if err != nil {
					t.Fatal(err)
				}
				defer archive.Close()
				if err = archive.Start(ModelFlash); err != nil {
					t.Fatal(err)
				}
				engine := &PlanEngine{Receipts: map[string]ToolReceipt{}}
				args := string(rawJSON(samplePlanUpdate()))
				if existing {
					initial := Message{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: "create", Function: FunctionCall{Name: "update_plan", Arguments: args}}}}
					if _, err = ExecutePlanTools(engine, initial, "initial", func(turn ToolTurn) error { return archive.Append("tool_turn", turn) }); err != nil {
						t.Fatal(err)
					}
					args = `{"action":"update","expected_revision":1,"changes":[{"op":"revise","step_id":"p1","text":"must not apply","reason":"cancelled turn"}]}`
				}
				before := engine.Clone()
				response := Message{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: "plan", Function: FunctionCall{Name: "update_plan", Arguments: args}}}}
				ctx, cancel := context.WithCancel(WithAgentManager(context.Background(), manager, testMatrixOwner, nil))
				defer cancel()
				ctx = withOfficialToolAdmission(ctx)
				if err = admitOfficialToolCall(ctx, response.ToolCalls[0]); err != nil {
					t.Fatal("valid plan adapter not admitted", err)
				}
				cancel() // The adapter was accepted before cancellation; execution still must stop.
				writes := 0
				turn, err := ExecuteToolTurn(ctx, engine, nil, response, "cancel-plan", func(kind string, value any) error {
					writes++
					if failSave {
						return errors.New("fixture disk full")
					}
					return archive.Append(kind, value)
				})
				if failSave {
					if err == nil || !reflect.DeepEqual(engine, before) {
						t.Fatalf("failed commit adopted a cancelled plan: %+v, %v", engine.State, err)
					}
					return
				}
				if err != nil || !reflect.DeepEqual(engine.State, before.State) || len(turn.Receipts) != 1 || turn.Receipts[0].Transition != nil {
					t.Fatalf("cancelled plan mutated or lost its receipt: before=%+v after=%+v turn=%+v err=%v", before.State, engine.State, turn, err)
				}
				var result PlanToolResult
				if err = json.Unmarshal([]byte(turn.Messages[1].Content), &result); err != nil || result.OK || result.Error == nil || result.Error.Code != "cancelled" || !reflect.DeepEqual(result.State, before.State) {
					t.Fatalf("cancelled plan did not return current state: %+v, %v", result, err)
				}
				if existing && (result.PlanID != before.State.ID || result.Revision != before.State.Revision) {
					t.Fatal("cancelled plan lost its identity or version", result)
				}
				if err = ValidateToolTurn(turn); err != nil {
					t.Fatal(err)
				}
				restored, err := archive.read()
				if err != nil || !reflect.DeepEqual(restored.Plan.State, before.State) || restored.Plan.Receipts["cancel-plan:plan"].Output != turn.Receipts[0].Output {
					t.Fatal("archive recovery changed the cancelled plan", err)
				}
				replay, err := ExecuteToolTurn(context.Background(), engine, nil, response, "cancel-plan", func(string, any) error { t.Error("cancelled replay wrote again"); return nil })
				if err != nil || !replay.Replayed || writes != 1 || replay.Messages[1].Content != turn.Messages[1].Content {
					t.Fatal("cancelled plan replay was not idempotent", err)
				}
				response.ToolCalls[0].Function.Arguments = `{"action":"complete","expected_revision":1}`
				if _, err = ExecuteToolTurn(context.Background(), engine, nil, response, "cancel-plan", func(string, any) error { t.Error("conflicting replay wrote"); return nil }); err == nil {
					t.Fatal("changed cancelled call identity was accepted")
				}
			})
		}
	}
}
