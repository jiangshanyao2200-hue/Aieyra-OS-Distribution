// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestStartupBoundaryRejectsChangedPrefixAndClonesNestedCheckpoint; TestStartupStaleEpochCannotPublish; TestStartupAwaitCancellationLeavesBackgroundAlive; TestStartupRetryKeepsOriginalPrefix; TestStartupLateGreetingCannotReplaceUserWork
// Impact: python -B scripts/code-atlas.py show Core/workspace_startup_boundary_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestStartupBoundaryRejectsChangedPrefixAndClonesNestedCheckpoint(t *testing.T) {
	history := []Message{{Role: RoleUser, Content: "old"}, {Role: RoleAssistant, Content: "done"}}
	cp := &Checkpoint{Covered: 2, LastUser: "old", Summary: CompactSummary{Goals: []string{"goal"}}, Compression: &ContextCompression{BeforeTokens: 100001, AfterTokens: 20}, Plan: &PlanState{Acceptance: []string{"kept"}, Phases: []PlanPhase{{Steps: []PlanStep{{Evidence: []string{"receipt"}}}}}}}
	w := &Workspace{startupSource: "source", startupCount: 2, startupDigest: startupHistoryDigest(history), startupPrepared: true, startupCheckpoint: cp}
	current := &Checkpoint{Covered: 1}
	altered := append([]Message(nil), history...)
	altered[0].Content = "changed"
	for _, x := range []struct {
		id       string
		messages []Message
	}{{"other", history}, {"source", altered}, {"source", history[:1]}} {
		got, omitted, pending := w.startupBoundary(x.id, x.messages, current)
		if got != current || omitted != 0 || pending {
			t.Fatal("accepted mismatched startup prefix")
		}
	}
	got, omitted, pending := w.startupBoundary("source", append(history, Message{Role: RoleUser, Content: "new"}), current)
	if got == cp || got.Covered != 2 || omitted != 0 || pending {
		t.Fatal("checkpoint was not copied")
	}
	got.Summary.Goals[0] = "changed"
	got.Plan.Acceptance[0] = "changed"
	got.Plan.Phases[0].Steps[0].Evidence[0] = "changed"
	got.Compression.AfterTokens = 99
	if cp.Summary.Goals[0] != "goal" || cp.Plan.Acceptance[0] != "kept" || cp.Plan.Phases[0].Steps[0].Evidence[0] != "receipt" || cp.Compression.AfterTokens != 20 {
		t.Fatal("checkpoint shares nested state")
	}
	newer := &Checkpoint{Covered: 3}
	same, _, _ := w.startupBoundary("source", history, newer)
	if same != newer {
		t.Fatal("replaced newer checkpoint")
	}
}

func TestStartupStaleEpochCannotPublish(t *testing.T) {
	w := &Workspace{startupEpoch: 2}
	if _, err := w.finishStartup(1, &Checkpoint{Covered: 9}); !errors.Is(err, context.Canceled) || w.startupPrepared || w.startupCheckpoint != nil {
		t.Fatal("stale worker published", err)
	}
	w.closed = true
	if _, err := w.finishStartup(2, &Checkpoint{Covered: 9}); !errors.Is(err, context.Canceled) || w.startupPrepared {
		t.Fatal("closed workspace accepted worker", err)
	}
}

func TestStartupAwaitCancellationLeavesBackgroundAlive(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	w, _ := testWorkspace(t, func(rw http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		if calls.Add(1) == 1 {
			close(entered)
		}
		select {
		case <-release:
			fixtureAnswer(rw, "compact", startupFixtureSummary(t, body["input"]), nil)
		case <-r.Context().Done():
		}
	})
	var released atomic.Bool
	defer func() {
		if !released.Swap(true) {
			close(release)
		}
	}()
	seedStartupHistory(t, w)
	startFixturePreparation(t, w, false)
	_, _ = w.greet(json.RawMessage(`{"skip":true}`))
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("background did not start")
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan any, 1)
	go func() { done <- w.awaitStartup(ctx) }()
	cancel()
	select {
	case result := <-done:
		if result.(map[string]any)["ok"] != false {
			t.Fatal(result)
		}
	case <-time.After(time.Second):
		t.Fatal("cancelled wait blocked")
	}
	w.mu.Lock()
	workers, prepared := w.startupWorkers, w.startupPrepared
	w.mu.Unlock()
	if workers != 1 || prepared {
		t.Fatal("waiting cancellation changed worker")
	}
	released.Store(true)
	close(release)
	w.greetingWG.Wait()
	if !w.startupPrepared || w.startupError != "" {
		t.Fatal("background failed after cancelled wait", w.startupError)
	}
}

func TestStartupRetryKeepsOriginalPrefix(t *testing.T) {
	var compacts atomic.Int32
	w, _ := testWorkspace(t, func(rw http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		input := string(body["input"])
		if strings.Contains(input, "只输出一个 JSON 对象") {
			if compacts.Add(1) == 1 {
				fixtureAnswer(rw, "bad", `{"source_digest":"wrong"}`, nil)
			} else {
				if strings.Contains(input, "NEW_PREFIX_SENTINEL") {
					t.Error("retry included post-startup history")
				}
				fixtureAnswer(rw, "compact", startupFixtureSummary(t, body["input"]), nil)
			}
			return
		}
		fixtureAnswer(rw, "greeting", "READY", nil)
	})
	archivePath, sourceID := seedStartupHistory(t, w)
	startFixturePreparation(t, w, false)
	_, _ = w.greet(json.RawMessage(`{"skip":true}`))
	w.greetingWG.Wait()
	if w.startupError == "" || w.startupPrepared {
		t.Fatal("invalid compact result did not fail")
	}
	prefix := w.startupDigest
	count := w.startupCount
	archive, _, err := RestoreSession(w.manager.dir+"/config.json", sourceID)
	if err != nil {
		t.Fatal(err)
	}
	if err = archive.Append("message", Message{Role: RoleUser, Content: "NEW_PREFIX_SENTINEL"}); err != nil {
		t.Fatal(err)
	}
	archive.Close()
	before, _ := os.ReadFile(archivePath)
	startFixturePreparation(t, w, true)
	_, err = w.greet(json.RawMessage(`{"retry":true}`))
	if err != nil {
		t.Fatal(err)
	}
	w.greetingWG.Wait()
	after, _ := os.ReadFile(archivePath)
	if !w.startupPrepared || w.startupDigest != prefix || w.startupCount != count || string(before) != string(after) {
		t.Fatal("retry changed source history")
	}
}

func TestStartupLateGreetingCannotReplaceUserWork(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var greeted, released atomic.Bool
	w, _ := testWorkspace(t, func(rw http.ResponseWriter, r *http.Request) {
		if !greeted.Swap(true) {
			close(entered)
			<-release
			fixtureAnswer(rw, "late", "LATE_GREETING_SENTINEL", nil)
			return
		}
		fixtureAnswer(rw, "task", "NEW_TASK_RESULT", nil)
	})
	defer func() {
		if !released.Swap(true) {
			close(release)
		}
	}()
	_, _ = w.greet(json.RawMessage(`{}`))
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("greeting not started")
	}
	// 使用真实任务，确保迟到欢迎不能覆盖用户已经提交的工作。
	if _, err := w.Send("new-work", "NEW_PREFIX_SENTINEL"); err != nil {
		t.Fatal(err)
	}
	released.Store(true)
	close(release)
	waitStartupTask(t, w)
	w.greetingWG.Wait()
	if w.greeting.State != "skipped" || strings.Contains(w.greeting.Text, "LATE_GREETING") {
		t.Fatal("late greeting overwrote user work")
	}
}
