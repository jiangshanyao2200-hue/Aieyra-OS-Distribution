// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: homeTestModels; homeTestChoose; homeTestSnapshot; homeTestSave; homeTestUsage; TestHomeModelChoiceSurvivesReopenAndStaysInConversation; TestHomeUsageSurvivesReopenAndContinuedRequests; TestHomeBackgroundUsageKeepsSourceAcrossSwitch; TestHomePreferenceSaveFailurePreservesModelAndReceipt; TestHomeUsageMergePreservesPartialCacheAndImageCounts; TestHomeUnavailableModelCanBeExplicitlyReplacedAfterReopen; homeLedgerReceipt; homeTestLedger; TestHomeLedgerScopeSurvivesReopenAndDoesNotMixConversations; TestHomeGreetingOnlyReopenRetainsReceiptAndShownGreeting; TestHomeInitialAccountingFailureKeepsUnattributedReceipt
// Impact: python -B scripts/code-atlas.py show Core/workspace_preferences_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
)

func homeTestModels(t *testing.T, m *AgentManager) {
	t.Helper()
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	p := s.APIProfiles[0]
	p.ID, p.Model = "home-choice", "home-alternate"
	s.APIProfiles = append(s.APIProfiles, p)
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
}

func homeTestChoose(t *testing.T, w *Workspace, model string) {
	t.Helper()
	if _, err := w.configure(WorkspaceMatrix, rawJSON(map[string]any{"action": "model", "role": WorkspaceMatrix, "model_id": model, "session_id": w.state.ID})); err != nil {
		t.Fatal(err)
	}
}

func homeTestSnapshot(t *testing.T, w *Workspace) map[string]any {
	t.Helper()
	v, err := w.Snapshot(0)
	if err != nil {
		t.Fatal(err)
	}
	return v.(map[string]any)
}

func homeTestSave(t *testing.T, w *Workspace) {
	t.Helper()
	w.mu.Lock()
	err := w.saveLocked()
	w.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
}

func homeTestUsage(t *testing.T, w *Workspace) map[string]any {
	t.Helper()
	s := homeTestSnapshot(t, w)
	r := s["roles"].([]any)[0].(map[string]any)
	u, _ := r["usage"].(map[string]any)
	return mergeWorkspaceUsage(u, s["greeting_usage"].(map[string]any))
}

func TestHomeModelChoiceSurvivesReopenAndStaysInConversation(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("restoring preferences called provider") })
	homeTestModels(t, m)
	before, err := os.ReadFile(m.config)
	if err != nil {
		t.Fatal(err)
	}
	w := modeWorkspace(t, m.config, dir, HostOS)
	homeTestChoose(t, w, "home-choice") // No user message or catalog existed yet.
	id := contextTestView(t, w)["session_id"].(string)
	w.Close()
	w = modeWorkspace(t, m.config, dir, HostOS)
	if homeTestSnapshot(t, w)["model_id"] != "home-choice" {
		t.Fatal("reopen lost the current conversation model")
	}
	contextTestAction(t, w, "new", map[string]any{"title": "separate"})
	if homeTestSnapshot(t, w)["model_id"] != "local-model" {
		t.Fatal("model override leaked into a new conversation")
	}
	contextTestAction(t, w, "switch", map[string]any{"id": id})
	if homeTestSnapshot(t, w)["model_id"] != "home-choice" {
		t.Fatal("switching back lost the model override")
	}
	after, err := os.ReadFile(m.config)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("conversation choice changed personal model defaults", err)
	}
}

func TestHomeUsageSurvivesReopenAndContinuedRequests(t *testing.T) {
	var calls atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["model"] != "home-alternate" {
			t.Errorf("restored choice did not reach provider: %v", body["model"])
		}
		calls.Add(1)
		fixtureAnswer(w, "home-usage", "done", nil)
	})
	homeTestModels(t, m)
	w := modeWorkspace(t, m.config, dir, HostOS)
	zero := 0
	w.mu.Lock()
	w.recordBackgroundUsageLocked(w.backgroundUsageScopeLocked(), nil, AgentUsage{Kind: "greeting", Reported: true, Input: 10, Output: 2, Cached: &zero})
	w.mu.Unlock()
	homeTestChoose(t, w, "home-choice")
	id := contextTestView(t, w)["session_id"].(string)
	for round := 1; round <= 3; round++ {
		contextTestTurn(t, w, "one bounded synthetic request")
		for repeat := 0; repeat < 3; repeat++ {
			homeTestSave(t, w)
		}
		u := homeTestUsage(t, w)
		if u["total_tokens"] != round*100+12 || u["samples"] != round+1 || u["cache_input_tokens"] != round*80+10 || u["cached_tokens"] != round*32 {
			t.Fatalf("lost or double counted receipt in round %d: %v", round, u)
		}
		w.Close()
		w = modeWorkspace(t, m.config, dir, HostOS)
		if got := homeTestUsage(t, w); !bytes.Equal(rawJSON(got), rawJSON(u)) {
			t.Fatalf("reopen changed usage: before=%v after=%v", u, got)
		}
		if calls.Load() != int32(round) {
			t.Fatal("restoring display facts replayed a request", calls.Load())
		}
	}
	contextTestAction(t, w, "new", map[string]any{"title": "separate accounting"})
	if homeTestUsage(t, w)["samples"] != 0 {
		t.Fatal("another conversation inherited receipts")
	}
	contextTestAction(t, w, "switch", map[string]any{"id": id})
	if homeTestUsage(t, w)["total_tokens"] != 312 {
		t.Fatal("switching lost cumulative usage")
	}
}

func TestHomeBackgroundUsageKeepsSourceAcrossSwitch(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("accounting called provider") })
	w := modeWorkspace(t, m.config, dir, HostOS)
	w.mu.Lock()
	initialScope := w.backgroundUsageScopeLocked()
	w.recordBackgroundUsageLocked(initialScope, nil, AgentUsage{Kind: "greeting", Reported: true, Input: 10, Output: 2})
	w.mu.Unlock()
	second := contextTestAction(t, w, "new", map[string]any{"title": "second"})["session_id"].(string)
	first := w.initialContextID
	w.mu.Lock()
	w.recordBackgroundUsageLocked(initialScope, nil, AgentUsage{Kind: "startup_compact"}) // Late and unknown, not zero.
	secondScope := w.backgroundUsageScopeLocked()
	w.mu.Unlock()
	if homeTestUsage(t, w)["samples"] != 0 {
		t.Fatal("late startup receipt leaked into the selected conversation")
	}
	contextTestAction(t, w, "switch", map[string]any{"id": first})
	w.mu.Lock()
	w.recordBackgroundUsageLocked(secondScope, nil, AgentUsage{Kind: "context_clean", Reported: true, Input: 20, Output: 4})
	w.mu.Unlock()
	u := homeTestUsage(t, w)
	if u["samples"] != 2 || u["unknown"] != 1 || u["total_tokens"] != 12 || u["complete"] != false || u["cached_known"] != false {
		t.Fatal("source receipt facts changed", u)
	}
	w.Close()
	w = modeWorkspace(t, m.config, dir, HostOS)
	if got := homeTestUsage(t, w); !bytes.Equal(rawJSON(u), rawJSON(got)) {
		t.Fatal("source accounting did not survive restart", got)
	}
	contextTestAction(t, w, "switch", map[string]any{"id": second})
	if got := homeTestUsage(t, w); got["samples"] != 1 || got["total_tokens"] != 24 {
		t.Fatal("late cleaner was not charged to its own conversation", got)
	}
}

func TestHomePreferenceSaveFailurePreservesModelAndReceipt(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("saving preferences called provider") })
	homeTestModels(t, m)
	w := modeWorkspace(t, m.config, dir, HostOS)
	homeTestChoose(t, w, "local-model")
	path := filepath.Join(w.contextDirectory(), "sessions.json")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	w.mu.Lock()
	digest := w.contextCatalogDigest
	w.contextCatalogDigest = "stale-catalog"
	w.mu.Unlock()
	if _, err := w.configure(WorkspaceMatrix, rawJSON(map[string]any{"action": "model", "role": WorkspaceMatrix, "model_id": "home-choice"})); err == nil {
		t.Fatal("failed catalog commit reported a successful model change")
	}
	if homeTestSnapshot(t, w)["model_id"] != "local-model" {
		t.Fatal("failed model change was not rolled back")
	}
	w.mu.Lock()
	w.recordBackgroundUsageLocked(w.backgroundUsageScopeLocked(), nil, AgentUsage{Kind: "greeting", Reported: true, Input: 9, Output: 1})
	w.mu.Unlock()
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("failed commit overwrote the catalog", err)
	}
	if homeTestUsage(t, w)["total_tokens"] != 10 {
		t.Fatal("actual receipt disappeared on persistence failure")
	}
	w.mu.Lock()
	w.contextCatalogDigest = digest
	w.mu.Unlock()
	homeTestSave(t, w)
	homeTestSave(t, w)
	w.Close()
	w = modeWorkspace(t, m.config, dir, HostOS)
	if u := homeTestUsage(t, w); u["samples"] != 1 || u["total_tokens"] != 10 {
		t.Fatal("retry lost or charged the receipt twice", u)
	}
}

func TestHomeUsageMergePreservesPartialCacheAndImageCounts(t *testing.T) {
	zero, reasoning := 0, 2
	rows := []AgentUsage{
		{Kind: "model", Reported: true, Input: 100, Output: 10, Cached: &zero, Reasoning: &reasoning},
		{Kind: "model", Estimated: true, Input: 20, Output: 3},
		{Kind: "image_gen", Reported: true, Input: 1000, Output: 2000},
		{Kind: "greeting"},
	}
	var restored map[string]any
	if err := json.Unmarshal(rawJSON(workspaceUsage(rows[:2])), &restored); err != nil {
		t.Fatal(err)
	}
	got := mergeWorkspaceUsage(restored, workspaceUsage(rows[2:]))
	if want := workspaceUsage(rows); !bytes.Equal(rawJSON(got), rawJSON(want)) {
		t.Fatalf("merged receipt meaning changed: got=%v want=%v", got, want)
	}
}

func TestHomeUnavailableModelCanBeExplicitlyReplacedAfterReopen(t *testing.T) {
	for _, unavailable := range []string{"deleted", "disabled"} {
		t.Run(unavailable, func(t *testing.T) {
			m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unavailable model ran") })
			homeTestModels(t, m)
			w := modeWorkspace(t, m.config, dir, HostOS)
			homeTestChoose(t, w, "home-choice")
			w.Close()
			s, err := Load(m.config)
			if err != nil {
				t.Fatal(err)
			}
			if unavailable == "deleted" {
				s.APIProfiles = s.APIProfiles[:1]
			} else {
				disabled := false
				s.APIProfiles[1].Enabled = &disabled
			}
			if err = s.Save(); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(m.config)
			if err != nil {
				t.Fatal(err)
			}
			w = modeWorkspace(t, m.config, dir, HostOS)
			snapshot := homeTestSnapshot(t, w)
			if snapshot["ready"] != false || snapshot["model_id"] != "home-choice" {
				t.Fatal("unavailable choice silently changed", snapshot["model_id"])
			}
			if _, err = w.Send("must-not-run", "do not use another model automatically"); err == nil {
				t.Fatal("unavailable model accepted a request")
			}
			choose := func(expected string) error {
				_, err := w.configure(WorkspaceMatrix, rawJSON(map[string]any{"action": "model", "role": WorkspaceMatrix, "model_id": "local-model", "expected_model": expected, "session_id": w.state.ID}))
				return err
			}
			if choose("unrelated-choice") == nil {
				t.Fatal("stale model selection was accepted")
			}
			if err = choose("home-choice"); err != nil {
				t.Fatal("cannot recover from removed model", err)
			}
			after, err := os.ReadFile(m.config)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("recovery changed personal model defaults", err)
			}
			w.Close()
			w = modeWorkspace(t, m.config, dir, HostOS)
			snapshot = homeTestSnapshot(t, w)
			if snapshot["ready"] != true || snapshot["model_id"] != "local-model" {
				t.Fatal("replacement did not persist")
			}
		})
	}
}

type homeLedgerReceipt struct {
	Session string     `json:"session"`
	Usage   AgentUsage `json:"usage"`
}

func homeTestLedger(t *testing.T, dir string) []homeLedgerReceipt {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, "usage.jsonl"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	var rows []homeLedgerReceipt
	for _, line := range bytes.Split(data, []byte("\n")) {
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var row homeLedgerReceipt
		if err := json.Unmarshal(line, &row); err != nil {
			t.Fatal(err)
		}
		rows = append(rows, row)
	}
	return rows
}

func TestHomeLedgerScopeSurvivesReopenAndDoesNotMixConversations(t *testing.T) {
	var calls atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		fixtureAnswer(w, "ledger", "done", nil)
	})
	h, w := openCoreLinkHome(t, m.config, dir)
	w.mu.Lock()
	w.recordBackgroundUsageLocked(w.backgroundUsageScopeLocked(), nil, AgentUsage{Kind: "greeting", At: "2026-11-07T00:00:00Z", Reported: true, Input: 10, Output: 2})
	first := w.contextBook.Active
	w.mu.Unlock()
	firstDir := w.manager.dir
	contextTestTurn(t, w, "first persisted request")
	homeTestSave(t, w)
	firstBytes, err := os.ReadFile(filepath.Join(firstDir, "usage.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	h.Close()
	h, w = openCoreLinkHome(t, m.config, dir)
	secondDir := w.manager.dir
	if rows := homeTestLedger(t, secondDir); len(rows) != 0 {
		t.Fatal("reopen copied or replayed receipts", rows)
	}
	contextTestTurn(t, w, "second persisted request")
	homeTestSave(t, w)
	second := contextTestAction(t, w, "new", map[string]any{"title": "separate"})["session_id"].(string)
	w.mu.Lock()
	w.recordBackgroundUsageLocked(first, nil, AgentUsage{Kind: "context_clean", At: "2026-11-07T00:00:01Z", Reported: true, Input: 5, Output: 1})
	w.mu.Unlock()
	contextTestTurn(t, w, "request in the other conversation")
	homeTestSave(t, w)
	counts, totals := map[string]int{}, map[string]int{}
	for _, row := range append(homeTestLedger(t, firstDir), homeTestLedger(t, secondDir)...) {
		counts[row.Session]++
		totals[row.Session] += row.Usage.Input + row.Usage.Output
	}
	if len(counts) != 2 || counts[first] != 4 || totals[first] != 218 || counts[second] != 1 || totals[second] != 100 || calls.Load() != 3 {
		t.Fatal("ledger source changed or a receipt was duplicated", counts, totals, calls.Load())
	}
	after, err := os.ReadFile(filepath.Join(firstDir, "usage.jsonl"))
	if err != nil || !bytes.Equal(firstBytes, after) {
		t.Fatal("old runtime ledger was rewritten", err)
	}
	h.Close()
	_, w = openCoreLinkHome(t, m.config, dir)
	if homeTestUsage(t, w)["total_tokens"] != 100 {
		t.Fatal("second conversation restored another scope")
	}
	contextTestAction(t, w, "switch", map[string]any{"id": first})
	if homeTestUsage(t, w)["total_tokens"] != 218 || calls.Load() != 3 {
		t.Fatal("durable snapshot and ledger disagree after reopen")
	}
}

func TestHomeGreetingOnlyReopenRetainsReceiptAndShownGreeting(t *testing.T) {
	for _, failed := range []bool{false, true} {
		name := "success"
		if failed {
			name = "failure"
		}
		t.Run(name, func(t *testing.T) {
			var calls atomic.Int32
			m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if failed {
					http.Error(w, "synthetic unavailable", http.StatusServiceUnavailable)
					return
				}
				fixtureAnswer(w, "greeting", "hello from the previous screen", nil)
			})
			h, w := openCoreLinkHome(t, m.config, dir)
			if _, err := w.greet(rawJSON(map[string]any{"retry": true})); err != nil {
				t.Fatal(err)
			}
			w.greetingWG.Wait()
			if calls.Load() != 1 || w.contextBook == nil {
				t.Fatal("greeting did not create exactly one durable accounting scope", calls.Load())
			}
			id, ledgerDir := w.contextBook.Active, w.manager.dir
			before := homeTestUsage(t, w)
			if before["samples"] != 1 || len(w.state.Messages) != 0 {
				t.Fatal("greeting was lost or manufactured a user turn", before)
			}
			h.Close()
			_, w = openCoreLinkHome(t, m.config, dir)
			result, err := w.greet(rawJSON(map[string]any{}))
			if err != nil {
				t.Fatal(err)
			}
			greeting := result.(WorkspaceGreeting)
			if failed {
				if greeting.State != "skipped" || greeting.Text != "" {
					t.Fatal("failed greeting became a successful displayed reply", greeting)
				}
			} else if greeting.State != "local" || !greeting.Resumed || greeting.Text != "hello from the previous screen" {
				t.Fatal("creating a durable scope lost the prior screen greeting", greeting)
			}
			rows := homeTestLedger(t, ledgerDir)
			if len(rows) != 1 || rows[0].Session != id || calls.Load() != 1 || !bytes.Equal(rawJSON(homeTestUsage(t, w)), rawJSON(before)) {
				t.Fatal("empty-conversation reopen changed billing or called provider", rows, calls.Load())
			}
		})
	}
}

func TestHomeInitialAccountingFailureKeepsUnattributedReceipt(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("accounting recovery called provider") })
	_, w := openCoreLinkHome(t, m.config, dir)
	contextDir := w.contextDirectory()
	if err := os.MkdirAll(contextDir, 0700); err != nil {
		t.Fatal(err)
	}
	release, err := lockSession(filepath.Join(contextDir, ".owner.lock"))
	if err != nil {
		t.Fatal(err)
	}
	w.mu.Lock()
	w.recordBackgroundUsageLocked(w.backgroundUsageScopeLocked(), nil, AgentUsage{Kind: "greeting", At: "2026-11-07T00:00:00Z", Reported: true, Input: 9, Output: 1})
	w.mu.Unlock()
	release()
	if w.contextBook != nil || homeTestUsage(t, w)["total_tokens"] != 10 {
		t.Fatal("failed initial persistence lost the actual cost")
	}
	rows := homeTestLedger(t, w.manager.dir)
	if len(rows) != 1 || rows[0].Session != w.state.ID {
		t.Fatal("failed attribution fabricated a durable owner", rows)
	}
	before, err := os.ReadFile(filepath.Join(w.manager.dir, "usage.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	homeTestChoose(t, w, "local-model")
	after, err := os.ReadFile(filepath.Join(w.manager.dir, "usage.jsonl"))
	if err != nil || !bytes.Equal(before, after) || homeTestUsage(t, w)["samples"] != 1 {
		t.Fatal("recovered persistence rewrote or charged the old receipt again", err)
	}
}
