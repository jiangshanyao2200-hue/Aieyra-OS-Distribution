// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMotherIdentityRuntime
// Impact: python -B scripts/code-atlas.py show Core/workspace_identity_runtime_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestMotherIdentityRuntime(t *testing.T) {
	for _, scenario := range []string{"completed", "task_complexity", "missing_contact", "paraphrased_reference", "explicit_exit", "invalid_summary", "cancel_summary", "cancel_active", "changed_model", "custom_contact", "pac", "queued_help", "repair_takeover"} {
		t.Run(scenario, func(t *testing.T) {
			var mu sync.Mutex
			models, summaries := 0, 0
			var config string
			var workspaceDir string
			var workspace *Workspace
			var repairSource string
			var repairManager *AgentManager
			targetContact := ""
			var activePrefix, activeTools string
			cancelEntered := make(chan struct{})
			m, dir := matrixTestManager(t, func(rw http.ResponseWriter, req *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				if strings.Contains(string(rawJSON(body)), "INDEPENDENT-FAILURE-SOURCE") {
					rw.WriteHeader(http.StatusBadRequest)
					fmt.Fprint(rw, `{"error":{"code":"repair_fixture","message":"independent fixture failure"}}`)
					return
				}
				mu.Lock()
				defer mu.Unlock()
				tools, _ := body["tools"].([]any)
				if strings.Contains(string(rawJSON(body)), "PRIVATE_TARGET_HISTORY") {
					for _, tool := range tools {
						if tool.(map[string]any)["name"] == "agents" {
							t.Error("target's private chat leaked into mother")
						}
					}
					fixtureAnswer(rw, "private-contact", "PRIVATE_TARGET_RESULT", nil)
					return
				}
				inputs, _ := body["input"].([]any)
				isPAC := len(inputs) > 0 && strings.Contains(string(rawJSON(inputs[len(inputs)-1])), "【工作上下文封存】")
				if len(tools) == 0 || isPAC {
					summaries++
					if isPAC {
						fixtureAnswer(rw, "pac-checkpoint", "用户要求成为执行角色；交接已准备，需完成identity.txt后返回母体。原工具尚未执行。", nil)
						return
					}
					if scenario == "cancel_summary" {
						close(cancelEntered)
						<-req.Context().Done()
						return
					}
					input := body["input"].([]any)
					var source struct {
						Digest string          `json:"source_digest"`
						Source json.RawMessage `json:"source"`
					}
					_ = json.Unmarshal([]byte(input[len(input)-1].(map[string]any)["content"].(string)), &source)
					if source.Digest == "" || source.Digest != fmt.Sprintf("%x", sha256.Sum256(source.Source)) {
						t.Error("handoff compaction was not bound to exact source")
					}
					if !strings.Contains(string(source.Source), "identity_enter") || !strings.Contains(string(source.Source), "function") && !strings.Contains(string(source.Source), "tool") {
						t.Error("handoff omitted committed tool turn")
					}
					if scenario == "invalid_summary" {
						fixtureAnswer(rw, "bad-summary", "invalid summary", nil)
						return
					}
					summary := CompactSummary{SourceDigest: source.Digest, Goals: []string{"write one artifact as the requested specialist"}, Constraints: []string{"return to mother afterwards"}, Decisions: []string{}, Progress: []string{"handoff prepared; no patch yet"}, CriticalFacts: []string{"mother owns context and model"}, OpenTasks: []string{"write identity.txt"}, NextSteps: []string{"execute patch"}, Uncertainties: []string{}}
					fixtureAnswer(rw, "compact", string(rawJSON(summary)), nil)
					return
				}
				models++
				wire := string(rawJSON(body))
				if scenario == "queued_help" {
					if models <= 3 && strings.Contains(wire, "QUEUED_MEMBER_HELP") || models == 4 && !strings.Contains(wire, "QUEUED_MEMBER_HELP") {
						t.Error("member help crossed the professional handoff boundary")
					}
				}
				call := func(name string, args any) any {
					return map[string]any{"type": "function_call", "id": fmt.Sprintf("fc-%d", models), "call_id": fmt.Sprintf("call-%d", models), "name": name, "arguments": string(rawJSON(args))}
				}
				hasTool := func(name string) bool {
					for _, value := range tools {
						if value.(map[string]any)["name"] == name {
							return true
						}
					}
					return false
				}
				wantModel := "fixture"
				if scenario == "changed_model" && models >= 4 {
					wantModel = "replacement-mother-model"
				}
				if body["model"] != wantModel {
					t.Error("identity changed the mother's model", body["model"])
				}
				step := models
				if scenario == "missing_contact" || scenario == "paraphrased_reference" {
					if models == 1 {
						args := map[string]any{"action": "identity_enter", "request_id": "invalid-handoff", "reason": "verify the requested artifact", "task": "write identity.txt", "command": map[string]any{"trigger": "user_request", "user_reference": "become Cota for this task", "success": "artifact exists", "exit": "after verification", "plan": []string{"write artifact", "return to mother"}, "unresolved": []string{}}}
						if scenario == "paraphrased_reference" {
							args["contact_id"] = targetContact
							args["command"].(map[string]any)["user_reference"] = "become Cota and finish the artifact"
						}
						fixtureAnswer(rw, "invalid-handoff", "", []any{call("agents", args)})
						return
					}
					if models == 2 {
						want := "顶层 contact_id"
						if scenario == "paraphrased_reference" {
							want = "逐字引用实际用户消息中的连续原文片段"
						}
						if summaries != 0 || !strings.Contains(wire, want) || !hasTool("community") || strings.Contains(wire, "mother_identity_handoff") {
							t.Error("invalid handoff did not retain the mother and explain how to recover")
						}
						if _, err := os.Stat(filepath.Join(workspaceDir, "identity.txt")); !os.IsNotExist(err) {
							t.Error("invalid handoff produced a side effect", err)
						}
					}
					step--
				}
				switch step {
				case 1:
					if !hasTool("apply_patch") || !hasTool("community") || strings.Contains(string(rawJSON(body["input"].([]any)[:2])), "mother_identity_handoff") {
						t.Error("initial mother lost direct tools or prematurely adopted specialist identity")
					}
					args := map[string]any{"action": "identity_enter", "request_id": "handoff-once", "contact_id": targetContact, "reason": "user explicitly requested direct work", "task": "write identity.txt", "command": map[string]any{"trigger": "user_request", "user_reference": "become Cota for this task", "success": "artifact exists", "exit": "after artifact verification or any blocker", "plan": []string{"write artifact", "return to mother"}, "unresolved": []string{}}}
					if scenario == "task_complexity" {
						args["reason"] = "this task benefits from a focused professional plan and verification"
						command := args["command"].(map[string]any)
						command["trigger"], command["user_reference"] = "task_complexity", "write the artifact and verify its contents"
					}
					if scenario == "repair_takeover" {
						args["reason"] = "original independent executor failed and the mother received its event"
						command := args["command"].(map[string]any)
						command["trigger"], command["user_reference"] = "delegation_failed", ""
						command["failed_agent"], command["failed_generation"] = repairSource, 1
					}
					fixtureAnswer(rw, "prepare", "", []any{map[string]any{"type": "message", "id": "prior-progress", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": strings.Repeat("verified prior observation ", 2500)}}}, call("agents", args)})
				case 2:
					if scenario == "queued_help" {
						r, _ := repairManager.Status(repairManager.owner, repairSource)
						workspace.mu.Lock()
						_, err := workspace.enqueueRepairLocked(repairManager, r, "help", "member needs assistance", "member-help", "QUEUED_MEMBER_HELP: inspect the independent blocked task after returning.", nil)
						workspace.mu.Unlock()
						if err != nil {
							t.Error(err)
						}
					}
					if scenario == "cancel_active" {
						close(cancelEntered)
						<-req.Context().Done()
						return
					}
					if scenario != "invalid_summary" {
						if !hasTool("apply_patch") || hasTool("community") || !strings.Contains(wire, "目标角色的其他会话及模型不会带入") {
							t.Error("specialist did not receive its own prompt/tool boundary")
						}
						prefix := body["input"].([]any)[:2]
						activePrefix, activeTools = string(rawJSON(prefix)), string(rawJSON(tools))
						if scenario == "custom_contact" && (!strings.Contains(activePrefix, "CUSTOM_TARGET_INSTRUCTIONS") || strings.Contains(wire, "PRIVATE_TARGET_RESULT")) {
							t.Error("custom role prompt/history boundary incorrect")
						}
					} else {
						if !hasTool("community") || strings.Contains(string(rawJSON(body["input"].([]any)[:2])), "mother_identity_handoff") {
							t.Error("failed compaction changed mother identity or tools")
						}
						fixtureAnswer(rw, "handoff-failed", "compression failed; mother retained original task and tools", nil)
						return
					}
					// 第109轮（Q8）：原 revoked/disabled 场景改的是 Cota 的固定角色设置；Cota/Vaya 已不能作为
					// 专业身份目标（见 TestMotherIdentityRefusesCodingMembers），这两个场景随之退役。
					if scenario == "changed_model" {
						s, err := Load(config)
						if err != nil {
							t.Error(err)
							return
						}
						s.APIProfiles[0].Model = "replacement-mother-model"
						if err = s.Save(); err != nil {
							t.Error(err)
						}
					}
					fixtureAnswer(rw, "patch", "", []any{call("apply_patch", map[string]any{"patch": "*** Begin Patch\n*** Add File: identity.txt\n+executed once\n*** End Patch"})})
				case 3:
					if scenario == "completed" || scenario == "explicit_exit" {
						if activeTools != string(rawJSON(tools)) || activePrefix != string(rawJSON(body["input"].([]any)[:2])) {
							t.Error("unchanged professional prefix/tools broke cache stability")
						}
					}
					if scenario == "explicit_exit" {
						fixtureAnswer(rw, "exit", "", []any{call("agents", map[string]any{"action": "identity_exit", "request_id": "handoff-once", "message": "artifact complete; no unresolved operations"})})
						return
					}
					fixtureAnswer(rw, "specialist-finished", "specialist work finished", nil)
				default:
					if !hasTool("apply_patch") || !hasTool("community") || strings.Contains(string(rawJSON(body["input"].([]any)[:2])), "mother_identity_handoff") {
						t.Error("final mother request retained specialist authority")
					}
					fixtureAnswer(rw, "mother-finished", "MOTHER-FINAL", nil)
				}
			})
			config = m.config
			workspaceDir = dir
			s, err := Load(config)
			if err != nil {
				t.Fatal(err)
			}
			s.MemoryEnabled = scenario == "pac"
			zero := 0
			s.APIProfiles[0].CompactAtTokens = &zero
			// The target has a distinct model; adoption must retain the mother.
			other := s.APIProfiles[0]
			other.ID = "cota-model"
			other.Model = "must-not-use-cota-model"
			s.APIProfiles = append(s.APIProfiles, other)
			s.ExecutionProfile = other.ID
			if err = s.Save(); err != nil {
				t.Fatal(err)
			}
			h, w := openCoreLinkHome(t, config, dir)
			workspace = w
			defer h.Close()
			// 第109轮（Q8）：母体不再切换成 Cota/Vaya，专业身份只用于其他联系人。
			value, e := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_create", "request_id": "custom-contact", "name": "Custom Cota", "model_id": "cota-model", "prompt_text": "CUSTOM_TARGET_INSTRUCTIONS", "tools": []string{"apply_patch"}, "workdir": dir}))
			if e != nil {
				t.Fatal(e)
			}
			targetContact = value.(map[string]any)["id"].(string)
			if scenario == "custom_contact" {
				cm, _ := h.conversationManager()
				if _, e = cm.Send(cm.owner, targetContact, "private", "PRIVATE_TARGET_HISTORY"); e != nil {
					t.Fatal(e)
				}
				if r, e := cm.Wait(context.Background(), cm.owner, targetContact, 10000); e != nil || r.State != "completed" {
					t.Fatal(r.State, r.Error, e)
				}
			}
			if scenario == "queued_help" || scenario == "repair_takeover" {
				value, e := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_create", "request_id": "repair-source", "name": "Independent source", "model_id": "local-model", "prompt_text": "INDEPENDENT-FAILURE-SOURCE"}))
				if e != nil {
					t.Fatal(e)
				}
				repairSource = value.(map[string]any)["id"].(string)
				repairManager, _ = h.conversationManager()
				w.manager.linkRootService.Store(repairManager)
			}
			if scenario == "repair_takeover" {
				if _, e := repairManager.Send(repairManager.owner, repairSource, "source-user", "write the requested artifact"); e != nil {
					t.Fatal(e)
				}
			} else {
				if scenario == "queued_help" {
					repairManager.mu.Lock()
					repairManager.jobs[repairSource].record.Generation = 1
					repairManager.mu.Unlock()
				}
				task := "Please become Cota for this task and write the artifact."
				if scenario == "task_complexity" {
					task = "Please write the artifact and verify its contents."
				}
				if _, err = w.Send("identity-task", task); err != nil {
					t.Fatal(err)
				}
			}
			waitCoreLink(t, "mother did not dispatch", func() bool { w.mu.Lock(); defer w.mu.Unlock(); return w.state.Roles[WorkspaceMatrix] != "" })
			w.mu.Lock()
			actor := w.state.Roles[WorkspaceMatrix]
			archivePath := w.contextArchivePath(w.contextSessionLocked().Archive)
			w.mu.Unlock()
			cancelled := scenario == "cancel_summary" || scenario == "cancel_active"
			if cancelled {
				select {
				case <-cancelEntered:
				case <-time.After(10 * time.Second):
					t.Fatal("did not reach cancellation boundary")
				}
				if err = w.Cancel(); err != nil {
					t.Fatal(err)
				}
			}
			result, err := w.manager.Wait(context.Background(), w.manager.owner, actor, 20000)
			if err != nil || cancelled && result.State != "cancelled" || !cancelled && result.State != "completed" {
				t.Fatalf("runtime failed: %s %s %v", result.State, result.Error, err)
			}
			mu.Lock()
			actualModels, actualSummaries := models, summaries
			mu.Unlock()
			if actualSummaries != 1 {
				t.Fatalf("want one explicit handoff compression, got %d (model calls %d)", actualSummaries, actualModels)
			}
			if scenario == "repair_takeover" {
				source, e := repairManager.Status(repairManager.owner, repairSource)
				if e != nil || source.Generation != 1 || source.State != "failed" || source.MotherTakeover == nil || source.MotherTakeover.RepairEvent == "" || result.RepairRun == nil {
					t.Fatal("global repair lost its original generation, takeover or budget", e)
				}
			}
			_, fileErr := os.Stat(filepath.Join(dir, "identity.txt"))
			if cancelled || scenario == "invalid_summary" {
				if !os.IsNotExist(fileErr) {
					t.Fatal("ungranted patch ran", fileErr)
				}
			} else if fileErr != nil {
				t.Fatal(fileErr)
			}
			if scenario == "completed" {
				// File-change references now originate from a real professional
				// handoff. They remain idle until Vaya's next directed boundary.
				w.mu.Lock()
				references := 0
				for _, msg := range w.state.Messages {
					if msg.Reference && msg.From == WorkspaceMatrix && msg.To == WorkspaceProject && msg.State == "context" && strings.Contains(msg.Text, "identity.txt") {
						references++
					}
				}
				w.mu.Unlock()
				if references != 1 {
					t.Fatal("professional patch did not retain exactly one idle reference", references)
				}
				a := &SessionArchive{ephemeral: true}
				added, err := w.drain(WorkspaceProject, a, nil)
				if err != nil || !strings.Contains(string(rawJSON(added)), "identity.txt") {
					t.Fatal("directed review lost the professional change reference", err)
				}
				again, err := w.drain(WorkspaceProject, a, added)
				if err != nil || len(again) != 0 {
					t.Fatal("professional change reference replayed", err)
				}
			}
			restored, err := (&SessionArchive{Path: archivePath}).read()
			if err != nil {
				t.Fatal("identity history cannot reopen", err)
			}
			v := restored.MotherIdentity
			if v == nil || identityOpen(v) || v.Model != "local-model" || len(restored.MotherIdentities) != 1 {
				t.Fatal("handoff did not persist final identity", v)
			}
			if scenario == "invalid_summary" || scenario == "cancel_summary" {
				if v.Phase != "aborted" {
					t.Fatal(v.Phase)
				}
			} else if scenario == "task_complexity" && (v.Trigger != "task_complexity" || v.UserReference != "write the artifact and verify its contents" || len(v.Plan) != 2 || v.SourceMessages == 0) {
				t.Fatal("autonomous handoff lost task, plan or history", v)
			} else if v.Phase != "exited" || v.Checkpoint == 0 || !cancelled && result.Result != "MOTHER-FINAL" {
				t.Fatal("mother did not resume after specialist", v.Phase, v.Checkpoint, result.Result)
			}
		})
	}
}
