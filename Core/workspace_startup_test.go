// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: startFixturePreparation; TestStartupSkipKeepsBackgroundRunningWithoutCommittingHistory; TestStartupSkipBeforeGreetingResumesQueuedInput; TestStartupRequestErrorsHaveNoAutomaticRetry; TestStartupDeadlineDoesNotWaitForStalledProvider; TestStartupMaintenanceDisablesMessagesThinkingWithoutEditingSettings; seedStartupHistory; seedStartupMessages; startupFixtureSummary; TestLegacyStartupCompactsOnceAndKeepsDreamArchived; TestStartupMalformedSummaryPreservesHistoryAndExplicitRetryRecovers; TestStartupCloseCancelsProviderAndPreservesArchive; TestStartupNewInputWaitsForOversizedHistoryAndUsesCommittedSummary; waitStartupTask; TestStartupCompressionStrictThreshold
// Impact: python -B scripts/code-atlas.py show Core/workspace_startup_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/sha256"
	"database/sql"
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

func startFixturePreparation(t *testing.T, w *Workspace, retry bool) {
	t.Helper()
	w.mu.Lock()
	defer w.mu.Unlock()
	model, err := w.modelLocked(WorkspaceMatrix)
	if err != nil {
		t.Fatal(err)
	}
	settings, err := w.manager.settings(model)
	if err != nil {
		t.Fatal(err)
	}
	w.startStartupLocked(settings, retry)
}

func TestStartupSkipKeepsBackgroundRunningWithoutCommittingHistory(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	w, _ := testWorkspace(t, func(rw http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		if strings.Contains(string(body["input"]), "只输出一个 JSON 对象") {
			if calls.Add(1) == 1 {
				close(entered)
			}
			<-release
			fixtureAnswer(rw, "compact", startupFixtureSummary(t, body["input"]), nil)
		} else {
			<-r.Context().Done()
		}
	})
	var released atomic.Bool
	defer func() {
		if !released.Swap(true) {
			close(release)
		}
	}()
	path, _ := seedStartupHistory(t, w)
	before, _ := os.ReadFile(path)
	startFixturePreparation(t, w, false)
	_, _ = w.greet(json.RawMessage(`{}`))
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("compact did not start")
	}
	start := time.Now()
	result, err := w.greet(json.RawMessage(`{"skip":true}`))
	if err != nil || result.(WorkspaceGreeting).State != "skipped" || time.Since(start) > time.Second {
		t.Fatal("skip blocked", err)
	}
	w.mu.Lock()
	prepared, workers := w.startupPrepared, w.startupWorkers
	w.mu.Unlock()
	if prepared || workers != 1 {
		t.Fatal("skip cancelled compact", prepared, workers)
	}
	released.Store(true)
	close(release)
	w.greetingWG.Wait()
	after, _ := os.ReadFile(path)
	if string(before) != string(after) || !w.startupPrepared || w.startupCheckpoint == nil || w.startupWorkers != 0 || w.greeting.State != "skipped" || w.greeting.Text != "" {
		t.Fatal("background result mutated archive or greeting")
	}
	_, _ = w.greet(json.RawMessage(`{}`))
	if w.greeting.State != "skipped" {
		t.Fatal("reload repeated greeting")
	}
}

func TestStartupSkipBeforeGreetingResumesQueuedInput(t *testing.T) {
	var calls atomic.Int32
	w, _ := testWorkspace(t, func(rw http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		fixtureAnswer(rw, "task", "已收到新任务。", nil)
	})
	if _, err := w.greet(json.RawMessage(`{"skip":true}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Send("after-skip", "只回答已收到新任务。"); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for calls.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if calls.Load() != 1 {
		t.Fatal("new input stayed blocked after skip", calls.Load())
	}
}

func TestStartupRequestErrorsHaveNoAutomaticRetry(t *testing.T) {
	var calls atomic.Int32
	w, _ := testWorkspace(t, func(rw http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.Error(rw, `{"error":{"message":"temporary unavailable"}}`, 503)
	})
	path, _ := seedStartupHistory(t, w)
	before, _ := os.ReadFile(path)
	start := time.Now()
	_, _ = w.greet(json.RawMessage(`{}`))
	w.greetingWG.Wait()
	after, _ := os.ReadFile(path)
	if calls.Load() != 1 || w.startupStarted || w.greeting.State != "offline" || w.greeting.Text != "" || !strings.Contains(w.greeting.Detail, "503") || time.Since(start) > time.Second || string(before) != string(after) {
		t.Fatal("startup error was hidden, retried, or history changed", calls.Load(), w.greeting.State)
	}
}

func TestStartupDeadlineDoesNotWaitForStalledProvider(t *testing.T) {
	release := make(chan struct{})
	w, _ := testWorkspace(t, func(rw http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		select {
		case <-r.Context().Done():
		case <-release:
		}
	})
	defer close(release)
	path, _ := seedStartupHistory(t, w)
	before, _ := os.ReadFile(path)
	s, _ := w.manager.settings("local-model")
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := w.prepareStartup(ctx, s, w.greetingEpoch)
	after, _ := os.ReadFile(path)
	if !errors.Is(err, context.DeadlineExceeded) || time.Since(start) > time.Second || string(before) != string(after) {
		t.Fatal("deadline failed to release startup", err)
	}
}

func TestStartupMaintenanceDisablesMessagesThinkingWithoutEditingSettings(t *testing.T) {
	s := Defaults()
	s.Adapter = "openai"
	s.APIProtocol = ProtocolMessages
	s.Model = "qwen3.8-flash"
	s.ModelOptions = map[string]any{"reasoning_effort": "high", "reasoning_enabled": true, "reasoning_budget": 4096}
	before := string(rawJSON(s))
	maintenance := compactionSettings(s)
	body := BuildNativeRequest(maintenance, []Message{{Role: RoleUser, Content: "test"}}, true, nil)
	encoded := string(rawJSON(body))
	if !strings.Contains(encoded, `"thinking":{"type":"disabled"}`) || strings.Contains(encoded, `"budget_tokens"`) {
		t.Fatal("maintenance thinking still enabled", encoded)
	}
	if string(rawJSON(s)) != before {
		t.Fatal("maintenance changed user settings")
	}
}

func seedStartupHistory(t *testing.T, w *Workspace) (string, string) {
	messages := []Message{{Role: RoleUser, Content: "保留原文件，完成全部任务。"}}
	for range 40 {
		messages = append(messages, Message{Role: RoleAssistant, Content: strings.Repeat("已核对一次，不要重做。", 300)})
	}
	messages = append(messages, Message{Role: RoleUser, Content: "接下来还有最后一项。"})
	if compactSourceTokens(nil, messages) <= startupCompressionThreshold {
		t.Fatal("fixture must exceed the startup threshold")
	}
	return seedStartupMessages(t, w, messages)
}

func seedStartupMessages(t *testing.T, w *Workspace, messages []Message) (string, string) {
	t.Helper()
	id := workspaceID()
	path, err := SessionPath(filepath.Join(w.manager.dir, "config.json"), id)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	a := &SessionArchive{Path: path}
	if err = a.Start("fixture"); err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	for _, m := range messages {
		if err = a.Append("message", m); err != nil {
			t.Fatal(err)
		}
	}
	w.mu.Lock()
	w.state.Roles[WorkspaceMatrix] = id
	err = w.saveLocked()
	w.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	return path, id
}

func startupFixtureSummary(t *testing.T, input json.RawMessage) string {
	t.Helper()
	var messages []struct {
		Content string `json:"content"`
	}
	if err := json.Unmarshal(input, &messages); err != nil {
		t.Fatal(err)
	}
	var source struct {
		Digest string `json:"source_digest"`
	}
	if err := json.Unmarshal([]byte(messages[len(messages)-1].Content), &source); err != nil {
		t.Fatal(err)
	}
	if source.Digest == "" {
		t.Fatal("missing source digest")
	}
	return string(rawJSON(CompactSummary{SourceDigest: source.Digest, Goals: []string{"完成剩余工作"}, Constraints: []string{"保留原文件"}, Decisions: []string{}, Progress: []string{"已核对一次"}, CriticalFacts: []string{}, OpenTasks: []string{"最后一项"}, NextSteps: []string{"等用户继续"}, Uncertainties: []string{}}))
}

func TestLegacyStartupCompactsOnceAndKeepsDreamArchived(t *testing.T) {
	var compacts, greetings atomic.Int32
	w, dir := testWorkspace(t, func(rw http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		var input []struct {
			Content string `json:"content"`
		}
		_ = json.Unmarshal(body["input"], &input)
		if len(input) > 0 && input[0].Content == compactInstruction() {
			compacts.Add(1)
			if strings.Contains(string(body["input"]), "FICTIONAL_DREAM") {
				t.Error("dream entered factual summary")
			}
			fixtureAnswer(rw, "compact", startupFixtureSummary(t, body["input"]), nil)
			return
		}
		greetings.Add(1)
		if strings.Contains(string(body["input"]), strings.Repeat("已核对一次，不要重做。", 10)) {
			t.Error("raw history leaked into greeting")
		}
		if strings.Contains(string(body["input"]), "FICTIONAL_DREAM") && (!strings.Contains(string(body["input"]), "fictional_startup_dream") || !strings.Contains(string(body["input"]), "不写入连续记忆")) {
			t.Error("dream imagery was not explicitly isolated from facts")
		}
		fixtureAnswer(rw, "greeting", "早上好，已经准备好了，我们接着来。", nil)
	})
	path, id := seedStartupHistory(t, w)
	before, _ := os.ReadFile(path)
	attach := func(w *Workspace) {
		w.service = NewSettingsService(w.config)
		t.Cleanup(w.service.Close)
	}
	attach(w)
	if _, err := w.readContinuity(context.Background()); err != nil {
		t.Fatal(err)
	}
	scope := fmt.Sprintf("project:%x", sha256.Sum256([]byte(strings.ToLower(filepath.Clean(dir)))))
	fixtureDB, err := sql.Open("sqlite", filepath.Join(DataDir(w.config), "memory", "eyra.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { fixtureDB.Close() })
	if _, err := fixtureDB.Exec("INSERT INTO dreams(id,scope,content,created,watermark) VALUES(?,?,?,?,?)", "dream-one", scope, "FICTIONAL_DREAM", time.Now().UnixMilli(), 0); err != nil {
		t.Fatal(err)
	}

	startFixturePreparation(t, w, false)
	if _, err := w.greet(json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	w.greetingWG.Wait()
	if w.greeting.State != "online" || !w.startupPrepared || strings.Contains(w.greeting.Text, "FICTIONAL_DREAM") {
		t.Fatalf("startup failed: %+v", w.greeting)
	}
	for i := 0; i < 3; i++ {
		if _, err := w.greet(json.RawMessage(`{}`)); err != nil {
			t.Fatal(err)
		}
	}
	firstCompacts := compacts.Load()
	var told int64
	var claim string
	err = fixtureDB.QueryRow("SELECT told,claim FROM dreams WHERE id='dream-one'").Scan(&told, &claim)
	if err != nil || firstCompacts < 2 || greetings.Load() != 1 || told != 0 || claim != "" {
		t.Fatal("reload repeated startup or legacy dream was consumed", firstCompacts, greetings.Load(), told, claim, err)
	}

	after, _ := os.ReadFile(path)
	if !strings.HasPrefix(string(after), string(before)) || strings.Contains(string(after), "FICTIONAL_DREAM") {
		t.Fatal("history changed or dream archived as fact")
	}
	if len(w.greetingUsage) != int(firstCompacts)+1 {
		t.Fatal("startup usage missing")
	}
	a, restored, err := RestoreSession(filepath.Join(w.manager.dir, "config.json"), id)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Checkpoint != nil || string(before) != string(after) {
		t.Fatal("worker committed before request boundary")
	}
	cp, omitted, pending := w.startupBoundary(id, restored.Messages, nil)
	if cp == nil || omitted != 0 || pending {
		t.Fatal("checkpoint not available at next boundary")
	}
	if err = a.Append("checkpoint", cp); err != nil {
		t.Fatal(err)
	}
	a.Close()
	config, workspaceID := w.config, w.state.ID
	w.Close()
	restarted, err := NewWorkspace(config, workspaceID, dir, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	attach(restarted)
	startFixturePreparation(t, restarted, false)
	if _, err = restarted.greet(json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	restarted.greetingWG.Wait()
	if compacts.Load() != firstCompacts || greetings.Load() != 2 || strings.Contains(restarted.greeting.Text, "FICTIONAL_DREAM") {
		t.Fatal("real restart repeated compact or replayed dream")
	}
	a, restored, err = RestoreSession(filepath.Join(restarted.manager.dir, "config.json"), id)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	if len(restored.Messages) != 42 || restored.Checkpoint.Covered != 42 || restored.Checkpoint.LastUser != "接下来还有最后一项。" {
		t.Fatal("exact history or pending task lost")
	}
}

func TestStartupMalformedSummaryPreservesHistoryAndExplicitRetryRecovers(t *testing.T) {
	var compactCalls, greetings atomic.Int32
	w, _ := testWorkspace(t, func(rw http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		var input []struct {
			Content string `json:"content"`
		}
		_ = json.Unmarshal(body["input"], &input)
		if len(input) > 0 && input[0].Content == compactInstruction() {
			if compactCalls.Add(1) == 1 {
				fixtureAnswer(rw, "bad-summary", `{"source_digest":"wrong"}`, nil)
				return
			}
			fixtureAnswer(rw, "valid-summary", startupFixtureSummary(t, body["input"]), nil)
			return
		}
		greetings.Add(1)
		fixtureAnswer(rw, "hello", "你好。", nil)
	})
	path, _ := seedStartupHistory(t, w)
	before, _ := os.ReadFile(path)
	startFixturePreparation(t, w, false)
	if _, err := w.greet(json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	w.greetingWG.Wait()
	after, _ := os.ReadFile(path)
	if w.greeting.State != "online" || w.startupPrepared || w.startupError == "" || greetings.Load() != 1 || string(before) != string(after) {
		t.Fatal("failed compact changed history or greeted as ready")
	}
	_, _ = w.greet(json.RawMessage(`{}`))
	if compactCalls.Load() != 1 {
		t.Fatal("reload retried failed boot")
	}
	startFixturePreparation(t, w, true)
	_, _ = w.greet(json.RawMessage(`{"retry":true}`))
	w.greetingWG.Wait()
	if w.greeting.State != "online" || compactCalls.Load() < 3 || greetings.Load() != 2 {
		t.Fatal("explicit recovery failed")
	}
}

func TestStartupCloseCancelsProviderAndPreservesArchive(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	w, _ := testWorkspace(t, func(rw http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		close(entered)
		select {
		case <-r.Context().Done():
		case <-release:
		}
	})
	defer close(release)
	path, _ := seedStartupHistory(t, w)
	before, _ := os.ReadFile(path)
	startFixturePreparation(t, w, false)
	_, _ = w.greet(json.RawMessage(`{"skip":true}`))
	<-entered
	finished := make(chan struct{})
	go func() { w.Close(); close(finished) }()
	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("close stuck on compact")
	}
	after, _ := os.ReadFile(path)
	if w.startupPrepared || string(before) != string(after) {
		t.Fatal("cancelled worker changed history")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	settings, _ := w.manager.settings("local-model")
	if _, err := w.prepareStartup(ctx, settings, w.startupEpoch); err == nil {
		t.Fatal("cancelled prepare succeeded")
	}
}

func TestStartupNewInputWaitsForOversizedHistoryAndUsesCommittedSummary(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var released atomic.Bool
	defer func() {
		if !released.Swap(true) {
			close(release)
		}
	}()
	var compactCalls, modelCalls atomic.Int32
	var resumed atomic.Bool
	var joined atomic.Bool
	w, project := testWorkspace(t, func(rw http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		input := string(body["input"])
		if strings.Contains(input, "只输出一个 JSON 对象") {
			if compactCalls.Add(1) == 1 {
				close(entered)
			}
			<-release
			fixtureAnswer(rw, "compact", startupFixtureSummary(t, body["input"]), nil)
			return
		}
		n := modelCalls.Add(1)
		if resumed.Load() {
			if n == 1 {
				if strings.Contains(input, "Earlier conversation is being prepared") || !strings.Contains(input, "完成剩余工作") || !strings.Contains(input, "现在核对第二项") {
					t.Error("first request did not receive the committed summary and new input")
				}
				fixtureAnswer(rw, "wait", "等我先想想。", []any{map[string]any{"type": "function_call", "id": "fc_wait", "call_id": "call_wait", "name": "memory", "arguments": `{"action":"await_startup"}`}})
				return
			}
			if n == 2 {
				if !strings.Contains(input, "完成剩余工作") || !strings.Contains(input, "call_wait") || !strings.Contains(input, `\"ready\":true`) || !strings.Contains(input, "现在核对第二项") {
					t.Error("next request lost summary, current input or tool round")
				}
				joined.Store(true)
			}
		}
		fixtureAnswer(rw, "ready", "已核对，准备继续。", nil)
	})
	if _, err := w.Send("before-startup", "核对第一项。"); err != nil {
		t.Fatal(err)
	}
	primary := waitStartupTask(t, w)
	a, _, err := RestoreSession(filepath.Join(w.manager.dir, "config.json"), primary)
	if err != nil {
		t.Fatal(err)
	}
	for range 40 {
		if err = a.Append("message", Message{Role: RoleAssistant, Content: strings.Repeat("已核对一次，不要重做。", 300)}); err != nil {
			t.Fatal(err)
		}
	}
	a.Close()
	config, id := w.config, w.state.ID
	w.Close()
	resumed.Store(true)
	modelCalls.Store(0)
	restarted, err := NewWorkspace(config, id, project, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	_, err = restarted.greet(json.RawMessage(`{"skip":true}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = restarted.Send("during-startup", "现在核对第二项，先等历史。"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("compact did not start")
	}
	if modelCalls.Load() != 0 {
		t.Fatal("oversized history reached the provider before compaction completed")
	}
	released.Store(true)
	close(release)
	waitStartupTask(t, restarted)
	restarted.greetingWG.Wait()
	if !joined.Load() || modelCalls.Load() != 2 || compactCalls.Load() < 2 {
		t.Fatal("history did not join next request", modelCalls.Load(), compactCalls.Load())
	}
	a, restored, err := RestoreSession(filepath.Join(restarted.manager.dir, "config.json"), primary)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	if restored.Checkpoint == nil || restored.Checkpoint.Covered > len(restored.Messages) {
		t.Fatal("archive or checkpoint lost", len(restored.Messages), restored.Checkpoint)
	}
	originals, covered := 0, 0
	for i, message := range restored.Messages {
		if message.ContextObservation {
			continue
		}
		originals++
		if i < restored.Checkpoint.Covered {
			covered++
		}
	}
	if covered != 42 || originals != 46 {
		t.Fatal("original conversation or checkpoint coverage changed", covered, originals)
	}
}

func waitStartupTask(t *testing.T, w *Workspace) string {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		w.mu.Lock()
		id := w.state.Roles[WorkspaceMatrix]
		w.mu.Unlock()
		if id != "" {
			r, err := w.manager.Wait(context.Background(), w.state.ID, id, 200)
			if err == nil && r.State == "completed" {
				return id
			}
			if err == nil && (r.State == "failed" || r.State == "cancelled") {
				t.Fatal("task failed", r.Error)
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("task did not complete")
	return ""
}

func TestStartupCompressionStrictThreshold(t *testing.T) {
	for _, tokens := range []int{99999, 100000, 100001} {
		t.Run(fmt.Sprint(tokens), func(t *testing.T) {
			var calls atomic.Int32
			w, _ := testWorkspace(t, func(rw http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				var body map[string]json.RawMessage
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				fixtureAnswer(rw, "boundary", startupFixtureSummary(t, body["input"]), nil)
			})
			messages := make([]Message, 10)
			for i := range messages {
				messages[i] = Message{Role: RoleAssistant, Content: strings.Repeat("界", 9000)}
			}
			messages[9].Content += strings.Repeat("界", tokens-compactSourceTokens(nil, messages))
			if got := compactSourceTokens(nil, messages); got != tokens {
				t.Fatalf("fixture tokens=%d, want %d", got, tokens)
			}
			path, _ := seedStartupMessages(t, w, messages)
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			s, err := Load(w.config)
			if err != nil {
				t.Fatal(err)
			}
			cp, err := w.prepareStartup(context.Background(), s, w.greetingEpoch)
			if err != nil || !w.startupPrepared {
				t.Fatal("startup not prepared", err)
			}
			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if tokens <= startupCompressionThreshold {
				if cp != nil || calls.Load() != 0 || string(before) != string(after) {
					t.Fatal("history at or below threshold was compacted")
				}
			} else if cp == nil || cp.Covered != len(messages) || calls.Load() == 0 || !strings.HasPrefix(string(after), string(before)) {
				t.Fatal("history above threshold was not fully compacted")
			}
		})
	}
}
