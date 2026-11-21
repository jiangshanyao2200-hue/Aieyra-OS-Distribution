// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkflowEvidenceCurrentVersionsAndDurableDelivery; TestWorkflowRejectsOldReceiptEscapeCASAndCorruption; TestWorkflowRealShellReceiptAndPostInterruptionReconciliation; TestWorkflowSeesDurableEarlierReceiptWithinSameToolTurn; TestWorkflowVisibleOmitsInternalReceiptMembershipWithoutChangingArchive; TestWorkflowReceiptRefsPreserveEvidenceGuards
// Impact: python -B scripts/code-atlas.py show Core/workspace_workflow_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWorkflowEvidenceCurrentVersionsAndDurableDelivery(t *testing.T) {
	w, dir := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("no model") })
	os.WriteFile(filepath.Join(dir, "work.go"), []byte("package sample\n"), 0600)
	plan := &PlanEngine{Receipts: map[string]ToolReceipt{}}
	u, _ := ParsePlanUpdate(`{"action":"create","objective":"implement and check","acceptance":["source validated"],"steps":[{"id":"check","text":"check current source"}]}`)
	u, _ = plan.adaptUpdate(u)
	created, err := ApplyPlanUpdate(nil, u)
	if err != nil {
		t.Fatal(err)
	}
	finished, err := ApplyPlanUpdate(created.State, PlanUpdate{Action: "complete", PlanID: created.State.ID, ExpectedRevision: 1, Changes: []PlanOperation{{Op: "set_status", StepID: "check", Status: PlanCompleted, Reason: "actual check", Evidence: []string{"source checked"}}}, Completion: []AcceptanceResult{{Criterion: "source validated", Evidence: []string{"source checked"}}}})
	if err != nil {
		t.Fatal(err)
	}
	plan.State = finished.State
	if e := w.syncWorkflow(plan, "agent", 1); e != nil {
		t.Fatal(e)
	}
	ctx := context.WithValue(context.Background(), workflowContextKey{}, workflowContext{plan, "agent", 1})
	state := func() WorkflowState {
		t.Helper()
		w.mu.Lock()
		defer w.mu.Unlock()
		s, e := w.loadWorkflowLocked()
		if e != nil {
			t.Fatal(e)
		}
		return s
	}
	call := func(p map[string]any) (any, error) {
		p["expected_version"] = state().Revision
		return w.workflow(ctx, rawJSON(p))
	}
	if _, e := call(map[string]any{"action": "workflow_capture", "label": "current source", "paths": []string{"work.go"}}); e != nil {
		t.Fatal(e)
	}
	capture := state().Captures[0]
	zero := 0
	receipt := func(ok bool) ToolReceipt {
		return ToolReceipt{Key: "check", ToolName: "exec_command", Output: string(rawJSON(ShellResult{OK: ok, State: "exited", ExitCode: &zero, StartedAt: time.Now().UTC()}))}
	}
	plan.Receipts["check"] = receipt(false)
	if _, e := call(map[string]any{"action": "workflow_evidence", "id": capture.ID, "receipt_key": "check"}); e == nil {
		t.Fatal("failed check accepted")
	}
	plan.Receipts["check"] = receipt(true)
	if _, e := call(map[string]any{"action": "workflow_evidence", "id": capture.ID, "receipt_key": "check"}); e != nil {
		t.Fatal(e)
	}
	evidence := state().Evidence[0]
	if _, e := call(map[string]any{"action": "workflow_deliver", "verdict": "complete", "summary": "source validated", "evidence_ids": []string{evidence.ID}}); e != nil {
		t.Fatal(e)
	}
	if msg, e := w.workflowBoundary(ctx, "agent", 1); e != nil || msg != "" {
		t.Fatal(msg, e)
	}
	if e := w.syncWorkflow(plan, "agent", 1); e != nil {
		t.Fatal(e)
	}
	if state().Delivery == nil {
		t.Fatal("unchanged plan erased delivery")
	}
	projection := filepath.Join(w.dir, "execution-plan.md")
	os.Remove(projection)
	if _, e := w.workflow(ctx, rawJSON(map[string]any{"action": "workflow_status"})); e != nil {
		t.Fatal(e)
	}
	if b, e := os.ReadFile(projection); e != nil || !strings.Contains(string(b), "source validated") {
		t.Fatal(string(b), e)
	}
	os.WriteFile(filepath.Join(dir, "work.go"), []byte("package changed\n"), 0600)
	if msg, e := w.workflowBoundary(ctx, "agent", 1); e != nil || !strings.Contains(msg, "stale") {
		t.Fatal(msg, e)
	}
	if _, e := call(map[string]any{"action": "workflow_deliver", "verdict": "complete", "summary": "cannot reuse stale", "evidence_ids": []string{evidence.ID}}); e == nil {
		t.Fatal("stale evidence accepted")
	}
	if _, e := call(map[string]any{"action": "workflow_deliver", "verdict": "partial", "summary": "needs retest", "unresolved": []string{"retest changed file"}}); e != nil {
		t.Fatal(e)
	}
	if msg, e := w.workflowBoundary(ctx, "agent", 1); e != nil || msg != "" {
		t.Fatal(msg, e)
	}
}

func TestWorkflowRejectsOldReceiptEscapeCASAndCorruption(t *testing.T) {
	w, dir := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("no model") })
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("fixture"), 0600)
	plan := &PlanEngine{Receipts: map[string]ToolReceipt{"old": {Key: "old", ToolName: "exec_command", Output: `{"ok":true,"state":"exited","exit_code":0}`}}}
	ctx := context.WithValue(context.Background(), workflowContextKey{}, workflowContext{plan, "a", 1})
	for _, paths := range [][]string{{"../secret"}, {"config.json"}, {"a.txt", "a.txt"}} {
		if _, e := w.workflow(ctx, rawJSON(map[string]any{"action": "workflow_capture", "label": "invalid", "paths": paths, "expected_version": 0})); e == nil {
			t.Fatal(paths)
		}
	}
	out, e := w.workflow(ctx, rawJSON(map[string]any{"action": "workflow_capture", "label": "pin", "paths": []string{"a.txt"}, "expected_version": 0}))
	if e != nil {
		t.Fatal(e)
	}
	s := out.(map[string]any)["state"].(WorkflowState)
	if _, e := w.workflow(ctx, rawJSON(map[string]any{"action": "workflow_capture", "label": "stale", "paths": []string{"a.txt"}, "expected_version": 0})); e == nil {
		t.Fatal("CAS bypass")
	}
	if _, e := w.workflow(ctx, rawJSON(map[string]any{"action": "workflow_evidence", "id": s.Captures[0].ID, "receipt_key": "old", "expected_version": s.Revision})); e == nil {
		t.Fatal("old receipt accepted")
	}
	plan.Receipts["unknown"] = ToolReceipt{Output: `{"state":"interrupted_unknown"}`}
	if e = w.syncWorkflow(plan, "a", 1); e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(w.workflowNotice(), "=1.") {
		t.Fatal(w.workflowNotice())
	}
	b, _ := json.Marshal(map[string]any{"version": 99})
	os.WriteFile(filepath.Join(w.dir, "workflow.json"), b, 0600)
	if _, e := w.workflow(ctx, rawJSON(map[string]any{"action": "workflow_status"})); e == nil {
		t.Fatal("corruption hidden")
	}
}

func TestWorkflowRealShellReceiptAndPostInterruptionReconciliation(t *testing.T) {
	w, dir := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("no model") })
	os.WriteFile(filepath.Join(dir, "checked.txt"), []byte("artifact"), 0600)
	plan := &PlanEngine{Receipts: map[string]ToolReceipt{}}
	ctx := context.WithValue(context.Background(), workflowContextKey{}, workflowContext{plan, "agent", 1})
	state := func() WorkflowState {
		w.mu.Lock()
		defer w.mu.Unlock()
		s, e := w.loadWorkflowLocked()
		if e != nil {
			t.Fatal(e)
		}
		return s
	}
	call := func(p map[string]any) error {
		p["expected_version"] = state().Revision
		_, e := w.workflow(ctx, rawJSON(p))
		return e
	}
	check := func(key string) string {
		t.Helper()
		if e := call(map[string]any{"action": "workflow_capture", "label": "actual shell check", "paths": []string{"checked.txt"}}); e != nil {
			t.Fatal(e)
		}
		captures := state().Captures
		id := captures[len(captures)-1].ID
		manager := shellTestManager(t)
		result := shellDone(t, manager, manager.start(ctx, ShellCommand{Cmd: "exit 0"}))
		if result.State != "exited" || result.ExitCode == nil || *result.ExitCode != 0 {
			t.Fatal(result)
		}
		plan.Receipts[key] = ToolReceipt{Key: key, ToolName: "exec_command", Output: string(rawJSON(result))}
		if e := call(map[string]any{"action": "workflow_evidence", "id": id, "receipt_key": key}); e != nil {
			t.Fatal(e)
		}
		evidence := state().Evidence
		return evidence[len(evidence)-1].ID
	}
	old := check("before-interruption")
	plan.Receipts["unknown"] = ToolReceipt{Key: "unknown", ToolName: "exec_command", Output: `{"state":"interrupted_unknown"}`}
	if e := w.syncWorkflow(plan, "agent", 1); e != nil {
		t.Fatal(e)
	}
	summary := "The original operation was interrupted; checked the original artifact and observed it unchanged. External effects remain outside this local evidence."
	if e := call(map[string]any{"action": "workflow_reconcile", "receipt_key": "unknown", "id": old, "summary": summary}); e == nil {
		t.Fatal("pre-discovery evidence accepted")
	}
	newEvidence := check("after-interruption")
	if e := call(map[string]any{"action": "workflow_reconcile", "receipt_key": "unknown", "id": newEvidence, "summary": "done"}); e == nil {
		t.Fatal("empty investigation accepted")
	}
	if e := call(map[string]any{"action": "workflow_reconcile", "receipt_key": "unknown", "id": newEvidence, "summary": summary}); e != nil {
		t.Fatal(e)
	}
	if state().Reconciliation["unknown"] != summary || !strings.Contains(plan.Receipts["unknown"].Output, "interrupted_unknown") {
		t.Fatal("original receipt or investigation lost")
	}
}

func TestWorkflowSeesDurableEarlierReceiptWithinSameToolTurn(t *testing.T) {
	w, dir := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("no model") })
	if err := os.WriteFile(filepath.Join(dir, "checked.txt"), []byte("artifact"), 0600); err != nil {
		t.Fatal(err)
	}
	plan := &PlanEngine{Receipts: map[string]ToolReceipt{}}
	ctx := context.WithValue(context.Background(), workflowContextKey{}, workflowContext{plan, "agent", 1})
	ctx = context.WithValue(ctx, workspaceContextKey{}, workspaceContext{w, WorkspaceMatrix})
	out, err := w.workflow(ctx, rawJSON(map[string]any{"action": "workflow_capture", "label": "before actual check", "paths": []string{"checked.txt"}, "expected_version": 0}))
	if err != nil {
		t.Fatal(err)
	}
	state := out.(map[string]any)["state"].(WorkflowState)
	yield := 10000
	response := Message{Role: RoleAssistant, ToolCalls: []ToolCall{
		{ID: "check", Function: FunctionCall{Name: "exec_command", Arguments: string(rawJSON(ShellCommand{Cmd: "exit 0", YieldTimeMS: &yield}))}},
		{ID: "evidence", Function: FunctionCall{Name: "workspace", Arguments: string(rawJSON(map[string]any{"action": "workflow_evidence", "id": state.Captures[0].ID, "receipt_key": "batch:check", "expected_version": state.Revision}))}},
	}}
	persisted := map[string]bool{}
	turn, err := ExecuteToolTurn(ctx, plan, shellTestManager(t), response, "batch", func(kind string, value any) error {
		if kind == "tool_progress" {
			persisted[value.(ToolReceipt).Key] = true
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		OK bool `json:"ok"`
	}
	if err = json.Unmarshal([]byte(turn.Receipts[1].Output), &result); err != nil || !result.OK || !persisted["batch:check"] {
		t.Fatal(turn.Receipts, err)
	}
	var check map[string]any
	if err = json.Unmarshal([]byte(turn.Receipts[0].Output), &check); err != nil || check["receipt_key"] != "batch:check" {
		t.Fatal("durable check identity not returned", check, err)
	}
}

func TestWorkflowVisibleOmitsInternalReceiptMembershipWithoutChangingArchive(t *testing.T) {
	original := WorkflowState{Revision: 4, Captures: []WorkflowCapture{{ID: "capture", PriorReceipts: []string{"original:receipt"}}}}
	visible := workflowVisible(original)
	if visible.Revision != original.Revision || len(visible.Captures) != 1 || len(visible.Captures[0].PriorReceipts) != 0 || len(original.Captures[0].PriorReceipts) != 1 {
		t.Fatal("projection changed authoritative receipt guard", original, visible)
	}
}

func TestWorkflowReceiptRefsPreserveEvidenceGuards(t *testing.T) {
	w, dir := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("no model") })
	if err := os.WriteFile(filepath.Join(dir, "artifact.txt"), []byte("verified bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	zero := 0
	result := ShellResult{OK: true, State: "exited", ExitCode: &zero, StartedAt: time.Now().Add(-time.Minute)}
	plan := &PlanEngine{Receipts: map[string]ToolReceipt{"old:call": {Key: "old:call", ToolName: "exec_command", Output: string(rawJSON(result))}}}
	ctx := context.WithValue(context.Background(), workflowContextKey{}, workflowContext{plan, "agent", 1})
	out, err := w.workflow(ctx, rawJSON(map[string]any{"action": "workflow_capture", "label": "current artifact", "paths": []string{"artifact.txt"}, "expected_version": 0}))
	if err != nil {
		t.Fatal(err)
	}
	s := out.(map[string]any)["state"].(WorkflowState)
	capture := s.Captures[0]
	result.StartedAt = time.Now()
	const key = "chatcmpl-a-very-long-provider-id:call_actual-verification"
	plan.Receipts[key] = ToolReceipt{Key: key, ToolName: "exec_command", Output: string(rawJSON(result))}
	status, err := w.workflow(ctx, rawJSON(map[string]any{"action": "workflow_status"}))
	if err != nil {
		t.Fatal(err)
	}
	for _, receipt := range status.(map[string]any)["receipts"].([]map[string]any) {
		eligible := receipt["eligible_captures"].([]string)
		if receipt["key"] == key && (len(eligible) != 1 || eligible[0] != capture.ID) || receipt["key"] == "old:call" && len(eligible) != 0 {
			t.Fatal("incorrect receipt eligibility", receipt)
		}
	}
	for _, bad := range []string{workflowReceiptRef("old:call"), workflowReceiptRef(key)[:10], "r-unknown"} {
		if _, err := w.workflow(ctx, rawJSON(map[string]any{"action": "workflow_evidence", "id": capture.ID, "receipt_key": bad, "expected_version": s.Revision})); err == nil {
			t.Fatal("invalid or pre-capture alias accepted", bad)
		}
	}
	out, err = w.workflow(ctx, rawJSON(map[string]any{"action": "workflow_evidence", "id": capture.ID, "receipt_key": workflowReceiptRef(key), "expected_version": s.Revision}))
	if err != nil {
		t.Fatal(err)
	}
	s = out.(map[string]any)["state"].(WorkflowState)
	if len(s.Evidence) != 1 || s.Evidence[0].Receipt != key {
		t.Fatal("alias replaced authoritative receipt", s.Evidence)
	}
	if err := os.WriteFile(filepath.Join(dir, "artifact.txt"), []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := w.workflow(ctx, rawJSON(map[string]any{"action": "workflow_evidence", "id": capture.ID, "receipt_key": workflowReceiptRef(key), "expected_version": s.Revision})); err == nil {
		t.Fatal("alias bypassed changed-file guard")
	}
}
