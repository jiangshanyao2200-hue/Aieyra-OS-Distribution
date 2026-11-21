// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestLegacyRequestLimitAllowsMoreThan128RequestsAnd16Turns; TestStartupCompactionProcessesMoreThanEightBatches; TestCompletedHistoryDoesNotLimitNewTasksOrRestart; TestResolvedHumanRequestsDoNotLimitFutureQuestions
// Impact: python -B scripts/code-atlas.py show Core/agent_open_requests_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestLegacyRequestLimitAllowsMoreThan128RequestsAnd16Turns(t *testing.T) {
	var requests atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		fixtureAnswer(w, "open-turn", "DONE", nil)
	})
	// This test counts explicit conversation turns, independently of the
	// compaction threshold (now prepared at 80% of the working target).
	settings, loadErr := Load(m.config)
	if loadErr != nil {
		t.Fatal(loadErr)
	}
	setTestProfileCompact(settings, 0)
	if err := settings.Save(); err != nil {
		t.Fatal(err)
	}
	spec := AgentSpec{RequestID: "initial", ModelID: "local-model", Task: "Complete this explicit turn", Workdir: dir, MaxRequests: 1}
	r, err := m.Create(context.Background(), testMatrixOwner, spec)
	if err != nil {
		t.Fatal(err)
	}
	for n := 1; n <= 130; n++ {
		r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
		if err != nil || r.State != "completed" || r.Requests != n || r.Generation != n {
			t.Fatalf("turn %d: state=%s requests=%d generation=%d error=%s: %v", n, r.State, r.Requests, r.Generation, r.Error, err)
		}
		if n < 130 {
			r, err = m.SendGeneration(testMatrixOwner, r.ID, fmt.Sprintf("turn-%d", n+1), "Complete the next explicit turn", r.Generation)
			if err != nil {
				t.Fatal(err)
			}
		}
	}
	if requests.Load() != 130 || len(r.Usage) != 130 || r.AccountedTokens != 13000 {
		t.Fatalf("accounting lost: requests=%d usage=%d tokens=%d", requests.Load(), len(r.Usage), r.AccountedTokens)
	}
	// Emulate a durable record written by the previous release without changing its receipts.
	m.mu.Lock()
	j := m.jobs[r.ID]
	j.record.Spec.MaxRequests = 1
	err = m.saveLocked(j)
	m.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	m.Close()
	next, err := NewAgentManager(m.config, testMatrixOwner, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer next.Close()
	duplicate, err := next.Create(context.Background(), testMatrixOwner, spec)
	if err != nil || duplicate.ID != r.ID || requests.Load() != 130 {
		t.Fatal("legacy idempotency or restart replay", err)
	}
	_, err = next.SendGeneration(testMatrixOwner, r.ID, "after-restart", "Explicit new request", r.Generation)
	if err != nil {
		t.Fatal(err)
	}
	r, err = next.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "completed" || r.Requests != 131 || requests.Load() != 131 {
		t.Fatal("legacy record blocked continuation", r.State, r.Error, err)
	}
}

func TestStartupCompactionProcessesMoreThanEightBatches(t *testing.T) {
	var requests atomic.Int32
	w, _ := testWorkspace(t, func(rw http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		fixtureAnswer(rw, "compact", startupFixtureSummary(t, body["input"]), nil)
	})
	path, id := seedStartupMessages(t, w, []Message{{Role: RoleUser, Content: "Keep every receipt."}})
	a, _, err := RestoreSession(filepath.Join(w.manager.dir, "config.json"), id)
	if err != nil {
		t.Fatal(err)
	}
	settings, err := Load(w.config)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := compactionSettings(settings)
	limit := min(96000, max(1024, (snapshot.ContextBudget().InputLimit()-8192)/2))
	message := Message{Role: RoleUser, Content: "history "}
	for EstimateMessages([]Message{message}) < limit*3/4 {
		message.Content += strings.Repeat("history ", 64)
	}
	if EstimateMessages([]Message{message}) >= limit || EstimateMessages([]Message{message, message}) <= limit {
		t.Fatal("invalid batch fixture")
	}
	// Every message fits individually; two cannot share a compaction batch.
	for n := 0; n < 10; n++ {
		if err = a.Append("message", message); err != nil {
			t.Fatal(err)
		}
	}
	a.Close()
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	cp, err := w.prepareStartup(context.Background(), settings, w.greetingEpoch)
	if err != nil || cp == nil || cp.Covered != 11 || requests.Load() <= 8 || !w.startupPrepared {
		t.Fatalf("startup batches=%d checkpoint_present=%v prepared=%v error=%v", requests.Load(), cp != nil, w.startupPrepared, err)
	}
	after, err := os.ReadFile(path)
	if err != nil || !strings.HasPrefix(string(after), string(before)) || len(w.greetingUsage) != int(requests.Load()) {
		t.Fatal("history or request accounting lost", err)
	}
}

func TestCompletedHistoryDoesNotLimitNewTasksOrRestart(t *testing.T) {
	var requests atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		fixtureAnswer(w, "archive", "DONE", nil)
	})
	for n := 0; n < 65; n++ {
		r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: fmt.Sprintf("task-%d", n), ModelID: "local-model", Task: "Complete", Workdir: dir})
		if err != nil {
			t.Fatalf("create %d: %v", n, err)
		}
		r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
		if err != nil || r.State != "completed" {
			t.Fatal(r.State, r.Error, err)
		}
	}
	m.Close()
	next, err := NewAgentManager(m.config, testMatrixOwner, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer next.Close()
	if len(next.jobs) != 65 || requests.Load() != 65 {
		t.Fatal("history lost or replayed")
	}
	r, err := next.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "after-restart", ModelID: "local-model", Task: "Complete", Workdir: dir})
	if err != nil {
		t.Fatal(err)
	}
	r, err = next.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "completed" || requests.Load() != 66 {
		t.Fatal(r.State, err)
	}
}

func TestResolvedHumanRequestsDoNotLimitFutureQuestions(t *testing.T) {
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		fixtureAnswer(w, "finished", "DONE", nil)
	})
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "human-history", ModelID: "local-model", Task: "Complete", Workdir: dir, Tools: []string{"human"}})
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "completed" {
		t.Fatal(r.State, err)
	}
	m.mu.Lock()
	j := m.jobs[r.ID]
	j.record.State = "running"
	for n := 0; n < 32; n++ {
		j.record.HumanRequests = append(j.record.HumanRequests, HumanRequest{ID: fmt.Sprintf("old-%d", n), State: "resolved", Generation: 1})
	}
	m.mu.Unlock()
	ctx := context.WithValue(context.Background(), humanBoundaryKey{}, true)
	h, err := m.requestHuman(ctx, r.ID, rawJSON(humanTestQuestion()))
	if err != nil || h.State != "preparing" {
		t.Fatal("completed decisions blocked a new question", h.State, err)
	}
	duplicate, err := m.requestHuman(ctx, r.ID, rawJSON(humanTestQuestion()))
	if err != nil || duplicate.ID != h.ID {
		t.Fatal("idempotency lost", err)
	}
	question := humanTestQuestion()
	question.RequestID = "another-question"
	if _, err = m.requestHuman(ctx, r.ID, rawJSON(question)); err == nil {
		t.Fatal("concurrent human decision was accepted")
	}
	m.mu.Lock()
	if len(j.record.HumanRequests) != 33 {
		t.Error("human history lost")
	}
	j.record.State = "completed"
	m.mu.Unlock()
}
