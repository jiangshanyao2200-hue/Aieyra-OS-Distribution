// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: retryAccountingFixture; writeRetryAccountingStream; readRetryAccountingLedger; assertRetryAccountingUsage; TestRetryBackoffCancelAccountsOriginalAttemptOnce; TestRetryAccountingBudgetAndSaveFailureDoNotReplay; TestRetryAccountsEachActualAttemptAndKeepsUnknownCache; TestDeliveredStreamUsageSurvivesCancellationAndWorkerLoss; TestCancelledNextAttemptCannotBorrowPreviousUsage; TestModelWorkerDelayedRetryFramesDoNotReassignUsage
// Impact: python -B scripts/code-atlas.py show Core/request_retry_accounting_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func retryAccountingFixture(t *testing.T, worker bool, handler http.HandlerFunc) (*AgentManager, *Workspace, *Settings, *agentJob) {
	t.Helper()
	m, dir := matrixTestManager(t, handler)
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	s.APIProfiles[0].Protocol = ProtocolChat
	s.APIProfiles[0].Parameters = rawJSON(map[string]any{"stream": true, "max_tokens": 0})
	s.applyPoolProfile()
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	projection := &Workspace{live: map[string]WorkspaceLive{}}
	if worker {
		projection = modeWorkspace(t, m.config, dir, HostOS)
		m = projection.manager
	} else {
		m.streamProjection = projection
	}
	s, err = m.settings("local-model")
	if err != nil {
		t.Fatal(err)
	}
	job := &agentJob{record: AgentRecord{ID: workspaceID(), Parent: m.owner, Depth: 1, State: "running", Generation: 1, Spec: AgentSpec{ModelID: "local-model", Task: "retry accounting fixture", Workdir: dir, MaxTokens: 100000}}}
	return m, projection, s, job
}

func writeRetryAccountingStream(w http.ResponseWriter, known bool) {
	w.Header().Set("Content-Type", "text/event-stream")
	chunk := map[string]any{"id": "retry-accounting", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": "unsubmitted", "type": "function", "function": map[string]any{"name": "update_plan", "arguments": "{"}}}}}}}
	if known {
		chunk["usage"] = map[string]any{"prompt_tokens": 1200, "completion_tokens": 90, "prompt_tokens_details": map[string]any{"cached_tokens": 900}}
	}
	fmt.Fprintf(w, "data: %s\n\n", rawJSON(chunk))
	// Deliberately omit [DONE]: no complete response or tool invocation exists.
}

func readRetryAccountingLedger(t *testing.T, m *AgentManager, job *agentJob) []AgentUsage {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(m.dir, "usage.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	rows := []AgentUsage{}
	for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		var row struct {
			Task  string     `json:"task"`
			Usage AgentUsage `json:"usage"`
		}
		if err = json.Unmarshal([]byte(line), &row); err != nil {
			t.Fatal(err)
		}
		if row.Task == job.record.ID {
			rows = append(rows, row.Usage)
		}
	}
	return rows
}

func assertRetryAccountingUsage(t *testing.T, u AgentUsage, s *Settings, known bool) {
	t.Helper()
	if u.Request != 1 || u.Model != s.Model || u.Host != usageHost(s.BaseURL) {
		t.Fatalf("attempt usage lost its original model or route: %+v", u)
	}
	if known {
		if !u.Reported || u.Estimated || u.Input != 1200 || u.Output != 90 || u.Cached == nil || *u.Cached != 900 {
			t.Fatalf("reported usage replaced or lost: %+v", u)
		}
	} else if u.Reported || !u.Estimated || u.Cached != nil {
		t.Fatalf("unreported usage was made known: %+v", u)
	}
}

func TestRetryBackoffCancelAccountsOriginalAttemptOnce(t *testing.T) {
	for _, worker := range []bool{false, true} {
		for _, known := range []bool{true, false} {
			t.Run(fmt.Sprintf("worker=%t/known=%t", worker, known), func(t *testing.T) {
				var calls atomic.Int32
				m, projection, s, job := retryAccountingFixture(t, worker, func(w http.ResponseWriter, r *http.Request) {
					calls.Add(1)
					writeRetryAccountingStream(w, known)
				})
				ctx, cancel := context.WithTimeout(WithProviderSession(context.Background(), m.owner), 10*time.Second)
				defer cancel()
				type result struct {
					answer Message
					err    error
				}
				done := make(chan result, 1)
				go func() {
					answer, _, err := m.agentRequest(ctx, job, s, []Message{{Role: RoleUser, Content: "cancel retry wait"}}, []ToolDefinition{PlanToolDefinition()}, "model")
					done <- result{answer, err}
				}()
				for {
					projection.mu.Lock()
					phase := projection.live[job.record.ID].Phase
					projection.mu.Unlock()
					if phase == "retry" {
						cancel()
						break
					}
					select {
					case r := <-done:
						t.Fatalf("request ended before retry wait: %v", r.err)
					case <-ctx.Done():
						t.Fatal("retry wait not observed")
					case <-time.After(time.Millisecond):
					}
				}
				r := <-done
				if !errors.Is(r.err, context.Canceled) || calls.Load() != 1 || job.record.Requests != 1 || len(job.record.Usage) != 1 || len(r.answer.ToolCalls) != 0 {
					t.Fatalf("cancelled retry changed requests or tool execution: requests=%d wire=%d usage=%+v answer=%+v err=%v", job.record.Requests, calls.Load(), job.record.Usage, r.answer, r.err)
				}
				assertRetryAccountingUsage(t, job.record.Usage[0], s, known)
				ledger := readRetryAccountingLedger(t, m, job)
				if len(ledger) != 1 {
					t.Fatal("attempt ledger is not exact-once", ledger)
				}
				assertRetryAccountingUsage(t, ledger[0], s, known)
				b, err := os.ReadFile(filepath.Join(m.dir, job.record.ID+".json"))
				if err != nil {
					t.Fatal(err)
				}
				var saved AgentRecord
				if err = json.Unmarshal(b, &saved); err != nil || saved.Requests != 1 || len(saved.Usage) != 1 {
					t.Fatal("attempt record was not retained", saved, err)
				}
				assertRetryAccountingUsage(t, saved.Usage[0], s, known)
			})
		}
	}
}

func TestRetryAccountingBudgetAndSaveFailureDoNotReplay(t *testing.T) {
	for _, worker := range []bool{false, true} {
		for _, saveFailure := range []bool{false, true} {
			t.Run(fmt.Sprintf("worker=%t/save_failure=%t", worker, saveFailure), func(t *testing.T) {
				var calls atomic.Int32
				var blockedRecord string
				fixtureErrors := make(chan error, 1)
				m, _, s, job := retryAccountingFixture(t, worker, func(w http.ResponseWriter, r *http.Request) {
					if calls.Add(1) == 1 && saveFailure {
						err := os.Remove(blockedRecord)
						if err == nil {
							err = os.Mkdir(blockedRecord, 0700)
						}
						fixtureErrors <- err
					}
					writeRetryAccountingStream(w, true)
				})
				blockedRecord = filepath.Join(m.dir, job.record.ID+".json")
				if !saveFailure {
					job.record.Spec.MaxTokens = 1
				}
				ctx, cancel := context.WithTimeout(WithProviderSession(context.Background(), m.owner), 10*time.Second)
				defer cancel()
				answer, _, err := m.agentRequest(ctx, job, s, []Message{{Role: RoleUser, Content: "retain billed failed attempt"}}, []ToolDefinition{PlanToolDefinition()}, "model")
				if err == nil || calls.Load() != 1 || job.record.Requests != 1 || len(job.record.Usage) != 1 || len(answer.ToolCalls) != 0 {
					t.Fatalf("failure or budget changed attempt accounting: wire=%d requests=%d usage=%+v err=%v", calls.Load(), job.record.Requests, job.record.Usage, err)
				}
				assertRetryAccountingUsage(t, job.record.Usage[0], s, true)
				ledger := readRetryAccountingLedger(t, m, job)
				if len(ledger) != 1 {
					t.Fatal("failed attempt duplicated its ledger", ledger)
				}
				assertRetryAccountingUsage(t, ledger[0], s, true)
				if saveFailure {
					if err = <-fixtureErrors; err != nil {
						t.Fatal("failed to create save-failure fixture", err)
					}
					if err = os.Remove(blockedRecord); err != nil {
						t.Fatal(err)
					}
					m.mu.Lock()
					err = m.saveLocked(job)
					m.mu.Unlock()
					if err != nil || len(readRetryAccountingLedger(t, m, job)) != 1 {
						t.Fatal("saving retained usage repeated accounting", err)
					}
				}
				b, err := os.ReadFile(blockedRecord)
				if err != nil {
					t.Fatal(err)
				}
				var saved AgentRecord
				if err = json.Unmarshal(b, &saved); err != nil || saved.Requests != 1 || len(saved.Usage) != 1 {
					t.Fatal("retained record changed requests or usage", saved, err)
				}
				assertRetryAccountingUsage(t, saved.Usage[0], s, true)
			})
		}
	}
}

func TestRetryAccountsEachActualAttemptAndKeepsUnknownCache(t *testing.T) {
	for _, worker := range []bool{false, true} {
		for _, known := range []bool{true, false} {
			t.Run(fmt.Sprintf("worker=%t/second_known=%t", worker, known), func(t *testing.T) {
				var calls atomic.Int32
				m, _, s, job := retryAccountingFixture(t, worker, func(w http.ResponseWriter, r *http.Request) {
					if calls.Add(1) == 1 {
						writeRetryAccountingStream(w, true)
						return
					}
					w.Header().Set("Content-Type", "text/event-stream")
					chunk := map[string]any{"id": "second-attempt", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"content": "recovered"}, "finish_reason": "stop"}}}
					if known {
						chunk["usage"] = map[string]any{"prompt_tokens": 200, "completion_tokens": 10, "prompt_tokens_details": map[string]any{"cached_tokens": 0}}
					}
					fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", rawJSON(chunk))
				})
				ctx, cancel := context.WithTimeout(WithProviderSession(context.Background(), m.owner), 10*time.Second)
				defer cancel()
				answer, _, err := m.agentRequest(ctx, job, s, []Message{{Role: RoleUser, Content: "retry and complete"}}, []ToolDefinition{PlanToolDefinition()}, "model")
				if err != nil || answer.Content != "recovered" || len(answer.ToolCalls) != 0 || calls.Load() != 2 || job.record.Requests != 2 || len(job.record.Usage) != 2 {
					t.Fatalf("successful retry changed attempts: wire=%d requests=%d usage=%+v answer=%+v err=%v", calls.Load(), job.record.Requests, job.record.Usage, answer, err)
				}
				assertRetryAccountingUsage(t, job.record.Usage[0], s, true)
				ledger := readRetryAccountingLedger(t, m, job)
				if len(ledger) != 2 {
					t.Fatal("retry ledger was not exact-once", ledger)
				}
				assertRetryAccountingUsage(t, ledger[0], s, true)
				for _, second := range []AgentUsage{job.record.Usage[1], ledger[1]} {
					if second.Request != 2 || second.Reported != known || second.Estimated == known {
						t.Fatal("second attempt borrowed the first usage", second)
					}
					if known && (second.Input != 200 || second.Output != 10 || second.Cached == nil || *second.Cached != 0) || !known && second.Cached != nil {
						t.Fatal("second attempt cache is not its own", second)
					}
				}
			})
		}
	}
}

func TestDeliveredStreamUsageSurvivesCancellationAndWorkerLoss(t *testing.T) {
	for _, mode := range []string{"in_process", "worker_cancel", "worker_exit"} {
		t.Run(mode, func(t *testing.T) {
			var calls atomic.Int32
			m, _, s, _ := retryAccountingFixture(t, false, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				writeRetryAccountingStream(w, true)
				w.(http.Flusher).Flush()
				<-r.Context().Done()
			})
			ctx, cancel := context.WithTimeout(WithProviderSession(context.Background(), m.owner), 10*time.Second)
			defer cancel()
			ctx = WithResponseRetry(ctx, func(RetryInfo) error { t.Error("cancelled request retried"); return errors.New("unexpected retry") })
			seen := 0
			pid := 0
			observe := func(event Event) {
				if event.Kind == EventUsage && event.Usage != nil {
					seen++
					if mode == "worker_exit" {
						process, err := os.FindProcess(pid)
						if err == nil {
							err = process.Kill()
						}
						if err != nil {
							t.Error("could not terminate observed worker", err)
						}
					}
					cancel()
				}
			}
			var answer Message
			var usage *Usage
			var err error
			if mode == "in_process" {
				answer, usage, err = completeAgentObserved(ctx, New(s), s, []Message{{Role: RoleUser, Content: "cancel after billed usage"}}, nil, observe)
			} else {
				answer, usage, err = completeAgentProcess(ctx, s, []Message{{Role: RoleUser, Content: "cancel after billed usage"}}, nil, observe, func(value int) error { pid = value; return nil })
			}
			if err == nil || mode != "worker_exit" && !errors.Is(err, context.Canceled) || seen != 1 || calls.Load() != 1 || len(answer.ToolCalls) != 0 || usage == nil {
				t.Fatalf("delivered usage disappeared on cancellation: seen=%d wire=%d usage=%+v err=%v", seen, calls.Load(), usage, err)
			}
			cached, known := usage.CachedTokens()
			if usage.PromptTokens != 1200 || usage.CompletionTokens != 90 || !known || cached != 900 {
				t.Fatalf("delivered supplier usage changed: %+v", usage)
			}
		})
	}
}

func TestCancelledNextAttemptCannotBorrowPreviousUsage(t *testing.T) {
	for _, worker := range []bool{false, true} {
		t.Run(fmt.Sprintf("worker=%t", worker), func(t *testing.T) {
			var calls atomic.Int32
			m, projection, s, job := retryAccountingFixture(t, worker, func(w http.ResponseWriter, r *http.Request) {
				if calls.Add(1) == 1 {
					writeRetryAccountingStream(w, true)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, "data: "+string(rawJSON(map[string]any{"id": "next-wait", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"content": "second attempt waiting"}}}}))+"\n\n")
				w.(http.Flusher).Flush()
				<-r.Context().Done()
			})
			ctx, cancel := context.WithTimeout(WithProviderSession(context.Background(), m.owner), 10*time.Second)
			defer cancel()
			done := make(chan error, 1)
			go func() {
				_, _, err := m.agentRequest(ctx, job, s, []Message{{Role: RoleUser, Content: "cancel unreported next attempt"}}, nil, "model")
				done <- err
			}()
			for {
				projection.mu.Lock()
				body := projection.live[job.record.ID].Text
				projection.mu.Unlock()
				if body == "second attempt waiting" {
					if worker {
						m.mu.Lock()
						pid := job.record.WorkerPID
						m.mu.Unlock()
						process, err := os.FindProcess(pid)
						if err == nil {
							err = process.Kill()
						}
						if err != nil {
							t.Error("could not terminate second-attempt worker", err)
						}
					}
					cancel()
					break
				}
				select {
				case err := <-done:
					t.Fatalf("second attempt ended before cancellation: %v", err)
				case <-ctx.Done():
					t.Fatal("second attempt not observed")
				case <-time.After(time.Millisecond):
				}
			}
			if err := <-done; err == nil || !worker && !errors.Is(err, context.Canceled) || calls.Load() != 2 || job.record.Requests != 2 || len(job.record.Usage) != 2 {
				t.Fatalf("second-attempt cancellation changed accounting: wire=%d requests=%d usage=%+v err=%v", calls.Load(), job.record.Requests, job.record.Usage, err)
			}
			assertRetryAccountingUsage(t, job.record.Usage[0], s, true)
			ledger := readRetryAccountingLedger(t, m, job)
			if len(ledger) != 2 {
				t.Fatal("second cancellation duplicated a bill", ledger)
			}
			for _, row := range []AgentUsage{job.record.Usage[1], ledger[1]} {
				if row.Request != 2 || row.Reported || !row.Estimated || row.Cached != nil {
					t.Fatal("unreported second attempt borrowed old usage", row)
				}
			}
		})
	}
}

func TestModelWorkerDelayedRetryFramesDoNotReassignUsage(t *testing.T) {
	makeUsage := func(input, cached int) *Usage {
		var u Usage
		if err := json.Unmarshal(rawJSON(map[string]any{"prompt_tokens": input, "completion_tokens": 10, "prompt_tokens_details": map[string]any{"cached_tokens": cached}}), &u); err != nil {
			t.Fatal(err)
		}
		return &u
	}
	u1, u2, u3 := makeUsage(1200, 900), makeUsage(2400, 1800), makeUsage(300, 0)
	for _, thirdReported := range []bool{false, true} {
		t.Run(fmt.Sprintf("third_reported=%t", thirdReported), func(t *testing.T) {
			// Each source stays FIFO. Both retry handshakes are allowed to reach
			// the parent before the consumer delivers the first ordered reset.
			frames := []modelWorkerFrame{
				{Kind: "attempt", Retry: &RetryInfo{Attempt: 2, Usage: u1}},
				{Kind: "retry", Retry: &RetryInfo{Attempt: 2}},
				{Kind: "attempt", Retry: &RetryInfo{Attempt: 3, Usage: u2}},
				{Kind: "retry", Retry: &RetryInfo{Attempt: 3}},
				{Kind: "event", Event: &Event{Kind: EventUsage, Usage: u1}},
				{Kind: "event", Event: &Event{Kind: EventRetry, Retry: &RetryInfo{Attempt: 2}}},
				{Kind: "event", Event: &Event{Kind: EventUsage, Usage: u2}},
			}
			if thirdReported {
				frames = append(frames, modelWorkerFrame{Kind: "event", Event: &Event{Kind: EventRetry, Retry: &RetryInfo{Attempt: 3}}}, modelWorkerFrame{Kind: "event", Event: &Event{Kind: EventUsage, Usage: u3}})
			}
			state := modelWorkerUsageState{}
			for _, f := range frames {
				state.observe(f)
			}
			if !thirdReported {
				if state.pending != nil {
					t.Fatalf("unreported third attempt borrowed old usage at EOF: input=%d output=%d", state.pending.PromptTokens, state.pending.CompletionTokens)
				}
				return
			}
			if state.pending == nil || state.pending.PromptTokens != 300 {
				t.Fatalf("third attempt lost its own usage: %+v", state.pending)
			}
			cached, known := state.pending.CachedTokens()
			if !known || cached != 0 {
				t.Fatal("third attempt cache borrowed an older value", state.pending)
			}
		})
	}
}
