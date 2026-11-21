// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestModelWorkerPreservesProviderFailure; TestModelWorkerPreservesResponsesFailedMetadata; TestModelWorkerResponsesFailureWireRequiresTypedEvidence; TestModelWorkerPreservesLongThinkingDecision; TestModelWorkerErrorWireCompatibility; TestModelWorkerContextErrorWireRequiresTypedEvidence; TestModelWorkerContextErrorPreservesOtherTypedCauses; TestModelWorkerRequestContextErrorWhileParentRemainsActive; TestMain; runCoreTests; TestMatrixOSChildProcessToolsAndArchive; TestModelWorkerCancellationAndParentEOF; TestModelWorkerMinimalCredentials; TestMatrixOSProcessRetryAccountingAndBudget; TestMatrixOSConcurrentProcessesAndGeneration
// Impact: python -B scripts/code-atlas.py show Core/matrix_worker_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestModelWorkerPreservesProviderFailure(t *testing.T) {
	cases := []struct {
		name, apiCode, message, failureCode string
		status                              int
		retryable                           bool
	}{
		{"permission", "", "forbidden", "access_denied", 403, false},
		{"client restriction", "", "Free tier can only be used from within OpenCode", "provider_client_restriction", 403, false},
		{"moderation", "content_policy_violation", "blocked", "provider_blocked", 400, false},
		{"quota", "insufficient_quota", "quota", "quota", 429, false},
		{"cooling", "accounts_cooling_down", "cooling", "account_cooling", 429, false},
		{"rate limit", "", "slow down", "rate_limit", 429, true},
		{"unavailable", "", "try later", "provider_unavailable", 503, true},
		{"unclassified", "", "parameter rejected", "unclassified", 400, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Retry-After", "7")
				w.WriteHeader(tc.status)
				_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"type": "fixture_error", "code": tc.apiCode, "message": tc.message}})
			})
			s, err := m.settings("local-model")
			if err != nil {
				t.Fatal(err)
			}
			ctx := withoutRequestRetry(WithProviderSession(context.Background(), testMatrixOwner))
			var observed []error
			var workerPIDs []int
			_, _, err = completeAgentProcess(ctx, s, []Message{{Role: RoleUser, Content: "provider failure fixture"}}, nil, func(e Event) {
				if e.Kind == EventError {
					observed = append(observed, e.Err)
				}
			}, func(pid int) error { workerPIDs = append(workerPIDs, pid); return nil })
			if len(workerPIDs) != 2 || workerPIDs[0] <= 0 || workerPIDs[0] == os.Getpid() || workerPIDs[1] != 0 {
				t.Fatalf("worker lifecycle %v", workerPIDs)
			}
			if len(observed) != 1 {
				t.Fatalf("provider error events %v", observed)
			}
			for _, transported := range append(observed, err) {
				var api *APIError
				if !errors.As(transported, &api) || api.StatusCode != tc.status || api.Code != tc.apiCode || api.Type != "fixture_error" || api.Message != tc.message || api.RetryAfter != 7*time.Second {
					t.Fatalf("provider identity lost in worker: %T %v", transported, transported)
				}
				f := classifyAgentFailure(transported, s.BaseURL)
				if f.Code != tc.failureCode || f.Origin != "upstream" || f.Retryable != tc.retryable {
					t.Fatalf("failure=%+v", f)
				}
			}
		})
	}
}

func TestModelWorkerPreservesResponsesFailedMetadata(t *testing.T) {
	for _, stream := range []bool{true, false} {
		for _, known := range []bool{true, false} {
			t.Run(fmt.Sprintf("stream=%v/usage=%v", stream, known), func(t *testing.T) {
				kind := ""
				if !stream {
					kind = "fixture_error"
				}
				envelope := responsesFailedFixture(kind, known)
				var requests atomic.Int32
				manager, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
					requests.Add(1)
					var request ResponsesRequest
					if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
						t.Error(err)
					}
					if request.Stream != stream {
						t.Errorf("worker changed stream path: %v", request.Stream)
					}
					if stream {
						w.Header().Set("Content-Type", "text/event-stream")
						fmt.Fprint(w, responseFrame(map[string]any{"type": "response.failed", "response": envelope}))
					} else {
						w.Header().Set("Content-Type", "application/json")
						_ = json.NewEncoder(w).Encode(envelope)
					}
				})
				settings, err := manager.settings("local-model")
				if err != nil {
					t.Fatal(err)
				}
				settings.Stream = boolRef(stream)
				ctx, cancel := context.WithTimeout(WithProviderSession(context.Background(), testMatrixOwner), 10*time.Second)
				defer cancel()
				retries, errorsSeen, usagesSeen, published := 0, 0, 0, 0
				ctx = WithResponseRetry(ctx, func(RetryInfo) error { retries++; return nil })
				var observedFailure error
				var observedUsage *Usage
				answer, usage, err := completeAgentProcess(ctx, settings, []Message{{Role: RoleUser, Content: "terminal failure fixture"}}, []ToolDefinition{PlanToolDefinition()}, func(event Event) {
					switch event.Kind {
					case EventError:
						errorsSeen++
						observedFailure = event.Err
					case EventUsage:
						usagesSeen++
						observedUsage = event.Usage
					case EventResponse, EventFinish, EventDone, EventRetry:
						published++
					}
				}, nil)
				assertResponsesFailedError(t, err, kind)
				assertResponsesFailedError(t, observedFailure, kind)
				assertResponsesFailedUsage(t, usage, known)
				assertResponsesFailedUsage(t, observedUsage, known)
				wantUsages := 0
				if known {
					wantUsages = 1
				}
				if requests.Load() != 1 || retries != 0 || errorsSeen != 1 || usagesSeen != wantUsages || published != 0 || len(answer.ToolCalls) != 0 || len(answer.IncompleteTools) != 0 || len(answer.ResponseItems) != 0 {
					t.Fatalf("worker failure changed execution: requests=%d retries=%d errors=%d usages=%d published=%d answer=%+v", requests.Load(), retries, errorsSeen, usagesSeen, published, answer)
				}
			})
		}
	}
}

func TestModelWorkerResponsesFailureWireRequiresTypedEvidence(t *testing.T) {
	provider := &APIError{StatusCode: http.StatusOK, Code: "server_error", Type: "fixture_error", Message: responsesFailedMessage, Raw: "raw-response-not-needed"}
	original := fmt.Errorf("model response: %w", provider)
	for _, typed := range []bool{true, false} {
		t.Run(fmt.Sprint(typed), func(t *testing.T) {
			frame := modelWorkerFrame{Kind: "result"}
			if typed {
				frame.setError(original)
			} else {
				frame.setError(errors.New(original.Error()))
			}
			raw, err := json.Marshal(frame)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(raw), provider.Raw) {
				t.Fatal("worker copied raw provider data")
			}
			var decoded modelWorkerFrame
			if err := json.Unmarshal(raw, &decoded); err != nil {
				t.Fatal(err)
			}
			restored := decoded.decodedError()
			if restored == nil || restored.Error() != original.Error() {
				t.Fatalf("worker lost error context: %v", restored)
			}
			if typed {
				assertResponsesFailedError(t, restored, "fixture_error")
			} else {
				var api *APIError
				failure := classifyAgentFailure(restored, "https://api.openai.com/v1")
				if decoded.APIError != nil || errors.As(restored, &api) || failure.Code != "unclassified" || failure.Origin != "unknown" || failure.Retryable || transientRequestError(restored) != "" {
					t.Fatalf("plain local text gained upstream identity: %+v", failure)
				}
			}
		})
	}
}

func TestModelWorkerPreservesLongThinkingDecision(t *testing.T) {
	original := fmt.Errorf("request ended: %w", &LongThinkingError{Seconds: 120, Err: io.ErrUnexpectedEOF})
	frame := modelWorkerFrame{Kind: "result"}
	frame.setError(original)
	raw, err := json.Marshal(frame)
	if err != nil {
		t.Fatal(err)
	}
	var decoded modelWorkerFrame
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	transported := decoded.decodedError()
	var thinking *LongThinkingError
	if !errors.As(transported, &thinking) || thinking.Seconds != 120 || transported.Error() != original.Error() {
		t.Fatalf("long thinking identity lost across worker: %T %v", transported, transported)
	}
	failure := classifyAgentFailure(transported, "https://relay.invalid")
	if failure.Code != "long_thinking" || failure.Retryable {
		t.Fatalf("failure=%+v", failure)
	}
	legacy := (modelWorkerFrame{Error: original.Error()}).decodedError()
	if errors.As(legacy, &thinking) {
		t.Fatal("plain legacy text is not a typed local decision")
	}
}

func TestModelWorkerErrorWireCompatibility(t *testing.T) {
	api := &APIError{StatusCode: 403, Type: "permission_error", Code: "denied", Message: "forbidden", RetryAfter: 7 * time.Second, Raw: "raw-response-not-needed"}
	original := fmt.Errorf("provider request: %w", api)
	frame := modelWorkerFrame{Kind: "result"}
	frame.setError(original)
	raw, err := json.Marshal(frame)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), api.Raw) {
		t.Fatal("raw provider response copied into worker frame")
	}
	var decoded modelWorkerFrame
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	restored := decoded.decodedError()
	var provider *APIError
	if restored.Error() != original.Error() || !errors.As(restored, &provider) || provider.StatusCode != 403 || provider.Code != api.Code || provider.Type != api.Type || provider.Message != api.Message || provider.RetryAfter != api.RetryAfter || provider.Raw != "" {
		t.Fatalf("provider context lost: %v %+v", restored, provider)
	}
	// Old frames and local errors retain their text without inventing a provider.
	var legacy modelWorkerFrame
	if err := json.Unmarshal([]byte(`{"kind":"result","error":"local request budget exhausted"}`), &legacy); err != nil {
		t.Fatal(err)
	}
	if err := legacy.decodedError(); err == nil || err.Error() != legacy.Error || errors.As(err, &provider) {
		t.Fatalf("legacy/local error changed: %v", err)
	}
	if err := (modelWorkerFrame{}).decodedError(); err != nil {
		t.Fatal("successful frame gained an error", err)
	}
}

func TestModelWorkerContextErrorWireRequiresTypedEvidence(t *testing.T) {
	cases := []struct {
		name, code, origin string
		original, cause    error
		retryable          bool
	}{
		{"deadline", "timeout", "transport", fmt.Errorf("stream wait: %w", context.DeadlineExceeded), context.DeadlineExceeded, true},
		{"first response", modelFirstResponseTimeout, "transport", &modelResponseTimeout{stage: modelFirstResponseTimeout, wait: time.Second}, context.DeadlineExceeded, true},
		{"idle stream", modelStreamIdleTimeout, "transport", &modelResponseTimeout{stage: modelStreamIdleTimeout, wait: time.Second}, context.DeadlineExceeded, true},
		{"cancelled", "cancelled", "local", fmt.Errorf("stream wait: %w", context.Canceled), context.Canceled, false},
		{"legacy text", "unclassified", "unknown", errors.New("context deadline exceeded"), nil, false},
		{"provider text", "unclassified", "upstream", &APIError{StatusCode: 400, Message: "context deadline exceeded"}, nil, false},
	}
	for _, tc := range cases {
		for _, kind := range []string{"event", "result"} {
			t.Run(tc.name+"/"+kind, func(t *testing.T) {
				frame := modelWorkerFrame{Kind: kind}
				frame.setError(tc.original)
				raw, err := json.Marshal(frame)
				if err != nil {
					t.Fatal(err)
				}
				var decoded modelWorkerFrame
				if err := json.Unmarshal(raw, &decoded); err != nil {
					t.Fatal(err)
				}
				restored := decoded.decodedError()
				if restored == nil || restored.Error() != tc.original.Error() || errors.Is(restored, context.DeadlineExceeded) != (tc.cause == context.DeadlineExceeded) || errors.Is(restored, context.Canceled) != (tc.cause == context.Canceled) {
					t.Fatalf("context error identity changed: %v", restored)
				}
				failure := classifyAgentFailure(restored, "https://relay.invalid")
				if failure.Code != tc.code || failure.Origin != tc.origin || failure.Retryable != tc.retryable {
					t.Fatalf("context failure changed: %+v", failure)
				}
			})
		}
	}
	unknown := (modelWorkerFrame{Error: "context deadline exceeded", ContextError: "future-context-kind"}).decodedError()
	if errors.Is(unknown, context.DeadlineExceeded) || errors.Is(unknown, context.Canceled) {
		t.Fatal("unknown wire kind invented a local context cause")
	}
}

func TestModelWorkerContextErrorPreservesOtherTypedCauses(t *testing.T) {
	provider := &APIError{StatusCode: 503, Message: "unavailable"}
	for _, original := range []error{
		errors.Join(provider, fmt.Errorf("read wait: %w", context.DeadlineExceeded)),
		&LongThinkingError{Seconds: 120, Err: context.DeadlineExceeded},
	} {
		frame := modelWorkerFrame{Kind: "result"}
		frame.setError(original)
		raw, err := json.Marshal(frame)
		if err != nil {
			t.Fatal(err)
		}
		var decoded modelWorkerFrame
		if err := json.Unmarshal(raw, &decoded); err != nil {
			t.Fatal(err)
		}
		restored := decoded.decodedError()
		if !errors.Is(restored, context.DeadlineExceeded) || restored.Error() != original.Error() {
			t.Fatal("nested context cause lost", restored)
		}
		var beforeAPI, afterAPI *APIError
		var beforeThinking, afterThinking *LongThinkingError
		if errors.As(original, &beforeAPI) != errors.As(restored, &afterAPI) || errors.As(original, &beforeThinking) != errors.As(restored, &afterThinking) {
			t.Fatal("context metadata replaced another typed cause")
		}
		before, after := classifyAgentFailure(original, "https://relay.invalid"), classifyAgentFailure(restored, "https://relay.invalid")
		if *before != *after {
			t.Fatalf("nested failure changed: before=%+v after=%+v", before, after)
		}
	}
}

func TestModelWorkerRequestContextErrorWhileParentRemainsActive(t *testing.T) {
	for _, tc := range []struct {
		mode, code string
		cause      error
		retryable  bool
	}{
		{"request-timeout", "timeout", context.DeadlineExceeded, true},
		{"request-cancelled", "cancelled", context.Canceled, false},
	} {
		t.Run(tc.mode, func(t *testing.T) {
			spec, _ := json.Marshal(modelWorkerShutdownSpec{Mode: tc.mode, Trace: filepath.Join(t.TempDir(), "worker.jsonl")})
			settings := Defaults()
			settings.Model, settings.APIKey = modelWorkerShutdownPrefix+string(spec), "sk-local-worker-fixture"
			ctx, cancel := context.WithTimeout(WithProviderSession(context.Background(), testMatrixOwner), 5*time.Second)
			defer cancel()
			var observed []error
			_, _, err := completeAgentProcess(ctx, settings, []Message{{Role: RoleUser, Content: "local worker context fixture"}}, nil, func(event Event) {
				if event.Kind == EventError {
					observed = append(observed, event.Err)
				}
			}, nil)
			if ctx.Err() != nil || len(observed) != 1 {
				t.Fatalf("parent expired or error event missing: %v %d", ctx.Err(), len(observed))
			}
			for _, transported := range append(observed, err) {
				if !errors.Is(transported, tc.cause) || transported.Error() != "worker request: "+tc.cause.Error() {
					t.Fatal("real worker pipe lost the request context cause", transported)
				}
				failure := classifyAgentFailure(transported, "https://relay.invalid")
				if failure.Code != tc.code || failure.Retryable != tc.retryable {
					t.Fatalf("request classification depends on parent expiry: %+v", failure)
				}
			}
		})
	}
}

// 测试程序保留生产的内部入口，子进程使用真实管道与真实 PID。
func TestMain(m *testing.M) {
	baseToolMode = false
	if len(os.Args) == 2 && os.Args[1] == ModelDiagnosticWorkerFlag {
		if err := RunModelDiagnosticWorker(os.Stdin, os.Stdout); err != nil {
			os.Exit(1)
		}
		os.Exit(0)
	}
	if len(os.Args) == 2 && os.Args[1] == MatrixWorkerFlag {
		if err := runModelWorkerTestEntrypoint(os.Stdin, os.Stdout); err != nil {
			os.Exit(1)
		}
		os.Exit(0)
	}
	os.Exit(runCoreTests(m))
}

func runCoreTests(m *testing.M) (code int) {
	source := ResourceRoot()
	scratch, err := filepath.Abs(filepath.Join("..", "..", "AIDEBUG", ".test-temp"))
	if err == nil {
		err = os.MkdirAll(scratch, 0700)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	run, err := os.MkdirTemp(scratch, "core-")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer func() {
		if err := os.RemoveAll(run); err != nil {
			fmt.Fprintln(os.Stderr, err)
			code = 1
		}
	}()
	root, temp := filepath.Join(run, "resources"), filepath.Join(run, "tmp")
	for _, directory := range []string{root, temp} {
		if err := os.Mkdir(directory, 0700); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
	}
	if err := stageTestResources(source, root, ReleaseStage{TeamCollaboration: true, Toolbox: true, LinkSituation: true, CLI: true}); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	for key, value := range map[string]string{"AIEYRA_RESOURCE_ROOT": root, "TEMP": temp, "TMP": temp, "TMPDIR": temp} {
		if err := os.Setenv(key, value); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
	}
	return m.Run()
}

func TestMatrixOSChildProcessToolsAndArchive(t *testing.T) {
	var calls atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if calls.Add(1) == 1 {
			fixtureAnswer(w, "child1", "", []any{map[string]any{"type": "function_call", "id": "f1", "call_id": "once", "name": "apply_patch", "arguments": `{"patch":"*** Begin Patch\n*** Add File: child.txt\n+once\n*** End Patch"}`}})
			return
		}
		b, _ := json.Marshal(body)
		if !strings.Contains(string(b), "function_call_output") {
			t.Error("tool receipt not sent to child")
		}
		fixtureAnswer(w, "child2", "child-result", nil)
	})
	w := modeWorkspace(t, m.config, dir, HostOS)
	spec := AgentSpec{RequestID: "child", ModelID: "local-model", Task: "create artifact", Workdir: dir, Tools: []string{"apply_patch"}}
	r, err := w.manager.Create(context.Background(), w.state.ID, spec)
	if err != nil {
		t.Fatal(err)
	}
	r, err = w.manager.Wait(context.Background(), w.state.ID, r.ID, 10000)
	if err != nil || r.State != "completed" || r.ToolTurns != 1 || r.WorkerPID != 0 || r.LastWorkerPID == 0 || r.LastWorkerPID == os.Getpid() {
		t.Fatalf("child %+v %v", r, err)
	}
	duplicate, err := w.manager.Create(context.Background(), w.state.ID, spec)
	if err != nil || duplicate.ID != r.ID || calls.Load() != 2 {
		t.Fatal("replayed child", err)
	}
	if b, e := os.ReadFile(filepath.Join(dir, "child.txt")); e != nil || string(b) != "once\n" {
		t.Fatal("artifact", e)
	}
	archive := filepath.Join(w.manager.dir, "sessions", r.ID+".jsonl")
	w.Close()
	if b, e := os.ReadFile(archive); e != nil || !strings.Contains(string(b), "child-result") {
		t.Fatal("child task evidence removed", e)
	}
}

func TestModelWorkerCancellationAndParentEOF(t *testing.T) {
	entered := make(chan struct{}, 4)
	stopped := make(chan struct{}, 4)
	teardown := make(chan struct{})
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		entered <- struct{}{}
		select {
		case <-r.Context().Done():
			stopped <- struct{}{}
		case <-teardown:
		}
	})
	t.Cleanup(func() { close(teardown) })
	s, err := m.settings("local-model")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(WithProviderSession(context.Background(), testMatrixOwner))
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, _, e := completeAgentProcess(ctx, s, []Message{{Role: RoleUser, Content: "wait"}}, nil, nil, nil)
		done <- e
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("worker not started")
	}
	cancel()
	select {
	case e := <-done:
		if e == nil {
			t.Fatal("cancel lost")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not stop")
	}
	input, writer := io.Pipe()
	workerDone := make(chan error, 1)
	go func() { workerDone <- RunMatrixModelWorker(input, io.Discard) }()
	if err := json.NewEncoder(writer).Encode(modelWorkerRequest{Settings: s, Session: testMatrixOwner, Messages: []Message{{Role: RoleUser, Content: "EOF"}}}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("request not started")
	}
	writer.Close()
	select {
	case <-workerDone:
	case <-time.After(5 * time.Second):
		t.Fatal("orphan worker survived parent EOF")
	}
	input.Close()
	for range 2 {
		select {
		case <-stopped:
		case <-time.After(5 * time.Second):
			t.Fatal("provider request survived worker cancellation")
		}
	}
}

func TestModelWorkerMinimalCredentials(t *testing.T) {
	s := Defaults()
	s.APIKey, s.ActiveProfile = "current-credential", "active"
	s.APIKeyHistory = []string{"past-secret"}
	s.SystemPrompt, s.PromptDir = "private-prompt", "private-directory"
	s.APIProfiles = []APIProfile{{ID: "active", ConnectionID: "own", APIKey: "old-credential", APIKeyHistory: []string{"history-secret"}}, {ID: "other", APIKey: "other-secret"}}
	s.ProviderConnections = []ProviderConnection{{ID: "own", APIKey: "old-credential", APIKeyHistory: []string{"connection-history"}}, {ID: "other", APIKey: "other-secret"}}
	b, err := json.Marshal(modelWorkerSettings(s))
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"past-secret", "private-prompt", "private-directory", "old-credential", "history-secret", "connection-history", "other-secret"} {
		if strings.Contains(string(b), forbidden) {
			t.Fatal("unrelated credential or prompt transported", forbidden)
		}
	}
	if !strings.Contains(string(b), "current-credential") || len(s.APIProfiles) != 2 || len(s.ProviderConnections[0].APIKeyHistory) != 1 {
		t.Fatal("active credential lost or source mutated")
	}
	env := modelWorkerEnvironment([]string{"PATH=path", "HTTPS_PROXY=proxy", "AIEYRA_ROOT=application-root", "AIEYRA_RESOURCE_ROOT=read-only-resources", "AIEYRA_RUNTIME_KEY=secret", "OTHER_API_KEY=secret", "AIEYRA_CONTROL_TOKEN=secret"})
	if len(env) != 4 || !strings.Contains(strings.Join(env, "\n"), "AIEYRA_RESOURCE_ROOT=read-only-resources") || !strings.Contains(strings.Join(env, "\n"), "AIEYRA_ROOT=application-root") {
		t.Fatal("unrelated environment inherited", env)
	}
}

func TestMatrixOSProcessRetryAccountingAndBudget(t *testing.T) {
	for _, budget := range []int{0, 1} {
		t.Run(fmt.Sprint(budget), func(t *testing.T) {
			var calls atomic.Int32
			m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
				if calls.Add(1) == 1 {
					w.WriteHeader(503)
					return
				}
				fixtureAnswer(w, "retry", "recovered", nil)
			})
			w := modeWorkspace(t, m.config, dir, HostOS)
			r, err := w.manager.Create(context.Background(), w.state.ID, AgentSpec{RequestID: "retry", ModelID: "local-model", Task: "retry one transient request", Workdir: dir, MaxTokens: budget})
			if err != nil {
				t.Fatal(err)
			}
			r, err = w.manager.Wait(context.Background(), w.state.ID, r.ID, 10000)
			if err != nil {
				t.Fatal(err)
			}
			if budget == 0 && (r.State != "completed" || calls.Load() != 2 || r.Requests != 2 || len(r.Usage) != 2) {
				t.Fatalf("retry not accounted: %+v calls=%d", r, calls.Load())
			}
			if budget == 1 && (r.State != "failed" || calls.Load() != 1 || r.Requests != 1) {
				t.Fatalf("budget bypassed: %+v calls=%d", r, calls.Load())
			}
		})
	}
}

func TestMatrixOSConcurrentProcessesAndGeneration(t *testing.T) {
	entered := make(chan struct{}, 2)
	release := make(chan struct{})
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		entered <- struct{}{}
		select {
		case <-release:
			fixtureAnswer(w, "parallel", "done", nil)
		case <-r.Context().Done():
		}
	})
	t.Cleanup(func() { close(release) })
	w := modeWorkspace(t, m.config, dir, HostOS)
	var records []AgentRecord
	for i := 0; i < 2; i++ {
		r, err := w.manager.Create(context.Background(), w.state.ID, AgentSpec{RequestID: fmt.Sprint(i), ModelID: "local-model", Task: "parallel task", Workdir: dir})
		if err != nil {
			t.Fatal(err)
		}
		records = append(records, r)
	}
	for range records {
		select {
		case <-entered:
		case <-time.After(6 * time.Second):
			t.Fatal("children did not run concurrently")
		}
	}
	pids := map[int]bool{}
	for _, record := range records {
		r, err := w.manager.Status(w.state.ID, record.ID)
		if err != nil || r.WorkerPID == 0 || r.WorkerPID == os.Getpid() || pids[r.WorkerPID] {
			t.Fatal("child process identity", r.WorkerPID, err)
		}
		pids[r.WorkerPID] = true
		if err = w.manager.CancelGeneration(workspaceID(), r.ID, r.Generation); err == nil {
			t.Fatal("wrong owner cancelled")
		}
		if err = w.manager.CancelGeneration(w.state.ID, r.ID, r.Generation+1); err == nil {
			t.Fatal("wrong generation cancelled")
		}
		if err = w.manager.CancelGeneration(w.state.ID, r.ID, r.Generation); err != nil {
			t.Fatal(err)
		}
		r, err = w.manager.Wait(context.Background(), w.state.ID, r.ID, 10000)
		if err != nil || r.State != "cancelled" || r.WorkerPID != 0 {
			t.Fatal("child survived cancellation", r.State, err)
		}
	}
}
