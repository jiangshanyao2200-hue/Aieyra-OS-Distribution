// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMemoryEditCompactionRuntime; TestMemoryEditPermitCancellationAndRecovery; TestManualCompactionRuntime; TestCompactionBoundaryIdentityAndRecovery
// Impact: python -B scripts/code-atlas.py show Core/context_compaction_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestMemoryEditCompactionRuntime(t *testing.T) {
	for _, scenario := range []string{"complete", "invalid", "nonreducing", "conflict"} {
		t.Run(scenario, func(t *testing.T) {
			var mu sync.Mutex
			var models, summaries int
			var recordID, finalRequest string
			m, dir := matrixTestManager(t, func(rw http.ResponseWriter, r *http.Request) {
				var body struct {
					Tools []json.RawMessage `json:"tools"`
					Input []struct {
						Content json.RawMessage `json:"content"`
					} `json:"input"`
				}
				_ = json.NewDecoder(r.Body).Decode(&body)
				mu.Lock()
				defer mu.Unlock()
				if len(body.Tools) == 0 || len(body.Input) > 0 && strings.Contains(string(body.Input[len(body.Input)-1].Content), "【工作上下文封存】") {
					summaries++
					text := "准备将颜色更新为NEW_EDIT_PROFILE；尚未执行更新，保留用户要求及记录ID。"
					if scenario == "invalid" {
						text = ""
					}
					if scenario == "nonreducing" {
						text = strings.Repeat("unreduced source ", 14000)
					}
					fixtureAnswer(rw, "summary", text, nil)
					return
				}
				models++
				finalRequest = string(rawJSON(body))
				call := func(args map[string]any) any {
					return map[string]any{"type": "function_call", "id": fmt.Sprintf("fc%d", models), "call_id": fmt.Sprintf("edit%d", models), "name": "memory", "arguments": string(rawJSON(args))}
				}
				update := map[string]any{"action": "update", "id": recordID, "expected_revision": 1, "content": "NEW_EDIT_PROFILE"}
				switch models {
				case 1:
					fixtureAnswer(rw, "unprepared", "", []any{map[string]any{"type": "message", "id": "observation", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": strings.Repeat("confirmed progress ", 4000)}}}, call(update)})
				case 2:
					fixtureAnswer(rw, "prepare", "", []any{call(map[string]any{"action": "compact", "purpose": "memory_edit"})})
				case 3:
					if scenario == "conflict" {
						update["expected_revision"] = 9
					}
					fixtureAnswer(rw, "edit", "", []any{call(update)})
				case 4:
					update["expected_revision"] = 2
					update["content"] = "FORBIDDEN_SECOND_EDIT"
					fixtureAnswer(rw, "second", "", []any{call(update)})
				default:
					fixtureAnswer(rw, "done", "done", nil)
				}
			})
			s, err := Load(m.config)
			if err != nil {
				t.Fatal(err)
			}
			s.MemoryEnabled = true
			s.CompactPercent = 0
			zero := 0
			for i := range s.APIProfiles {
				s.APIProfiles[i].CompactAtTokens = &zero
			}
			if err = s.Save(); err != nil {
				t.Fatal(err)
			}
			w := modeWorkspace(t, m.config, dir, HostOS)
			w.service = NewSettingsService(m.config)
			t.Cleanup(w.service.Close)
			rec, err := memoryResult(w.memory(context.Background(), map[string]any{"action": "record", "kind": "preference", "title": "颜色", "content": "OLD_EDIT_PROFILE", "request_id": "seed"}))
			if err != nil {
				t.Fatal(err)
			}
			recordID = memString(rec["record"].(map[string]any)["id"])
			w.mu.Lock()
			run, err := w.dispatchLocked(WorkspaceMatrix, workspaceID(), "更新颜色记忆，编辑前必须压缩")
			w.mu.Unlock()
			if err != nil {
				t.Fatal(err)
			}
			run, err = w.manager.Wait(context.Background(), w.state.ID, run.ID, 25000)
			if err != nil || run.State != "completed" {
				t.Fatal(run.State, run.Error, err)
			}
			raw, restored := workspaceCompactArchive(t, w, run.ID)
			rec, err = memoryResult(w.memory(context.Background(), map[string]any{"action": "read", "id": recordID}))
			if err != nil {
				t.Fatal(err)
			}
			want := "OLD_EDIT_PROFILE"
			revision := 1
			if scenario == "complete" {
				want = "NEW_EDIT_PROFILE"
				revision = 2
			}
			row := rec["record"].(map[string]any)
			if memString(row["content"]) != want || memInt(row["revision"]) != int64(revision) {
				t.Fatal("incorrect mutation", row)
			}
			if restored.Compaction == nil || restored.Compaction.Purpose != "memory_edit" {
				t.Fatal("missing preparation", restored.Compaction)
			}
			mu.Lock()
			defer mu.Unlock()
			if models != 5 || summaries != 1 {
				t.Fatal(models, summaries)
			}
			if scenario == "complete" && !strings.Contains(finalRequest, "NEW_EDIT_PROFILE") {
				t.Fatal("memory snapshot not refreshed")
			}
			if !bytes.Contains(raw, []byte("编辑记忆前必须")) {
				t.Fatal("unprepared/second edit was not refused")
			}
		})
	}
}

func TestMemoryEditPermitCancellationAndRecovery(t *testing.T) {
	ctx := context.WithValue(context.Background(), compactBoundaryKey{}, true)
	ctx = context.WithValue(ctx, memoryEditHistoryKey{}, []Message{})
	for _, state := range []string{"scheduled", "running", "failed", "cancelled", "skipped", "deferred", "interrupted"} {
		c := &contextCompaction{last: &CompactionState{RequestID: "r", State: state, Purpose: "memory_edit"}}
		c.allowMemoryEdit()
		if c.consumeMemoryEdit(ctx) == nil {
			t.Fatal("non-completion permitted edit", state)
		}
	}
	c := &contextCompaction{last: &CompactionState{RequestID: "r", State: "completed", Purpose: "memory_edit"}}
	if c.consumeMemoryEdit(ctx) == nil {
		t.Fatal("restored completion granted permission")
	}
	c.allowMemoryEdit()
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if c.consumeMemoryEdit(cancelled) == nil {
		t.Fatal("cancelled edit accepted")
	}
	if err := c.consumeMemoryEdit(ctx); err != nil {
		t.Fatal(err)
	}
	if c.consumeMemoryEdit(ctx) == nil {
		t.Fatal("permit reused")
	}
	c.allowMemoryEdit()
	changed := context.WithValue(ctx, memoryEditHistoryKey{}, []Message{{Role: RoleUser, Content: "new request"}})
	if c.consumeMemoryEdit(changed) == nil {
		t.Fatal("stale preparation accepted")
	}
}

// Exercise the real dispatcher, transaction journal, provider requests, PAC
// store and checkpoint restore with the automatic threshold explicitly off.
func TestManualCompactionRuntime(t *testing.T) {
	for _, providerMode := range []string{"legacy-local", "legacy-pac", "selected-structured", "selected-pac"} {
		pac := providerMode == "legacy-pac" || providerMode == "selected-pac"
		memory := providerMode != "legacy-local"
		for _, scenario := range []string{"complete", "invalid", "nonreducing", "short"} {
			t.Run(fmt.Sprintf("%s/%s", providerMode, scenario), func(t *testing.T) {
				var mu sync.Mutex
				models, summaries := 0, 0
				finalRequest := ""
				var results []json.RawMessage
				m, dir := matrixTestManager(t, func(rw http.ResponseWriter, r *http.Request) {
					var body struct {
						Tools []json.RawMessage `json:"tools"`
						Input []struct {
							Type    string          `json:"type"`
							Content json.RawMessage `json:"content"`
							Output  string          `json:"output"`
						} `json:"input"`
					}
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
					}
					mu.Lock()
					defer mu.Unlock()
					summary := len(body.Tools) == 0 || len(body.Input) > 0 && strings.Contains(string(body.Input[len(body.Input)-1].Content), "【工作上下文封存】")
					if summary {
						summaries++
						text := "已完成一次文件写入，核对词青石70。继续当前任务，禁止重复已完成的工具。"
						if !pac {
							var input string
							_ = json.Unmarshal(body.Input[len(body.Input)-1].Content, &input)
							var envelope struct {
								Digest string `json:"source_digest"`
							}
							_ = json.Unmarshal([]byte(input), &envelope)
							text = string(rawJSON(CompactSummary{SourceDigest: envelope.Digest, Goals: []string{"完成青石70任务"}, Constraints: []string{"不重复文件操作"}, Decisions: []string{}, Progress: []string{"once.txt已写入"}, CriticalFacts: []string{"青石70"}, OpenTasks: []string{"回复完成"}, NextSteps: []string{"继续"}, Uncertainties: []string{}}))
						}
						if scenario == "invalid" {
							text = ""
						}
						if scenario == "nonreducing" {
							if pac {
								text = strings.Repeat("unreduced history ", 14000)
							} else {
								var v CompactSummary
								_ = json.Unmarshal([]byte(text), &v)
								v.Progress = []string{strings.Repeat("unreduced history ", 14000)}
								text = string(rawJSON(v))
							}
						}
						fixtureAnswer(rw, "summary", text, nil)
						return
					}
					models++
					finalRequest = string(rawJSON(body))
					results = nil
					for _, i := range body.Input {
						if i.Type == "function_call_output" {
							results = append(results, json.RawMessage(i.Output))
						}
					}
					call := func(name, args string) any {
						return map[string]any{"type": "function_call", "id": fmt.Sprintf("f%d", models), "call_id": fmt.Sprintf("manual%d", models), "name": name, "arguments": args}
					}
					switch models {
					case 1:
						text := "EXACT_OLD_OBSERVATION " + strings.Repeat("bounded progress ", 4000)
						if scenario == "short" {
							text = "short history"
						}
						fixtureAnswer(rw, "first", "", []any{map[string]any{"type": "message", "id": "observation", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": text}}}, call("report", string(rawJSON(map[string]any{"action": "report", "format": "md", "title": "once.txt", "content": "once only\n"})))})
					case 2:
						fixtureAnswer(rw, "compact", "", []any{call("memory", `{"action":"compact"}`)})
					case 3:
						fixtureAnswer(rw, "status", "", []any{call("memory", `{"action":"compact_status"}`)})
					default:
						fixtureAnswer(rw, "done", "MANUAL_WORK_COMPLETED", nil)
					}
				})
				s, err := Load(m.config)
				if err != nil {
					t.Fatal(err)
				}
				s.MemoryEnabled = memory
				s.CompactPercent = 0
				zero := 0
				for i := range s.APIProfiles {
					s.APIProfiles[i].CompactAtTokens = &zero
				}
				if err = s.Save(); err != nil {
					t.Fatal(err)
				}
				w := modeWorkspace(t, m.config, dir, HostOS)
				w.service = NewSettingsService(m.config)
				t.Cleanup(w.service.Close)
				if strings.HasPrefix(providerMode, "selected-") {
					contextTestAction(t, w, "new", map[string]any{"auto_memory": true})
					contextTestAction(t, w, "provider", map[string]any{"provider": legacyContextProvider(pac)})
				}
				w.mu.Lock()
				r, err := w.dispatchLocked(WorkspaceMatrix, workspaceID(), "EXACT_LATEST_USER 青石70: finish once, then continue.")
				w.mu.Unlock()
				if err != nil {
					t.Fatal(err)
				}
				r, err = w.manager.Wait(context.Background(), w.state.ID, r.ID, 25000)
				if err != nil || r.State != "completed" {
					t.Fatalf("state=%s error=%s wait=%v", r.State, r.Error, err)
				}
				raw, restored := workspaceCompactArchive(t, w, r.ID)
				want := "completed"
				if scenario == "invalid" {
					want = "deferred"
				}
				if scenario == "nonreducing" || scenario == "short" {
					want = "skipped"
				}
				if restored.Compaction == nil || restored.Compaction.State != want || restored.Compaction.Trigger != "manual" {
					t.Fatalf("state=%+v want %s", restored.Compaction, want)
				}
				mu.Lock()
				defer mu.Unlock()
				if models != 4 || scenario == "short" && summaries != 0 || scenario != "short" && summaries != 1 {
					t.Fatalf("model=%d summary=%d", models, summaries)
				}
				if !strings.Contains(finalRequest, "EXACT_LATEST_USER") || !strings.Contains(finalRequest, "context_compaction_result") {
					t.Fatal("latest exact user or completion outcome lost")
				}
				if want == "completed" {
					if restored.Checkpoint == nil || restored.Checkpoint.Compaction.RequestID != restored.Compaction.RequestID || restored.Checkpoint.Compression.AfterTokens >= restored.Checkpoint.Compression.BeforeTokens {
						t.Fatal("completion lacks durable shrinking checkpoint")
					}
					if strings.Contains(finalRequest, "EXACT_OLD_OBSERVATION") || !bytes.Contains(raw, []byte("EXACT_OLD_OBSERVATION")) {
						t.Fatal("checkpoint did not replace input while preserving originals")
					}
					if pac != (restored.Checkpoint.Packet != "") {
						t.Fatal("wrong memory destination")
					}
				} else if restored.Checkpoint != nil || scenario != "short" && !strings.Contains(finalRequest, "EXACT_OLD_OBSERVATION") {
					t.Fatal("unsuccessful compaction changed original context")
				}
				assertFixtureReport(t, w, "once.txt", "once only\n")
				calls, pairs := map[string]int{}, map[string]int{}
				for _, msg := range restored.Messages {
					for _, c := range msg.ToolCalls {
						calls[c.ID]++
					}
					if msg.Role == RoleTool {
						pairs[msg.ToolCallID]++
					}
				}
				if len(calls) != 3 || len(pairs) != 3 {
					t.Fatal("tool pairs missing")
				}
				for id, n := range calls {
					if n != 1 || pairs[id] != 1 {
						t.Fatal("duplicate/missing pair", id)
					}
				}
				var status struct {
					OK         bool             `json:"ok"`
					Compaction *CompactionState `json:"compaction"`
				}
				if len(results) == 0 || json.Unmarshal(results[len(results)-1], &status) != nil || !status.OK || status.Compaction == nil || status.Compaction.State != want {
					t.Fatalf("status receipt: %s", results)
				}
				snap, e := w.readPAC(context.Background())
				if memory && e != nil || !memory && e == nil {
					t.Fatal(e)
				}
				if (pac && want == "completed") != (len(snap.Packets) == 1) {
					t.Fatal("unexpected PAC storage", len(snap.Packets))
				}
				workspaceCompactUsage(t, r, models, summaries)
			})
		}
	}
}

func TestCompactionBoundaryIdentityAndRecovery(t *testing.T) {
	c := &contextCompaction{}
	ctx := context.WithValue(context.Background(), contextCompactionKey{}, c)
	if _, err := requestContextCompaction(ctx, map[string]any{"action": "compact"}, "call"); err == nil {
		t.Fatal("mixed/nested boundary accepted")
	}
	ctx = context.WithValue(ctx, compactBoundaryKey{}, true)
	if _, err := requestContextCompaction(ctx, map[string]any{"action": "compact", "request_id": "forged"}, "call"); err == nil {
		t.Fatal("caller identity accepted")
	}
	ctx = context.WithValue(ctx, toolInvocationKey{}, "durable1:call")
	if _, err := requestContextCompaction(ctx, map[string]any{"action": "compact"}, "call"); err != nil {
		t.Fatal(err)
	}
	id := c.snapshot().RequestID
	if _, err := requestContextCompaction(ctx, map[string]any{"action": "compact"}, "call"); err != nil || c.snapshot().RequestID != id {
		t.Fatal("replay rescheduled")
	}
	a := &SessionArchive{Path: filepath.Join(t.TempDir(), "session.jsonl")}
	if err := a.Start("test"); err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	if err := c.record(a, "running", ""); err != nil {
		t.Fatal(err)
	}
	restored, err := a.read()
	if err != nil || restored.Compaction.State != "running" {
		t.Fatal("pending state restore", err)
	}
	if err = c.record(a, "interrupted", "PREVIOUS_RUN_INTERRUPTED"); err != nil {
		t.Fatal(err)
	}
	ctx = context.WithValue(ctx, toolInvocationKey{}, "durable2:call")
	if _, err = requestContextCompaction(ctx, map[string]any{"action": "compact"}, "call"); err != nil || c.snapshot().RequestID == id {
		t.Fatal("new invocation reused old identity", err)
	}
	v := c.snapshot()
	cp := &Checkpoint{Covered: 3}
	if got := c.completed(cp, "recovery"); got.RequestID == v.RequestID {
		t.Fatal("unrelated PAC recovery claimed scheduled request")
	}
	v.State = "running"
	v.Covered = 3
	c.set(v)
	if got := c.completed(cp, "recovery"); got.RequestID != v.RequestID {
		t.Fatal("matching PAC recovery lost identity")
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err = requestContextCompaction(cancelled, map[string]any{"action": "compact"}, "call"); err == nil {
		t.Fatal("cancelled request accepted")
	}
	v.State = "completed"
	v.Updated = time.Now().UTC().Format(time.RFC3339Nano)
	if err = validateCompaction(v, 3, false); err == nil {
		t.Fatal("standalone success accepted without checkpoint")
	}
	// Failed durable commit must never publish success, even if the summary
	// itself is valid. A directory at the archive path simulates a write error.
	v.State = "running"
	c.set(v)
	bad := &SessionArchive{Path: t.TempDir()}
	if err = (&AgentManager{}).commitContextCheckpoint(context.Background(), nil, bad, cp, c, "manual"); err == nil || c.snapshot().State != "running" {
		t.Fatal("failed checkpoint published completion", err)
	}
}
