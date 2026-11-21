// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMotherRepairIndependentFailureUsesOriginalMother; TestMotherRepairQueueCoalescesBoundsAndRecoversWithoutExecution; TestMotherRepairReopenDeliversOnlyUncommittedNoticeOnUserTurn; TestMotherRepairSourceCommitSurvivesMissingInboxWrite; TestMotherRepairDoesNotInterveneAfterUserRetriesSameGeneration; TestMotherRepairBudgetDoesNotReplaceNormalUserBudget; TestMotherRepairExplicitHelpHasRuntimeBudgetAndUserCanContinue; TestConcurrentMotherRepairsKeepSeparateRuns; logMotherRepairFixture; TestMotherRepairWorkflowOutboxRetainsCancelledAndFailedGenerations; TestMotherRepairPackageFailureUsesBoundedOutbox; TestMotherRepairChecksCancellationAfterNetworkSlotWait; TestMotherRepairGroupOnlyEscalatesCoordinatorFailure
// Impact: python -B scripts/code-atlas.py show Core/workspace_repairs_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestMotherRepairIndependentFailureUsesOriginalMother(t *testing.T) {
	var target string
	var sourceCalls, motherCalls atomic.Int32
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, req *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(req.Body).Decode(&body)
		wire := string(rawJSON(body))
		if strings.Contains(wire, "SOURCE-PRIVATE-PROMPT") {
			if sourceCalls.Add(1) == 1 {
				rw.WriteHeader(http.StatusBadRequest)
				fmt.Fprint(rw, `{"error":{"message":"fixture repair needed","code":"repair_fixture"}}`)
				return
			}
			if !strings.Contains(wire, "母体介入") {
				t.Error("source was restarted without attributed intervention")
			}
			fixtureAnswer(rw, "repaired-source", "verified source result", nil)
			return
		}
		if !strings.Contains(wire, "母体主动修理事件") || !strings.Contains(wire, target) {
			t.Error("automatic mother did not receive the typed source reference")
		}
		if motherCalls.Add(1) == 1 {
			args := map[string]any{"kind": "conversation", "action": "send", "id": target, "generation": 1, "request_id": "repair-known-failure", "reason": "checked fixture failure receipt", "message": "Continue the deterministically failed fixture step."}
			fixtureAnswer(rw, "intervention", "", []any{map[string]any{"type": "function_call", "id": "repair-call", "call_id": "repair-call", "name": "agents", "arguments": string(rawJSON(args))}})
			return
		}
		fixtureAnswer(rw, "mother-done", "intervention submitted with original receipt", nil)
	})
	h, home := openCoreLinkHome(t, m.config, dir)
	cm, err := h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	v, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_create", "request_id": "repair-target", "name": "Repair target", "model_id": "local-model", "prompt_text": "SOURCE-PRIVATE-PROMPT"}))
	if err != nil {
		t.Fatal(err)
	}
	target = v.(map[string]any)["id"].(string)
	logMotherRepairFixture(t, home, cm, target)
	if _, err = h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "send", "id": target, "request_id": "original-user-task", "message": "Perform the fixture task."})); err != nil {
		t.Fatal(err)
	}
	waitCoreLink(t, "mother did not repair the source", func() bool {
		r, e := cm.Status(cm.owner, target)
		return e == nil && r.Generation == 2 && r.State == "completed" && motherCalls.Load() >= 2
	})
	home.mu.Lock()
	actor := home.state.Roles[WorkspaceMatrix]
	var notice workspaceMessage
	for _, msg := range home.state.Messages {
		if msg.Repair != nil {
			notice = msg
		}
	}
	home.mu.Unlock()
	if actor == "" || notice.Repair == nil || notice.From != target || notice.Origin != "mother_repair" || notice.Repair.Generation != 1 || notice.Repair.Episode == "" {
		t.Fatal("repair provenance missing", notice)
	}
	finished, err := home.manager.Wait(context.Background(), home.state.ID, actor, 10000)
	if err != nil || finished.State != "completed" || finished.RepairRun == nil || sourceCalls.Load() != 2 || motherCalls.Load() != 2 {
		t.Fatal(finished.State, finished.Error, err, sourceCalls.Load(), motherCalls.Load())
	}
	if len(home.manager.List(home.state.ID)) != 1 {
		t.Fatal("repair created another mother actor")
	}
	if origin := finished.TurnOrigins[notice.ID]; origin.From != target || origin.Kind != "intervention" {
		t.Fatal("repair masqueraded as user input", origin)
	}
}

func TestMotherRepairQueueCoalescesBoundsAndRecoversWithoutExecution(t *testing.T) {
	var calls atomic.Int32
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, req *http.Request) {
		calls.Add(1)
		fixtureAnswer(rw, "unexpected", "unexpected", nil)
	})
	h, home := openCoreLinkHome(t, m.config, dir)
	cm, _ := h.conversationManager()
	v, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_create", "request_id": "queue-target", "name": "Queue target", "model_id": "local-model", "prompt_text": "queue source"}))
	if err != nil {
		t.Fatal(err)
	}
	id := v.(map[string]any)["id"].(string)
	cm.mu.Lock()
	j := cm.jobs[id]
	j.record.Generation, j.record.State = 1, "failed"
	j.record.TurnGenerations = map[string]int{"user-task": 1}
	j.record.Turns = map[string]string{"user-task": "original task"}
	j.record.Failure = &AgentFailure{Code: "failure"}
	r := copyRecord(j.record)
	if err = cm.saveLocked(j); err != nil {
		t.Fatal(err)
	}
	cm.mu.Unlock()
	home.mu.Lock()
	home.manager.linkRootService.Store(cm)
	first, err := home.enqueueRepairLocked(cm, r, "failure", "first receipt", "request-one", "", nil)
	if err != nil {
		home.mu.Unlock()
		t.Fatal(err)
	}
	second, err := home.enqueueRepairLocked(cm, r, "failure", "second receipt", "request-two", "", nil)
	if err != nil || first.ID != second.ID || len(second.Repair.Requests) != 2 || len(first.Repair.Requests) != 1 {
		home.mu.Unlock()
		t.Fatal("same incident was not coalesced", err)
	}
	if _, err = home.enqueueRepairLocked(cm, r, "help", "changed meaning", "request-one", "", nil); err == nil {
		home.mu.Unlock()
		t.Fatal("request identity changed meaning")
	}
	for generation := 2; generation <= 4; generation++ {
		r.Generation = generation
		row, e := home.enqueueRepairLocked(cm, r, "failure", "same original task", fmt.Sprint(generation), "", nil)
		if e != nil {
			home.mu.Unlock()
			t.Fatal(e)
		}
		if generation < 4 && row.Repair.NotBefore == "" || generation == 4 && (row.State != "blocked" || row.Repair.Automatic) {
			home.mu.Unlock()
			t.Fatal("cooldown or episode cap missing", row)
		}
	}
	r.Generation = 5
	blocked, err := home.enqueueRepairLocked(cm, r, "quota", "account needs attention", "quota", "", nil)
	if err != nil || blocked.State != "blocked" {
		home.mu.Unlock()
		t.Fatal("quota automatically restarted work", err)
	}
	// Source cancellation is checked after the notice was committed.
	cm.mu.Lock()
	cm.jobs[id].record.LinkCancelled = true
	cm.mu.Unlock()
	ready, terminal := home.repairReadyLocked(first)
	if ready || terminal != "cancelled" {
		home.mu.Unlock()
		t.Fatal("late source stop was ignored", ready, terminal)
	}
	// Keep the committed first item pending until shutdown, then prove reopening
	// cannot execute it. No model call is used to build this persistence fixture.
	for i := range home.state.Messages {
		if home.state.Messages[i].Repair != nil && home.state.Messages[i].State == "queued" {
			home.state.Messages[i].Repair.NotBefore = time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano)
		}
	}
	if err = home.saveLocked(); err != nil {
		home.mu.Unlock()
		t.Fatal(err)
	}
	home.mu.Unlock()
	h.Close()
	_, reopened := openCoreLinkHome(t, m.config, dir)
	reopened.mu.Lock()
	retained := 0
	for _, msg := range reopened.state.Messages {
		if msg.Repair != nil {
			retained++
			if msg.State == "queued" {
				t.Error("reopen rearmed a repair")
			}
			if msg.ID == first.ID && len(msg.Repair.Requests) != 2 {
				t.Error("coalesced request identities were lost")
			}
		}
	}
	reopened.mu.Unlock()
	if retained != 5 || calls.Load() != 0 {
		t.Fatal("repair queue recovery changed execution", retained, calls.Load())
	}
}

func TestMotherRepairReopenDeliversOnlyUncommittedNoticeOnUserTurn(t *testing.T) {
	var calls, userCalls atomic.Int32
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, req *http.Request) {
		calls.Add(1)
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		wire := string(rawJSON(body["input"]))
		if strings.Contains(wire, "REVIEW-RETAINED-FAILURE") {
			userCalls.Add(1)
			if strings.Count(wire, "RECOVER-PENDING-REPAIR") != 1 ||
				strings.Count(wire, "ALREADY-ARCHIVED-REPAIR") > 1 ||
				strings.Contains(wire, "STOPPED-SOURCE-REPAIR") {
				t.Error("recovered request lost, repeated or crossed a stopped source")
			}
		}
		fixtureAnswer(rw, "recovered-user", "reviewed the original repair evidence", nil)
	})
	h, home := openCoreLinkHome(t, m.config, dir)
	cm, err := h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	source := func(key string, cancelled bool) AgentRecord {
		t.Helper()
		v, err := h.conversationCall(context.Background(), rawJSON(map[string]any{
			"action": "contact_create", "request_id": key, "name": key, "model_id": "local-model", "prompt_text": "source",
		}))
		if err != nil {
			t.Fatal(err)
		}
		id := v.(map[string]any)["id"].(string)
		cm.mu.Lock()
		defer cm.mu.Unlock()
		j := cm.jobs[id]
		j.record.Generation, j.record.State, j.record.LinkCancelled = 1, "failed", cancelled
		j.record.TurnGenerations = map[string]int{key: 1}
		j.record.Turns = map[string]string{key: "original input"}
		if err = cm.saveLocked(j); err != nil {
			t.Fatal(err)
		}
		return copyRecord(j.record)
	}
	failed, stopped := source("failed-repair-source", false), source("stopped-repair-source", true)
	var pending, archived, cancelled workspaceMessage
	var scope string
	func() {
		home.mu.Lock()
		defer home.mu.Unlock()
		home.manager.linkRootService.Store(cm)
		queue := func(r AgentRecord, cause, marker string) workspaceMessage {
			t.Helper()
			msg, err := home.enqueueRepairLocked(cm, r, cause, marker, marker, marker, nil)
			if err != nil {
				t.Fatal(err)
			}
			return msg
		}
		pending = queue(failed, "fixture_failure", "RECOVER-PENDING-REPAIR")
		archived = queue(failed, "another_failure", "ALREADY-ARCHIVED-REPAIR")
		cancelled = queue(stopped, "fixture_failure", "STOPPED-SOURCE-REPAIR")
		scope = home.coreLinkScopeLocked()
		archive, err := home.contextArchiveLocked()
		if err != nil {
			t.Fatal(err)
		}
		if err = archive.Append("message", Message{Role: RoleUser, Name: "core-link-" + workflowHash(archived.ID), Content: archived.Text}); err != nil {
			t.Fatal(err)
		}
		home.updateFrozen = true // Keep the committed inbox paused at the interruption boundary.
	}()
	freeze, err := h.freezeForUpdate(true)
	if err != nil || freeze.(map[string]any)["idle"] != false {
		t.Fatal("managed update did not wait for committed queued repairs", freeze, err)
	}
	h.Close()

	next, reopened := openCoreLinkHome(t, m.config, dir)
	state := func() (string, map[string]workspaceMessage) {
		reopened.mu.Lock()
		defer reopened.mu.Unlock()
		rows := map[string]workspaceMessage{}
		for _, row := range reopened.state.Messages {
			rows[row.ID] = row
		}
		return reopened.coreLinkScopeLocked(), rows
	}
	reopenedScope, before := state()
	if reopenedScope != scope || before[pending.ID].State != "interrupted" || before[archived.ID].State != "interrupted" || before[cancelled.ID].State != "interrupted" || calls.Load() != 0 {
		t.Fatal("cold reopen changed ownership or executed a queued repair", reopenedScope, before, calls.Load())
	}
	if _, err = reopened.Send("review-after-reopen", "REVIEW-RETAINED-FAILURE"); err != nil {
		t.Fatal(err)
	}
	waitCoreLink(t, "the user's new turn did not recover the original repair", func() bool {
		_, rows := state()
		return rows["review-after-reopen"].State == "completed" && rows[pending.ID].State == "completed"
	})
	_, after := state()
	delivered := after[pending.ID]
	if delivered.Generation != after["review-after-reopen"].Generation || delivered.AgentID != after["review-after-reopen"].AgentID ||
		delivered.Repair == nil || !delivered.Repair.matchesSource(failed) || after[archived.ID].State != "interrupted" ||
		after[cancelled.ID].State != "cancelled" || userCalls.Load() != 1 {
		t.Fatal("recovered receipt lost its identity or bypassed an existing boundary", delivered, after[cancelled.ID], userCalls.Load())
	}
	nextCM, err := next.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	original, err := nextCM.Status(nextCM.owner, failed.ID)
	if err != nil || original.Generation != failed.Generation || original.State != "failed" {
		t.Fatal("recovering a receipt replayed the source task", original, err)
	}
}

func TestMotherRepairSourceCommitSurvivesMissingInboxWrite(t *testing.T) {
	var calls atomic.Int32
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, req *http.Request) {
		calls.Add(1)
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		wire := string(rawJSON(body["input"]))
		missing := strings.Count(wire, "SOURCE-OUTBOX-ONLY")
		committed := strings.Count(wire, "INBOX-ALREADY-COMMITTED")
		if strings.Contains(wire, "STOPPED-BEFORE-INBOX") {
			t.Error("a receipt stopped before inbox commit entered the model request")
		}
		if strings.Contains(wire, "SOURCE-PRIVATE-TASK") {
			t.Error("automatic situation included the source's private task")
		}
		if strings.Contains(wire, "REVIEW-OTHER-SESSION") && (missing != 0 || committed != 0) ||
			strings.Contains(wire, "REVIEW-ORIGINAL-SESSION") && (missing != 1 || committed != 1) {
			t.Errorf("repair notices leaked, disappeared or were duplicated: other=%t original=%t pending=%d committed=%d", strings.Contains(wire, "REVIEW-OTHER-SESSION"), strings.Contains(wire, "REVIEW-ORIGINAL-SESSION"), missing, committed)
		}
		if strings.Contains(wire, "REVIEW-OTHER-SESSION") && (!strings.Contains(wire, "failure_code") || !strings.Contains(wire, "unclassified")) {
			t.Error("automatic situation omitted the machine-readable failure state")
		}
		fixtureAnswer(rw, "reviewed", "reviewed pending repair notices", nil)
	})
	h, home := openCoreLinkHome(t, m.config, dir)
	cm, err := h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	saveSource := func(name, marker string) AgentRecord {
		t.Helper()
		key := workspaceID()
		v, err := h.conversationCall(context.Background(), rawJSON(map[string]any{
			"action": "contact_create", "request_id": key, "name": name, "model_id": "local-model", "prompt_text": "source",
		}))
		if err != nil {
			t.Fatal(err)
		}
		id := v.(map[string]any)["id"].(string)
		cm.mu.Lock()
		job := cm.jobs[id]
		job.record.Generation = 1
		job.record.Spec.Task = "SOURCE-PRIVATE-TASK"
		job.record.TurnGenerations = map[string]int{key: 1}
		job.record.Turns = map[string]string{key: "original input"}
		cm.mu.Unlock()
		// Run the production terminal commit without the subsequent inbox callback.
		cm.finish(job, "failed", "", fmt.Errorf("%s", marker))
		record, err := cm.Status(cm.owner, id)
		if err != nil || record.MotherRepairNotice == nil || !record.MotherRepairNotice.matches(record) {
			t.Fatal("the terminal commit omitted its pending delivery", record, err)
		}
		return record
	}
	stopped := saveSource("Stopped source", "STOPPED-BEFORE-INBOX")
	if err = home.Cancel(); err != nil {
		t.Fatal(err)
	}
	missing := saveSource("Source one", "SOURCE-OUTBOX-ONLY")
	committed := saveSource("Source two", "INBOX-ALREADY-COMMITTED")
	scope := missing.MotherRepairNotice.Scope
	func() {
		home.mu.Lock()
		defer home.mu.Unlock()
		home.manager.linkRootService.Store(cm)
		if len(home.state.Messages) != 0 || committed.MotherRepairNotice.Scope != scope {
			t.Fatal("the fixture did not stop before inbox delivery")
		}
		// Also cover a crash after inbox commit and before the source acknowledgement.
		_, err := home.enqueueRepairWithStateLocked(cm, committed, committed.Failure.Code, committed.Error, "failure", "", nil, "interrupted")
		if err != nil {
			t.Fatal(err)
		}
	}()
	h.Close()
	next, reopened := openCoreLinkHome(t, m.config, dir)
	nextCM, err := next.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	notice := func(id string) *motherRepairNotice {
		t.Helper()
		r, err := nextCM.Status(nextCM.owner, id)
		if err != nil || r.Generation != 1 || r.State != "failed" {
			t.Fatal("the original source was restarted or changed", r, err)
		}
		if r.Spec.Task != "SOURCE-PRIVATE-TASK" || r.Error == "" {
			t.Fatal("recovery removed the original task or diagnostics")
		}
		return r.MotherRepairNotice
	}
	if notice(missing.ID) == nil || notice(committed.ID) == nil || notice(stopped.ID) == nil || calls.Load() != 0 {
		t.Fatal("cold open consumed a pending notice before the user spoke")
	}
	contextAction := func(action, id string) {
		t.Helper()
		ctx := context.Background()
		view, err := reopened.contextCall(ctx, rawJSON(map[string]any{"action": "view"}))
		if err != nil {
			t.Fatal(err)
		}
		_, err = reopened.contextCall(ctx, rawJSON(map[string]any{"action": action, "source": view.(map[string]any)["source"], "id": id}))
		if err != nil {
			t.Fatal(err)
		}
	}
	send := func(id, text string) {
		t.Helper()
		if _, err := reopened.Send(id, text); err != nil {
			t.Fatal(err)
		}
		waitCoreLink(t, "explicit repair review did not finish", func() bool {
			reopened.mu.Lock()
			defer reopened.mu.Unlock()
			for _, msg := range reopened.state.Messages {
				if msg.ID == id {
					return msg.State == "completed"
				}
			}
			return false
		})
	}
	contextAction("new", "")
	send("review-other", "REVIEW-OTHER-SESSION")
	if notice(missing.ID) == nil || notice(committed.ID) == nil || notice(stopped.ID) == nil {
		t.Fatal("a different home session acknowledged the notices")
	}
	contextAction("switch", scope)
	send("review-original", "REVIEW-ORIGINAL-SESSION")
	if notice(missing.ID) != nil || notice(committed.ID) != nil || notice(stopped.ID) != nil || calls.Load() != 2 {
		t.Fatal("the source acknowledgement did not follow inbox commit exactly once", calls.Load())
	}
	reopened.mu.Lock()
	defer reopened.mu.Unlock()
	delivered, cancelled := 0, 0
	for _, msg := range reopened.state.Messages {
		if msg.Repair != nil && (msg.Repair.Source == missing.ID || msg.Repair.Source == committed.ID) && msg.State == "completed" {
			delivered++
		}
		if msg.Repair != nil && msg.Repair.Source == stopped.ID && msg.State == "cancelled" {
			cancelled++
		}
	}
	if delivered != 2 || cancelled != 1 {
		t.Fatal("the repaired inbox lost the completed or cancelled source notices", delivered, cancelled)
	}
}

func TestMotherRepairDoesNotInterveneAfterUserRetriesSameGeneration(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) {})
	h, w := openCoreLinkHome(t, m.config, dir)
	created, err := h.conversationCall(context.Background(), rawJSON(map[string]any{
		"action": "contact_create", "request_id": "retry-source", "name": "Source", "model_id": "local-model", "prompt_text": "source",
	}))
	if err != nil {
		t.Fatal(err)
	}
	id := created.(map[string]any)["id"].(string)
	cm, err := h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.manager.linkRootService.Store(cm)
	cm.mu.Lock()
	source := &cm.jobs[id].record
	source.Generation, source.State = 1, "failed"
	initial := copyRecord(*source)
	cm.mu.Unlock()
	first, err := w.enqueueRepairLocked(cm, initial, "failure", "first failure", "failure", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	cm.mu.Lock()
	source.ChatRetryAttempt, source.State = 1, "running"
	cm.mu.Unlock()
	if ready, state := w.repairReadyLocked(first); ready || state != "cancelled" {
		t.Fatal("queued repair survived a retry of the same generation", ready, state)
	}
	ctx := context.WithValue(context.Background(), motherRepairTargetKey{}, first.Repair)
	if _, err := cm.sendGenerationScoped(ctx, cm.owner, id, "old-intervention", "continue", taskMessageHash("continue"), 1, nil); err == nil || !strings.Contains(err.Error(), "原任务已重试") {
		t.Fatal("stale intervention was admitted instead of returning the changed receipt", err)
	}
	cm.mu.Lock()
	source.State = "failed"
	retried := copyRecord(*source)
	cm.mu.Unlock()
	second, err := w.enqueueRepairLocked(cm, retried, "failure", "second failure", "failure", "", nil)
	if err != nil || second.ID == first.ID || second.Repair == nil || second.Repair.Attempt != 1 || second.Repair.Episode != first.Repair.Episode ||
		second.Repair.NotBefore == "" {
		t.Fatal("the retry failure did not retain its own receipt and original episode budget", second, err)
	}
	if _, ok := retried.Turns["old-intervention"]; ok {
		t.Fatal("stale intervention changed the source's turns")
	}
}

func TestMotherRepairBudgetDoesNotReplaceNormalUserBudget(t *testing.T) {
	r := AgentRecord{Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix}, Requests: 40, AccountedTokens: 100000, RepairRun: &motherRepairRun{Request: "event", RequestBase: 28, TokenBase: 50000}}
	if err := r.requestBudgetError(); err == nil || classifyAgentFailure(err, "").Code != "mother_repair_limit" {
		t.Fatal("automatic request budget was not enforced", err)
	}
	r.Requests = 30
	r.AccountedTokens = 114001
	if err := r.repairBudgetError(true); err == nil {
		t.Fatal("actual response usage escaped repair budget")
	}
	r.RepairRun = nil
	if err := r.requestBudgetError(); err != nil {
		t.Fatal("normal user turn retained the repair cap", err)
	}
	r.Spec.MaxTokens = 99999
	if err := r.requestBudgetError(); err == nil {
		t.Fatal("explicit user budget was bypassed")
	}
}

func TestMotherRepairExplicitHelpHasRuntimeBudgetAndUserCanContinue(t *testing.T) {
	var sourceCalls, automaticCalls, freshRepairCalls atomic.Int32
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, req *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(req.Body).Decode(&body)
		wire := string(rawJSON(body))
		if strings.Contains(wire, "HELP-SOURCE-PRIVATE") {
			n := sourceCalls.Add(1)
			if strings.Contains(wire, "SECOND-SOURCE-TASK") {
				rw.WriteHeader(http.StatusBadRequest)
				fmt.Fprint(rw, `{"error":{"code":"repair_fixture_fresh","message":"second repair fixture"}}`)
			} else if n == 1 {
				fixtureAnswer(rw, "help", "", []any{map[string]any{"type": "function_call", "id": "help", "call_id": "help", "name": "core_link", "arguments": `{"action":"link_help","request_id":"need-coordination","cause":"responsibility_conflict","message":"Two owners disagree about the same file; inspect their submitted receipts before changing it."}`}})
			} else {
				if !strings.Contains(wire, "event_id") {
					t.Errorf("help was rejected: %s", rawJSON(body["input"]))
				}
				fixtureAnswer(rw, "source-wait", "coordination requested; original result retained", nil)
			}
			return
		}
		if strings.Contains(wire, "REAL-USER-CONTINUE") {
			fixtureAnswer(rw, "user-continue", "continued under the user's explicit turn", nil)
			return
		}
		if strings.Contains(wire, "second repair fixture") {
			freshRepairCalls.Add(1)
			fixtureAnswer(rw, "fresh-repair", "checked the new task's failure receipt", nil)
			return
		}
		n := automaticCalls.Add(1)
		if n > 12 {
			t.Error("repair kept requesting beyond its runtime budget")
		}
		callID := fmt.Sprintf("inspect-%d", n)
		fixtureAnswer(rw, callID, "", []any{map[string]any{"type": "function_call", "id": callID, "call_id": callID, "name": "update_plan", "arguments": `{"plan":[{"step":"Inspect original responsibility receipts","status":"in_progress"}]}`}})
	})
	h, home := openCoreLinkHome(t, m.config, dir)
	v, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_create", "request_id": "help-source", "name": "Help source", "model_id": "local-model", "prompt_text": "HELP-SOURCE-PRIVATE"}))
	if err != nil {
		t.Fatal(err)
	}
	id := v.(map[string]any)["id"].(string)
	cm, _ := h.conversationManager()
	logMotherRepairFixture(t, home, cm, id)
	if _, err = h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "send", "id": id, "request_id": "source-user", "message": "Coordinate this task."})); err != nil {
		t.Fatal(err)
	}
	var actor string
	waitCoreLink(t, "automatic repair did not start", func() bool {
		home.mu.Lock()
		actor = home.state.Roles[WorkspaceMatrix]
		home.mu.Unlock()
		return actor != ""
	})
	// Await the actual completion receipt for twelve persisted tool turns.
	// The request budget below stays exact; a ten-second polling window tests
	// disk speed instead of the runtime's request limit on Windows.
	repaired, waitErr := home.manager.Wait(context.Background(), home.state.ID, actor, 25000)
	if waitErr != nil || repaired.State != "failed" || repaired.Failure == nil || repaired.Failure.Code != "mother_repair_limit" {
		t.Fatalf("automatic repair did not stop at its own budget: state=%s requests=%d failure=%+v error=%v", repaired.State, repaired.Requests, repaired.Failure, waitErr)
	}
	if automaticCalls.Load() != 12 {
		t.Fatal("unexpected automatic request count", automaticCalls.Load())
	}
	original, err := cm.Status(cm.owner, id)
	if err != nil {
		t.Fatal(err)
	}
	home.mu.Lock()
	duplicate, err := home.enqueueRepairLocked(cm, original, "no_progress", "another signal for the first task", "original-no-progress", "", nil)
	ready, terminal := home.repairReadyLocked(duplicate)
	home.mu.Unlock()
	if err != nil || ready || terminal != "blocked" {
		t.Fatal("the same failed episode was eligible for another repair", ready, terminal, err)
	}
	waitCoreLink(t, "the original episode did not settle as blocked", func() bool {
		home.mu.Lock()
		defer home.mu.Unlock()
		for _, msg := range home.state.Messages {
			if msg.ID == duplicate.ID {
				return msg.State == "blocked"
			}
		}
		return false
	})
	if _, err = h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "send", "id": id, "request_id": "second-user-task", "message": "SECOND-SOURCE-TASK"})); err != nil {
		t.Fatal(err)
	}
	waitCoreLink(t, "the earlier failed repair blocked the next independent task", func() bool {
		r, e := home.manager.Status(home.state.ID, actor)
		return e == nil && r.Generation == 2 && r.State == "completed" && r.RepairRun != nil && r.RepairRun.Request != repaired.RepairRun.Request
	})
	next, err := cm.Status(cm.owner, id)
	if err != nil || next.Generation != 2 || next.State != "failed" || repairEpisode(next) == repairEpisode(original) || freshRepairCalls.Load() != 1 {
		t.Fatal("the independent repair lost its source or repeated a model call", next.State, next.Generation, freshRepairCalls.Load(), err)
	}
	if _, err = home.Send("user-continues", "REAL-USER-CONTINUE"); err != nil {
		t.Fatal(err)
	}
	waitCoreLink(t, "explicit user continuation retained automatic limits", func() bool {
		r, e := home.manager.Status(home.state.ID, actor)
		return e == nil && r.Generation == 3 && r.State == "completed" && r.RepairRun == nil
	})
	if automaticCalls.Load() != 12 || sourceCalls.Load() != 3 || freshRepairCalls.Load() != 1 {
		t.Fatal("repair replayed the source task", automaticCalls.Load(), sourceCalls.Load())
	}
}

func TestConcurrentMotherRepairsKeepSeparateRuns(t *testing.T) {
	var calls atomic.Int32
	releaseFirst := make(chan struct{}, 1)
	defer close(releaseFirst)
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, req *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(req.Body).Decode(&body)
		wire := string(rawJSON(body))
		if strings.Contains(wire, "CONCURRENT-REPAIR-SOURCE") {
			detail := "first independent fault"
			if strings.Contains(wire, "SECOND-REPAIR-TASK") {
				detail = "second independent fault"
			}
			rw.WriteHeader(http.StatusBadRequest)
			fmt.Fprintf(rw, `{"error":{"code":"repair_fixture_fault","message":%q}}`, detail)
			return
		}
		switch calls.Add(1) {
		case 1:
			select {
			case <-releaseFirst:
			case <-req.Context().Done():
				return
			}
			fixtureAnswer(rw, "inspect", "", []any{map[string]any{"type": "function_call", "id": "inspect", "call_id": "inspect", "name": "update_plan", "arguments": `{"plan":[{"step":"Inspect the first failure","status":"in_progress"}]}`}})
		case 2:
			if strings.Contains(wire, "second independent fault") {
				t.Error("the second receipt entered the first automatic repair's model request")
			}
			rw.WriteHeader(http.StatusBadRequest)
			fmt.Fprint(rw, `{"error":{"code":"repair_fixture_error","message":"first repair failed"}}`)
		case 3:
			if !strings.Contains(wire, "second independent fault") {
				t.Error("the second repair did not receive its own failure receipt")
			}
			fixtureAnswer(rw, "second-repair", "second repair verified", nil)
		default:
			t.Error("unexpected automatic repair request")
			fixtureAnswer(rw, "extra", "unexpected", nil)
		}
	})
	h, home := openCoreLinkHome(t, m.config, dir)
	send := func(id, message string) {
		t.Helper()
		v, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_create", "request_id": id, "name": id, "model_id": "local-model", "prompt_text": "CONCURRENT-REPAIR-SOURCE"}))
		if err != nil {
			t.Fatal(err)
		}
		contact := v.(map[string]any)["id"].(string)
		if _, err = h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "send", "id": contact, "request_id": id + "-task", "message": message})); err != nil {
			t.Fatal(err)
		}
	}
	send("concurrent-first", "FIRST-REPAIR-TASK")
	waitCoreLink(t, "first repair did not reach the model", func() bool { return calls.Load() == 1 })
	send("concurrent-second", "SECOND-REPAIR-TASK")
	var second string
	waitCoreLink(t, "second repair did not queue while the first was active", func() bool {
		home.mu.Lock()
		defer home.mu.Unlock()
		for _, msg := range home.state.Messages {
			if msg.Repair != nil && msg.State == "queued" && strings.Contains(msg.Text, "second independent fault") {
				second = msg.ID
				return true
			}
		}
		return false
	})
	releaseFirst <- struct{}{}
	waitCoreLink(t, "the second receipt did not get its own repair generation", func() bool {
		home.mu.Lock()
		defer home.mu.Unlock()
		r, err := home.manager.Status(home.state.ID, home.state.Roles[WorkspaceMatrix])
		return err == nil && r.Generation == 2 && r.State == "completed" && r.RepairRun != nil && r.RepairRun.Request == second && r.RepairRun.RequestBase == 2
	})
	if calls.Load() != 3 {
		t.Fatal("the automatic repairs repeated a request", calls.Load())
	}
}

func logMotherRepairFixture(t *testing.T, home *Workspace, source *AgentManager, id string) {
	t.Helper()
	t.Cleanup(func() {
		if !t.Failed() {
			return
		}
		r, err := source.Status(source.owner, id)
		t.Logf("source state=%s generation=%d requests=%d error=%s failure=%+v read=%v", r.State, r.Generation, r.Requests, r.Error, r.Failure, err)
		home.mu.Lock()
		actor := home.state.Roles[WorkspaceMatrix]
		for _, msg := range home.state.Messages {
			t.Logf("home message id=%s from=%s state=%s error=%s repair=%+v", msg.ID, msg.From, msg.State, msg.Error, msg.Repair)
		}
		home.mu.Unlock()
		r, err = home.manager.Status(home.state.ID, actor)
		t.Logf("mother state=%s generation=%d requests=%d error=%s repair=%+v read=%v", r.State, r.Generation, r.Requests, r.Error, r.RepairRun, err)
	})
}

func TestMotherRepairWorkflowOutboxRetainsCancelledAndFailedGenerations(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("outbox inspection started a model") })
	id := "22222222222222222222222222222222"
	r := AgentRecord{ID: id, Parent: m.owner, Depth: 1, Generation: 2, State: "failed", Error: "fixture failure", History: []AgentOutcome{{Generation: 1, State: "cancelled"}}, Spec: AgentSpec{RequestID: "original", WorkflowID: "w-" + strings.Repeat("a", 32), Title: "Workflow specialist"}}
	m.jobs[id] = &agentJob{record: r}
	w := &Workspace{manager: m, config: m.config, dir: t.TempDir(), state: workspaceState{ID: m.owner, Workdir: dir, Roles: map[string]string{}}}
	m.workspace = w
	// An older version could have left a cancelled generation queued in both
	// persistent stores. Its upgrade must retire the same identity.
	legacy := workspaceMessage{ID: "workbox-result-" + id + "-1", Origin: "workbox_result", From: id, To: WorkspaceMatrix, Text: "cancelled fixture", State: "queued"}
	m.jobs[id].record.WorkflowNotice = &workboxNotice{Generation: 1, Message: legacy}
	w.state.Messages = []workspaceMessage{legacy}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.deliverWorkboxResultsLocked()
	if len(w.state.Messages) != 1 || w.state.Messages[0].State != "cancelled" {
		t.Fatal("cancelled generation rearmed the mother", w.state.Messages)
	}
	w.deliverWorkboxResultsLocked() // enqueue the next failed generation
	if len(w.state.Messages) != 2 || w.state.Messages[1].Repair == nil || w.state.Messages[1].Repair.Generation != 2 || !internalTeamNotification(w.state.Messages[1]) {
		t.Fatal("failure bypassed the repair queue", w.state.Messages)
	}
	msg := w.state.Messages[1]
	// Simulate a committed inbox but an unacknowledged source outbox.
	m.mu.Lock()
	m.jobs[id].record.WorkflowNotice = &workboxNotice{Generation: 2, Message: workspaceMessage{ID: "workbox-result-" + id + "-2", Text: msg.Text, State: "queued"}}
	m.mu.Unlock()
	w.deliverWorkboxResultsLocked()
	if len(w.state.Messages) != 2 || m.jobs[id].record.WorkflowNotice.Message.ID != msg.ID {
		t.Fatal("outbox recovery duplicated the repair")
	}
	w.state.Messages[1].State = "completed"
	w.deliverWorkboxResultsLocked()
	w.deliverWorkboxResultsLocked()
	if m.jobs[id].record.WorkflowNotified != 2 || m.jobs[id].record.WorkflowNotice != nil || len(w.state.Messages) != 2 {
		t.Fatal("repair completion did not acknowledge its original outbox")
	}
}

func TestMotherRepairPackageFailureUsesBoundedOutbox(t *testing.T) {
	var calls atomic.Int32
	_, w, m, dir, identity := packageAgentFixture(t, func(rw http.ResponseWriter, req *http.Request) {
		calls.Add(1)
		rw.WriteHeader(http.StatusBadRequest)
		fmt.Fprint(rw, `{"error":{"code":"repair_fixture","message":"fixture failure"}}`)
	})
	r := newPackageAgent(t, m, identity, "repair-package", dir)
	if _, err := m.SendGeneration(m.owner, r.ID, "user-task", "perform the fixture task", 0); err != nil {
		t.Fatal(err)
	}
	r, err := m.Wait(context.Background(), m.owner, r.ID, 10000)
	if err != nil || r.State != "failed" {
		t.Fatal(r.State, r.Error, err)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.deliverWorkboxResultsLocked()
	w.deliverWorkboxResultsLocked()
	if len(w.state.Messages) != 1 || w.state.Messages[0].Repair == nil || w.state.Messages[0].Repair.Service != "package" {
		t.Fatal("package failure bypassed repair limits", w.state.Messages)
	}
	msg := w.state.Messages[0]
	if ready, _ := w.repairReadyLocked(msg); !ready {
		t.Fatal("valid package failure lost its source authority")
	}
	if err = m.CancelGeneration(m.owner, r.ID, r.Generation); err != nil {
		t.Fatal(err)
	}
	if ready, state := w.repairReadyLocked(msg); ready || state != "cancelled" || calls.Load() != 1 {
		t.Fatal("late package stop restarted the source", ready, state, calls.Load())
	}
}

func TestMotherRepairChecksCancellationAfterNetworkSlotWait(t *testing.T) {
	var calls atomic.Int32
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { calls.Add(1) })
	h, w := openCoreLinkHome(t, m.config, dir)
	value, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "contact_create", "request_id": "slot-source", "name": "Source", "model_id": "local-model", "prompt_text": "source"}))
	if err != nil {
		t.Fatal(err)
	}
	id := value.(map[string]any)["id"].(string)
	cm, _ := h.conversationManager()
	cm.mu.Lock()
	cm.jobs[id].record.Generation, cm.jobs[id].record.State = 1, "failed"
	r := copyRecord(cm.jobs[id].record)
	cm.mu.Unlock()
	for i := 0; i < cap(w.manager.slots); i++ {
		w.manager.slots <- struct{}{}
	}
	defer func() {
		for len(w.manager.slots) > 0 {
			<-w.manager.slots
		}
	}()
	w.mu.Lock()
	w.manager.linkRootService.Store(cm)
	_, err = w.enqueueRepairLocked(cm, r, "failure", "original receipt", "slot-event", "", nil)
	w.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	var actor string
	waitCoreLink(t, "repair was not dispatched", func() bool {
		w.mu.Lock()
		actor = w.state.Roles[WorkspaceMatrix]
		w.mu.Unlock()
		return actor != ""
	})
	if err = cm.CancelGeneration(cm.owner, id, 1); err != nil {
		t.Fatal(err)
	}
	<-w.manager.slots
	r, err = w.manager.Wait(context.Background(), w.manager.owner, actor, 10000)
	if err != nil || r.State != "cancelled" || calls.Load() != 0 || r.Requests != 0 {
		t.Fatal("source stopped while queued but an automatic model call still ran", r.State, r.Error, calls.Load(), err)
	}
}

func TestMotherRepairGroupOnlyEscalatesCoordinatorFailure(t *testing.T) {
	var repairs atomic.Int32
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, req *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(req.Body).Decode(&body)
		wire := string(rawJSON(body))
		if strings.Contains(wire, "BROKEN-GROUP-PERSONA") {
			rw.WriteHeader(http.StatusBadRequest)
			fmt.Fprint(rw, `{"error":{"code":"repair_fixture","message":"group fixture failure"}}`)
			return
		}
		repairs.Add(1)
		fixtureAnswer(rw, "repair", "group coordinator failure inspected", nil)
	})
	h, w := openCoreLinkHome(t, m.config, dir)
	call := func(p map[string]any) map[string]any {
		t.Helper()
		v, err := h.conversationCall(context.Background(), rawJSON(p))
		if err != nil {
			t.Fatal(err)
		}
		return v.(map[string]any)
	}
	first := call(map[string]any{"action": "contact_create", "request_id": "host", "name": "甲", "model_id": "local-model", "prompt_text": "BROKEN-GROUP-PERSONA host"})["id"].(string)
	second := call(map[string]any{"action": "contact_create", "request_id": "member", "name": "乙", "model_id": "local-model", "prompt_text": "BROKEN-GROUP-PERSONA member"})["id"].(string)
	group := call(map[string]any{"action": "group_create", "request_id": "repair-group", "name": "Repair group", "members": []string{first, second}, "host_contact": first})["id"].(string)
	cm, _ := h.conversationManager()
	call(map[string]any{"action": "group_post", "id": group, "request_id": "ordinary-member", "text": "@乙 perform fixture task"})
	waitCoreLink(t, "ordinary group member did not finish", func() bool {
		conversationGroupsMu.Lock()
		defer conversationGroupsMu.Unlock()
		g, _ := cm.readGroup(group)
		r, _ := cm.Status(cm.owner, g.member(second).Session)
		return r.State == "failed" && g.member(second).Await == 0
	})
	if repairs.Load() != 0 {
		t.Fatal("mother took over an ordinary member from its coordinator")
	}
	call(map[string]any{"action": "group_post", "id": group, "request_id": "host-task", "text": "coordinator perform fixture task"})
	waitCoreLink(t, "coordinator failure did not reach mother", func() bool { return repairs.Load() == 1 })
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.state.Messages) == 0 {
		t.Fatal("group repair had no persistent receipt")
	}
	for _, msg := range w.state.Messages {
		if msg.Repair != nil {
			r, _ := cm.Status(cm.owner, msg.Repair.Source)
			if r.Spec.GroupID != group || conversationPromptID(r) != first {
				t.Fatal("wrong group instance escalated", r.Spec)
			}
		}
	}
}
