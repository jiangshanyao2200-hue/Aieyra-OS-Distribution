// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMotherConversationCompactionRuntime; TestMotherConversationCompactionCrashRecoveryDoesNotCallModel; TestMotherConversationCompactionToolRuntime
// Impact: python -B scripts/code-atlas.py show Core/conversation_compaction_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestMotherConversationCompactionRuntime(t *testing.T) {
	for _, scenario := range []string{"idle", "busy", "invalid", "cancel", "stopped", "empty"} {
		t.Run(scenario, func(t *testing.T) {
			var models, summaries atomic.Int32
			entered, release := make(chan struct{}), make(chan struct{})
			var once sync.Once
			m, _ := matrixTestManager(t, func(rw http.ResponseWriter, req *http.Request) {
				var body map[string]any
				_ = json.NewDecoder(req.Body).Decode(&body)
				tools, _ := body["tools"].([]any)
				if len(tools) > 0 {
					n := models.Add(1)
					if scenario == "busy" && n == 1 {
						close(entered)
						select {
						case <-release:
						case <-req.Context().Done():
							return
						}
					}
					if n == 1 {
						fixtureAnswer(rw, "original", "ORIGINAL_RESULT "+strings.Repeat("verified observation ", 2400), nil)
					} else {
						fixtureAnswer(rw, "continued", "FINAL_RESULT", nil)
					}
					return
				}
				summaries.Add(1)
				if scenario == "cancel" {
					close(entered)
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
					t.Error("compaction source was not verified")
				}
				if strings.Contains(string(source.Source), "MOTHER_PRIVATE") || strings.Contains(string(source.Source), "MAINTENANCE_REASON") {
					t.Error("maintenance injected mother data into target history")
				}
				if scenario == "invalid" {
					fixtureAnswer(rw, "invalid", "not a valid summary", nil)
					return
				}
				summary := CompactSummary{SourceDigest: source.Digest, Goals: []string{"retain conversation"}, Constraints: []string{}, Decisions: []string{}, Progress: []string{"completed original work"}, CriticalFacts: []string{"original observations retained in archive"}, OpenTasks: []string{}, NextSteps: []string{}, Uncertainties: []string{}}
				fixtureAnswer(rw, "summary", string(rawJSON(summary)), nil)
			})
			s, err := Load(m.config)
			if err != nil {
				t.Fatal(err)
			}
			s.MemoryEnabled = false
			zero := 0
			s.APIProfiles[0].CompactAtTokens = &zero
			if err = s.Save(); err != nil {
				t.Fatal(err)
			}
			h := NewWorkspaceHost(m.config, "", "")
			defer h.Close()
			defer once.Do(func() { close(release) })
			value, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_create", "request_id": "maintenance-target", "name": "Target", "model_id": "local-model", "prompt_text": "TARGET_COMPACTION"}))
			if err != nil {
				t.Fatal(err)
			}
			id := value.(map[string]any)["id"].(string)
			cm, _ := h.conversationManager()
			if scenario != "empty" {
				if _, err = cm.Send(cm.owner, id, "user-original", "user original input"); err != nil {
					t.Fatal(err)
				}
				if scenario == "busy" {
					select {
					case <-entered:
					case <-time.After(10 * time.Second):
						t.Fatal("target did not start")
					}
				} else {
					if r, e := cm.Wait(context.Background(), cm.owner, id, 10000); e != nil || r.State != "completed" {
						t.Fatal(r.State, r.Error, e)
					}
				}
			}
			before, _ := cm.Status(cm.owner, id)
			path, _ := SessionPath(filepath.Join(cm.dir, "config.json"), id)
			var original *RestoredSession
			if scenario != "empty" {
				original, err = (&SessionArchive{Path: path}).read()
				if err != nil {
					t.Fatal(err)
				}
			}
			if scenario == "stopped" {
				if err = cm.CancelGeneration(cm.owner, id, before.Generation); err != nil {
					t.Fatal(err)
				}
			}
			request := func() (any, error) {
				return cm.requestConversationCompaction(context.Background(), id, "compact-once", "MAINTENANCE_REASON", "MOTHER_PRIVATE", before.Generation)
			}
			value, err = request()
			if scenario == "stopped" {
				if err == nil || summaries.Load() != 0 {
					t.Fatal("stopped target was revived", err)
				}
				return
			}
			if err != nil || value.(*conversationCompaction).State != "scheduled" {
				t.Fatal(value, err)
			}
			if scenario == "busy" {
				once.Do(func() { close(release) })
			}
			if scenario == "cancel" {
				select {
				case <-entered:
				case <-time.After(10 * time.Second):
					t.Fatal("summary did not start")
				}
				if err = cm.CancelGeneration(cm.owner, id, before.Generation); err != nil {
					t.Fatal(err)
				}
			}
			after, err := cm.Wait(context.Background(), cm.owner, id, 15000)
			if err != nil {
				t.Fatal(err)
			}
			if after.Generation != before.Generation || string(rawJSON(after.Turns)) != string(rawJSON(before.Turns)) || string(rawJSON(after.TurnOrigins)) != string(rawJSON(before.TurnOrigins)) {
				t.Fatal("maintenance created a new user turn")
			}
			if scenario != "busy" && (after.State != before.State || after.Result != before.Result || after.Error != before.Error || string(rawJSON(after.History)) != string(rawJSON(before.History))) {
				t.Fatal("idle maintenance rewrote the original task outcome", before.State, after.State, after.Error)
			}
			out, err := cm.conversationCompactionStatus(id, "compact-once")
			if err != nil {
				t.Fatal(err)
			}
			receipt := out.(*conversationCompaction)
			wantState := "completed"
			if scenario == "invalid" {
				wantState = "deferred"
			}
			if scenario == "cancel" {
				wantState = "cancelled"
			}
			if scenario == "empty" {
				wantState = "skipped"
			}
			if receipt.State != wantState {
				t.Fatalf("maintenance=%s want=%s error=%s result=%+v", receipt.State, wantState, receipt.Error, receipt.Outcome)
			}
			restored, err := (&SessionArchive{Path: path}).read()
			if err != nil {
				t.Fatal(err)
			}
			if scenario != "busy" && original != nil && string(rawJSON(restored.Messages)) != string(rawJSON(original.Messages)) {
				t.Fatal("maintenance rewrote/inserted chat messages")
			}
			if scenario == "invalid" || scenario == "cancel" {
				if restored.Checkpoint != nil {
					t.Fatal("failed summary replaced original context")
				}
			}
			if _, err = request(); err != nil {
				t.Fatal("idempotent maintenance query failed", err)
			}
			wantModels := int32(1)
			if scenario == "busy" {
				wantModels = 2
			}
			if scenario == "empty" {
				wantModels = 0
			}
			wantSummaries := int32(1)
			if scenario == "empty" {
				wantSummaries = 0
			}
			if models.Load() != wantModels || summaries.Load() != wantSummaries {
				t.Fatal("maintenance ran ordinary conversation or replayed a paid request", models.Load(), summaries.Load())
			}
		})
	}
}

func TestMotherConversationCompactionCrashRecoveryDoesNotCallModel(t *testing.T) {
	for _, committed := range []bool{false, true} {
		t.Run(fmt.Sprint(committed), func(t *testing.T) {
			var calls atomic.Int32
			m, _ := matrixTestManager(t, func(rw http.ResponseWriter, req *http.Request) {
				calls.Add(1)
				fixtureAnswer(rw, "original", "original completed result", nil)
			})
			h := NewWorkspaceHost(m.config, "", "")
			defer h.Close()
			value, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_create", "request_id": "restore-maintenance", "name": "Target", "model_id": "local-model", "prompt_text": "original target"}))
			if err != nil {
				t.Fatal(err)
			}
			id := value.(map[string]any)["id"].(string)
			cm, _ := h.conversationManager()
			if _, err = cm.Send(cm.owner, id, "original", "original user input"); err != nil {
				t.Fatal(err)
			}
			original, err := cm.Wait(context.Background(), cm.owner, id, 10000)
			if err != nil || original.State != "completed" {
				t.Fatal(original, err)
			}
			request := "interrupted-compact"
			cid := "mother-" + workflowHash(id+":"+request)
			pending := &CompactionState{RequestID: cid, Trigger: "manual", State: "scheduled", Purpose: "mother_maintenance", Updated: time.Now().UTC().Format(time.RFC3339Nano)}
			path, _ := SessionPath(filepath.Join(cm.dir, "config.json"), id)
			a := &SessionArchive{Path: path}
			r, err := a.read()
			if err != nil {
				t.Fatal(err)
			}
			if err = a.Append("compaction_state", pending); err != nil {
				t.Fatal(err)
			}
			if committed {
				outcome := cloneCompaction(pending)
				outcome.State = "completed"
				outcome.Covered = len(r.Messages)
				cp := &Checkpoint{Covered: len(r.Messages), Summary: CompactSummary{Goals: []string{"retain original result"}}, Compaction: outcome}
				if err = a.Append("checkpoint", cp); err != nil {
					t.Fatal(err)
				}
			}
			a.Close()
			cm.mu.Lock()
			j := cm.jobs[id]
			j.record.Compactions = map[string]*conversationCompaction{request: {ID: request, Operator: "mother", Reason: "maintain", Generation: original.Generation, State: "running", PriorState: "completed", Outcome: pending}}
			j.record.CompactionRun = request
			j.record.State = "running"
			j.record.RunTime = &AgentRunTime{ElapsedMS: 1000, Intervals: []AgentRunInterval{{StartedAt: 1000, FinishedAt: 2000}}}
			err = cm.saveLocked(j)
			cm.mu.Unlock()
			if err != nil {
				t.Fatal(err)
			}
			h.Close()
			h2 := NewWorkspaceHost(m.config, "", "")
			defer h2.Close()
			restored, err := h2.conversationManager()
			if err != nil {
				t.Fatal(err)
			}
			after, err := restored.Status(restored.owner, id)
			if err != nil {
				t.Fatal(err)
			}
			want := "interrupted"
			if committed {
				want = "completed"
			}
			if calls.Load() != 1 || after.State != "completed" || after.Result != original.Result || after.Generation != original.Generation || after.CompactionRun != "" || after.Compactions[request].State != want || after.RunTime.Incomplete || after.RunTime.ElapsedMS != 1000 {
				t.Fatal("recovery changed original outcome or replayed a model", calls.Load(), after.State, after.Compactions[request], after.RunTime)
			}
			if _, err = restored.requestConversationCompaction(context.Background(), id, request, "maintain", "mother", original.Generation); err != nil || calls.Load() != 1 {
				t.Fatal("recovered receipt was resubmitted", err)
			}
		})
	}
}

// Exercise the model tool path, including the durable receipt query, rather
// than giving a fixture direct access to the maintenance service.
func TestMotherConversationCompactionToolRuntime(t *testing.T) {
	var calls atomic.Int32
	var target string
	var cm *AgentManager
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, req *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(req.Body).Decode(&body)
		call := func(id string, args map[string]any) {
			fixtureAnswer(rw, id, "", []any{map[string]any{"type": "function_call", "id": id, "call_id": id, "name": "agents", "arguments": string(rawJSON(args))}})
		}
		switch calls.Add(1) {
		case 1:
			call("compact-tool", map[string]any{"kind": "conversation", "action": "compact", "id": target, "request_id": "maintenance-tool", "reason": "整理空闲会话", "generation": 0})
		case 2:
			if _, err := cm.Wait(context.Background(), cm.owner, target, 10000); err != nil {
				t.Error(err)
			}
			call("status-tool", map[string]any{"kind": "conversation", "action": "compact_status", "id": target, "request_id": "maintenance-tool"})
		case 3:
			if !strings.Contains(string(rawJSON(body)), "NO_ELIGIBLE_HISTORY") {
				t.Error("mother did not receive the actual maintenance result")
			}
			fixtureAnswer(rw, "done", "Maintenance checked; no history to compact.", nil)
		default:
			t.Error("maintenance made an unexpected model request")
			fixtureAnswer(rw, "unexpected", "unexpected", nil)
		}
	})
	h, home := openCoreLinkHome(t, m.config, dir)
	defer h.Close()
	value, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_create", "request_id": "compact-tool-target", "name": "Target", "model_id": "local-model", "prompt_text": "independent context"}))
	if err != nil {
		t.Fatal(err)
	}
	target = value.(map[string]any)["id"].(string)
	cm, err = h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = home.Send("maintenance", "Check the idle conversation context."); err != nil {
		t.Fatal(err)
	}
	waitCoreLink(t, "mother did not dispatch", func() bool { home.mu.Lock(); defer home.mu.Unlock(); return home.state.Roles[WorkspaceMatrix] != "" })
	home.mu.Lock()
	actor := home.state.Roles[WorkspaceMatrix]
	home.mu.Unlock()
	if r, e := home.manager.Wait(context.Background(), home.manager.owner, actor, 15000); e != nil || r.State != "completed" {
		t.Fatal(r.State, r.Error, e)
	}
	r, err := cm.Status(cm.owner, target)
	if err != nil || r.State != "idle" || r.Generation != 0 || len(r.Turns) != 0 || r.Compactions["maintenance-tool"] == nil || r.Compactions["maintenance-tool"].State != "skipped" || calls.Load() != 3 {
		t.Fatal("maintenance tool changed task or failed to return its receipt", r.State, r.Compactions, calls.Load(), err)
	}
}
