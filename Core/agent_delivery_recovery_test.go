// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestAgentRecoversPrematureDeliveryWithoutRestartingProcess
// Impact: python -B scripts/code-atlas.py show Core/agent_delivery_recovery_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
)

func TestAgentRecoversPrematureDeliveryWithoutRestartingProcess(t *testing.T) {
	for _, unified := range []bool{false, true} {
		t.Run(fmt.Sprint("terminal=", unified), func(t *testing.T) {
			command := shellTestCommand(t, "input")
			zero := 0
			command.YieldTimeMS = &zero
			var requests atomic.Int32
			var originalSession int
			m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
				var body struct {
					Input []struct {
						Type    string          `json:"type"`
						Role    string          `json:"role"`
						Output  string          `json:"output"`
						Content json.RawMessage `json:"content"`
					} `json:"input"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				// Read the actual system observation sent to the provider, rather
				// than matching prose or the earlier tool-output history.
				var pending []struct {
					State      string `json:"state"`
					Generation int    `json:"generation"`
					Tool       string `json:"tool"`
					Arguments  struct {
						SessionID int    `json:"session_id"`
						Action    string `json:"action"`
					} `json:"arguments"`
				}
				sawPending := false
				for _, item := range body.Input {
					var content string
					if json.Unmarshal(item.Content, &content) != nil {
						continue
					}
					if item.Role != "system" && item.Role != "developer" && !(item.Role == "user" && strings.HasPrefix(content, "[Aieyra runtime context]\n")) {
						continue
					}
					if !strings.Contains(content, "\nsection: aieyra_runtime_result\n") {
						continue
					}
					if strings.HasSuffix(content, runtimeContextRemoved) {
						pending = nil
						continue
					}
					for _, line := range strings.Split(content, "\n") {
						if strings.HasPrefix(strings.TrimSpace(line), "[{") {
							if err := json.Unmarshal([]byte(line), &pending); err != nil {
								t.Error(err)
							}
							sawPending = sawPending || len(pending) > 0
						}
					}
				}
				n := int(requests.Add(1))
				switch n {
				case 1:
					name, args := "exec_command", string(rawJSON(command))
					if unified {
						var a map[string]any
						_ = json.Unmarshal(rawJSON(command), &a)
						a["action"] = "exec"
						name, args = "terminal", string(rawJSON(a))
					}
					fixtureAnswer(w, "start-original", "", []any{map[string]any{"type": "function_call", "id": "fc-start", "call_id": "call-start", "name": name, "arguments": args}})
				case 2:
					for _, item := range body.Input {
						var receipt ShellResult
						if item.Type == "function_call_output" && json.Unmarshal([]byte(item.Output), &receipt) == nil && receipt.SessionID > 0 {
							originalSession = receipt.SessionID
						}
					}
					fixtureAnswer(w, "too-early", "The command is finished.", nil)
				case 3:
					wantTool, wantAction := "write_stdin", ""
					if unified {
						wantTool, wantAction = "terminal", "wait"
					}
					if len(pending) != 1 || pending[0].Arguments.SessionID != originalSession || pending[0].Tool != wantTool || pending[0].Arguments.Action != wantAction || pending[0].State == "" || pending[0].Generation <= 0 {
						t.Errorf("recovery request lacks original execution and continuation arguments: %+v", pending)
					}
					if originalSession <= 0 {
						t.Error("original process identity missing")
					}
					name := "write_stdin"
					args := map[string]any{"session_id": originalSession, "chars": "RECOVERY_CONFIRMED\n", "yield_time_ms": 2000}
					if unified {
						name, args["action"] = "terminal", "input"
					}
					fixtureAnswer(w, "continue-original", "", []any{map[string]any{"type": "function_call", "id": "fc-input", "call_id": "call-input", "name": name, "arguments": string(rawJSON(args))}})
				default:
					if !sawPending {
						t.Error("committed pending observation was rewritten or removed from history")
					}
					if len(pending) != 0 {
						t.Error("stale pending observation survived the recovery tool")
					}
					foundOutput := false
					var latest ShellResult
					for _, item := range body.Input {
						var receipt ShellResult
						if item.Type == "function_call_output" && json.Unmarshal([]byte(item.Output), &receipt) == nil && receipt.SessionID == originalSession {
							latest = receipt
							foundOutput = foundOutput || strings.Contains(receipt.Output, "RECOVERY_CONFIRMED")
						}
					}
					// Input may return output or reach its yield limit before the
					// original process exits. Observe it again without resending input.
					if latest.Pending() && n < 8 {
						name := "write_stdin"
						args := map[string]any{"session_id": originalSession, "yield_time_ms": 2000}
						if unified {
							name, args["action"] = "terminal", "wait"
						}
						fixtureAnswer(w, fmt.Sprint("wait-original-", n), "", []any{map[string]any{"type": "function_call", "id": fmt.Sprint("fc-wait-", n), "call_id": fmt.Sprint("call-wait-", n), "name": name, "arguments": string(rawJSON(args))}})
						return
					}
					if !foundOutput || latest.ExitCode == nil || *latest.ExitCode != 0 {
						t.Error("delivery did not observe completed original process")
					}
					fixtureAnswer(w, fmt.Sprint("verified-", n), "Verified original process completed.", nil)
				}
			})
			permissions := []string{"exec_command", "write_stdin"}
			if unified {
				permissions = []string{"terminal"}
			}
			record, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "recover-original", ModelID: "local-model", Task: "Complete the original command", Workdir: dir, Tools: permissions, MaxRequests: 6})
			if err != nil {
				t.Fatal(err)
			}
			record, err = m.Wait(context.Background(), testMatrixOwner, record.ID, 10000)
			if err != nil || record.State != "completed" || requests.Load() < 4 || requests.Load() > 8 || record.ToolTurns != int(requests.Load())-2 {
				t.Fatalf("premature delivery could not recover: state=%s error=%s requests=%d turns=%d wait=%v", record.State, record.Error, requests.Load(), record.ToolTurns, err)
			}
			rows := m.jobs[record.ID].shell.Snapshots()
			if len(rows) != 1 || rows[0].SessionID != originalSession || rows[0].ExitCode == nil || *rows[0].ExitCode != 0 {
				t.Fatal("process was restarted or not completed", rows)
			}
		})
	}
}
