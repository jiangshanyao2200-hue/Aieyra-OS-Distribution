// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestCollaborationTopLevelActualTemplateDispatch; boolCount; TestCollaborationPendingAssignmentStillBlocksSwitch; TestCollaborationHostContractsRemainScoped; TestCollaborationFullCompactionLossRetainsArchive
// Impact: python -B scripts/code-atlas.py show Core/workspace_collaboration_contract_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
)

func TestCollaborationTopLevelActualTemplateDispatch(t *testing.T) {
	withLegacyHomeTeam(t)
	for _, tc := range []struct {
		name, mode string
		roles      []string
		denied     string
	}{
		{"natural", "natural", []string{WorkspaceProject, WorkspaceExecution}, ""},
		{"custom_project", "custom", []string{WorkspaceProject}, WorkspaceExecution},
		{"custom_empty", "custom", nil, WorkspaceExecution},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var matrixCalls, projectCalls, executionCalls, stationCalls atomic.Int32
			assignments := append([]string(nil), tc.roles...)
			if tc.denied != "" {
				assignments = append([]string{tc.denied}, assignments...)
			}
			w := collaborationFixture(t, func(rw http.ResponseWriter, r *http.Request) {
				body, _ := io.ReadAll(r.Body)
				var request map[string]json.RawMessage
				_ = json.Unmarshal(body, &request)
				if len(request["tools"]) == 0 {
					fixtureAnswer(rw, "continuity", "Retain completed task evidence.", nil)
					return
				}
				if strings.Contains(string(body), "Workspace role: project.") {
					projectCalls.Add(1)
					fixtureAnswer(rw, "project-result", "Read-only project result.", nil)
					return
				}
				if strings.Contains(string(body), "Workspace role: execution.") {
					executionCalls.Add(1)
					if !slices.Contains(tc.roles, WorkspaceExecution) {
						t.Error("disabled Cota called provider")
					}
					fixtureAnswer(rw, "execution-result", "简报：做完了\nScoped receipt.", nil)
					return
				}
				// 进入协同先写计划（R10），再逐个派工。
				n := int(matrixCalls.Add(1)) - 1
				if n == 0 {
					fixtureAnswer(rw, "plan", "", []any{map[string]any{"type": "function_call", "id": "fc_plan", "call_id": "plan", "name": "update_plan", "arguments": `{"summary":"Template acceptance","plan":[{"id":"deliver","description":"Deliver the template result","status":"in_progress"}]}`}})
					return
				}
				if n <= len(assignments) {
					role := assignments[n-1]
					fixtureAnswer(rw, fmt.Sprintf("delegate-%d", n), "", []any{map[string]any{"type": "function_call", "id": fmt.Sprintf("fc_team_%d", n), "call_id": fmt.Sprintf("team_%d", n), "name": "team", "arguments": string(rawJSON(map[string]any{"action": "dispatch", "role": role, "request_id": "template-" + role, "message": "Complete this scoped template assignment.", "wait": true}))}})
					return
				}
				if n == len(assignments)+1 {
					fixtureAnswer(rw, "matrix-patch", "", []any{fixtureReportCall("matrix_report", "template-result.txt", "written by Eyra\n")})
					return
				}
				fixtureAnswer(rw, "matrix-result", "TEMPLATE_COMPLETE", nil)
			}, func(_ context.Context, _ *Workspace, _ string) (workspaceMembership, error) {
				stationCalls.Add(1)
				return workspaceMembership{}, fmt.Errorf("top-level roles must not enroll")
			})
			roles := tc.roles
			if tc.mode == "natural" {
				roles = nil
			}
			if _, err := w.collaborationCall(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "configure", "mode": tc.mode, "roles": roles})); err != nil {
				t.Fatal(err)
			}
			if matrixCalls.Load()+projectCalls.Load()+executionCalls.Load()+stationCalls.Load() != 0 {
				t.Fatal("configuration executed work")
			}
			if _, err := w.Send("template-task", "Complete the template acceptance task."); err != nil {
				t.Fatal(err)
			}
			record := waitSplitRecord(t, w)
			if record.State != "completed" || record.Result != "TEMPLATE_COMPLETE" || int(matrixCalls.Load()) != len(assignments)+3 {
				t.Fatal("Matrix delegation did not finish", record.State, record.Error, matrixCalls.Load())
			}
			if projectCalls.Load() != int32(boolCount(slices.Contains(tc.roles, WorkspaceProject))) || executionCalls.Load() != int32(boolCount(slices.Contains(tc.roles, WorkspaceExecution))) {
				t.Fatal("configured role dispatch mismatch", projectCalls.Load(), executionCalls.Load())
			}
			assertFixtureReport(t, w, "template-result.txt", "written by Eyra\n")
			state := w.collaborationSnapshot()
			if state["active"] != false || state["station_required"] != false || state["membership"].(workspaceMembership).State != "not_required" || stationCalls.Load() != 0 {
				t.Fatal("top-level role falsely projected as station or active task", state)
			}
			for _, role := range state["roles"].([]map[string]any) {
				name := role["role"].(string)
				if name == WorkspaceMatrix || slices.Contains(tc.roles, name) {
					if role["state"] != "completed" {
						t.Fatal("actual role state was not projected", role)
					}
				} else if role["state"] != "idle" {
					t.Fatal("disabled role appeared dispatched", role)
				}
			}
			if _, err := w.collaborationCall(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "configure", "mode": "split"})); err != nil {
				t.Fatal("completed template could not change", err)
			}
			if _, err := w.team(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "dispatch", "role": WorkspaceExecution, "request_id": "after-switch", "message": "must be rejected"})); err == nil {
				t.Fatal("split mode retained fixed-role dispatch")
			}
		})
	}
}

func boolCount(value bool) int {
	if value {
		return 1
	}
	return 0
}

func TestCollaborationPendingAssignmentStillBlocksSwitch(t *testing.T) {
	withLegacyHomeTeam(t)
	for _, state := range []string{"queued", "context"} {
		t.Run(state, func(t *testing.T) {
			w := collaborationFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("pending-message check dispatched work") }, nil)
			w.cancel()
			<-w.done
			if _, err := w.collaborationCall(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "configure", "mode": "natural"})); err != nil {
				t.Fatal(err)
			}
			// 模型提供的请求 ID 即使像内部收据，也不能越过待办保护。
			message, err := w.enqueueState(WorkspaceMatrix, WorkspaceProject, "changes_model_assignment", "This is an unfinished assignment.", state)
			if err != nil || message.Reference {
				t.Fatal("assignment incorrectly became reference", err)
			}
			if _, err := w.collaborationCall(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "configure", "mode": "split"})); err == nil || !strings.Contains(err.Error(), "pending role messages") {
				t.Fatal("unfinished assignment did not prevent template switch", err)
			}
			w.mu.Lock()
			defer w.mu.Unlock()
			if w.collaboration.Mode != "natural" || len(w.state.Messages) != 1 || w.state.Messages[0].State != state || w.state.Messages[0].Text != message.Text {
				t.Fatal("rejected switch changed pending work")
			}
		})
	}
}

func TestCollaborationHostContractsRemainScoped(t *testing.T) {
	withLegacyHomeTeam(t)
	for _, mode := range []HostMode{HostLegacy, HostCLI, HostOS} {
		t.Run(fmt.Sprintf("host=%q", mode), func(t *testing.T) {
			w := collaborationFixture(t, func(http.ResponseWriter, *http.Request) { t.Error("contract check called provider") }, nil)
			w.host.mode, w.host.terminal = mode, mode == HostCLI
			permissions := w.permissions(WorkspaceMatrix)
			if slices.Contains(permissions, "team") != (mode == HostOS) || slices.Contains(permissions, "agents") != (mode == HostOS) {
				t.Fatal("host permissions drifted", permissions)
			}
			contract := w.roleContract(WorkspaceMatrix)
			if strings.Contains(contract, "运行身份：Eyra（matrix）是宿主登记的母体") != (mode == HostOS) {
				t.Fatal("OS team contract leaked or disappeared")
			}
			for _, def := range WorkspaceToolDefinitions() {
				if def.Name != "workspace" {
					continue
				}
				encoded := string(rawJSON(w.toolDefinition(def)))
				if strings.Contains(encoded, "collaboration_split") != (mode == HostOS) {
					t.Fatal("OS tool schema leaked or disappeared")
				}
			}
			if mode != HostOS {
				for _, action := range []string{"status", "configure", "split", "retry"} {
					if _, err := w.Call(context.Background(), "workspace.collaboration", rawJSON(map[string]any{"action": action, "mode": "natural"})); err == nil {
						t.Fatal("non-OS host accepted collaboration RPC", action)
					}
				}
				for _, action := range []string{"dispatch", "message"} {
					if _, err := w.team(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": action, "role": WorkspaceExecution, "request_id": "host-denied", "message": "must not execute"})); err == nil {
						t.Fatal("non-OS host enabled fixed team", action)
					}
				}
			}
			if mode == HostCLI {
				for _, name := range []string{"browser", "settings", "exec", "wait", "apps"} {
					if slices.Contains(permissions, name) {
						t.Fatal("CLI gained desktop capability", name)
					}
				}
				if _, err := w.Call(context.Background(), "workspace.shutdown", nil); err == nil {
					t.Fatal("CLI accepted desktop shutdown")
				}
			}
		})
	}
	// Building an OS definition must not mutate later non-OS definitions.
	if strings.Contains(string(rawJSON(WorkspaceToolDefinitions())), "collaboration_split") {
		t.Fatal("shared tool definitions were mutated")
	}
}

func TestCollaborationFullCompactionLossRetainsArchive(t *testing.T) {
	for _, validSummary := range []bool{true, false} {
		t.Run(fmt.Sprintf("valid_summary=%v", validSummary), func(t *testing.T) {
			var calls, compactions, afterLoss atomic.Int32
			var lost atomic.Bool
			w := collaborationFixture(t, func(rw http.ResponseWriter, r *http.Request) {
				if lost.Load() {
					afterLoss.Add(1)
				}
				var body map[string]json.RawMessage
				_ = json.NewDecoder(r.Body).Decode(&body)
				var input []struct{ Content json.RawMessage }
				_ = json.Unmarshal(body["input"], &input)
				var instruction string
				if len(input) > 0 {
					_ = json.Unmarshal(input[0].Content, &instruction)
				}
				if len(body["tools"]) == 0 && instruction == compactInstruction() {
					compactions.Add(1)
					var content string
					if len(input) > 0 {
						_ = json.Unmarshal(input[len(input)-1].Content, &content)
					}
					var source struct {
						Digest string `json:"source_digest"`
					}
					_ = json.Unmarshal([]byte(content), &source)
					if source.Digest == "" {
						t.Error("full loop never reached a compact request")
					}
					lost.Store(true)
					answer := "invalid summary; original context must remain"
					if validSummary {
						answer = string(rawJSON(CompactSummary{SourceDigest: source.Digest, Goals: []string{"complete remaining steps"}, Constraints: []string{"do not replay tools"}, Decisions: []string{}, Progress: []string{"earlier steps completed"}, CriticalFacts: []string{}, OpenTasks: []string{"remaining work"}, NextSteps: []string{"continue only while connected"}, Uncertainties: []string{}}))
					}
					fixtureAnswer(rw, "compact-at-loss", answer, nil)
					return
				}
				if len(body["tools"]) == 0 {
					fixtureAnswer(rw, "continuity", "Retain completed evidence.", nil)
					return
				}
				n := calls.Add(1)
				if n > 8 {
					fixtureAnswer(rw, "missing-compaction", "Unexpected completion", nil)
					return
				}
				response := httptest.NewRecorder()
				fixtureAnswer(response, fmt.Sprintf("step-%d", n), "", []any{
					map[string]any{"type": "message", "id": fmt.Sprintf("msg-%d", n), "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": fmt.Sprintf("exact-original-step-%d ", n) + strings.Repeat("bounded progress ", 1800)}}},
					fixtureReportCall(fmt.Sprintf("report-%d", n), fmt.Sprintf("before-loss-%d.txt", n), "completed once\n"),
				})
				// OS 工具定义较大；固定 80 个输入 token 会使该夹具永远不触发工作中压缩。
				var payload map[string]any
				_ = json.Unmarshal(response.Body.Bytes(), &payload)
				payload["usage"] = map[string]any{"input_tokens": len(rawJSON(body)) / 3, "output_tokens": len(response.Body.Bytes()) / 3}
				rw.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(rw).Encode(payload)
			}, func(_ context.Context, child *Workspace, action string) (workspaceMembership, error) {
				if lost.Load() && action == "working" {
					return workspaceMembership{}, fmt.Errorf("station lost at compact boundary")
				}
				return confirmedStation(child, action), nil
			})
			settings, err := Load(w.config)
			if err != nil {
				t.Fatal(err)
			}
			settings.ContextWorkingTokens, settings.CompactPercent = 8192, 75
			setTestProfileCompact(settings, 6144)
			if err = settings.Save(); err != nil {
				t.Fatal(err)
			}
			child := createTestSplit(t, w, "compact-loss", "Finish eight steps; keep completed files and original evidence.")
			record := waitSplitRecord(t, child)
			if record.State != "failed" || compactions.Load() != 1 || afterLoss.Load() != 0 || calls.Load() < 1 || calls.Load() > 8 {
				t.Fatal("full compaction loss did not stop", record.State, record.Error, calls.Load(), compactions.Load(), afterLoss.Load())
			}
			if record.Requests != int(calls.Load()+1) || record.ToolTurns != int(calls.Load()) {
				t.Fatal("loss consumed extra request or tool", record.Requests, record.ToolTurns, calls.Load())
			}
			child.manager.mu.Lock()
			archive := child.manager.jobs[record.ID].archive
			child.manager.mu.Unlock()
			archive.mu.Lock()
			original := string(archive.memory)
			archive.mu.Unlock()
			for n := 1; n <= int(calls.Load()); n++ {
				name := fmt.Sprintf("before-loss-%d.txt", n)
				file, err := fixtureReportFile(child, name)
				if err != nil {
					t.Fatal(err)
				}
				data, err := os.ReadFile(file)
				if err != nil || string(data) != "completed once\n" || !strings.Contains(original, name) || !strings.Contains(original, fmt.Sprintf("exact-original-step-%d ", n)+strings.Repeat("bounded progress ", 1800)) {
					t.Fatal("completed effect or exact original lost", n, err)
				}
			}
			if _, err := fixtureReportFile(child, fmt.Sprintf("before-loss-%d.txt", calls.Load()+1)); err == nil {
				t.Fatal("tool continued after compact loss", err)
			}
			if validSummary && record.Compression == nil || !validSummary && (!strings.Contains(original, "compaction_deferred") || record.Compression != nil) {
				t.Fatal("summary outcome not preserved truthfully", record.Compression)
			}
		})
	}
}
