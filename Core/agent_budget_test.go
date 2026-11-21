// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestInteractiveBudgetDistinctFromExplicitTaskLimit; TestBudgetTokenFailurePreservesPlanAndExplicitChildLimit; TestBudgetWorkspaceTokenFailureRequiresExplicitNewTurn; TestBudgetRejectedResponseRetainedWithoutToolExecution
// Impact: python -B scripts/code-atlas.py show Core/agent_budget_test.go
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
	"sync/atomic"
	"testing"
	"time"
)

func TestInteractiveBudgetDistinctFromExplicitTaskLimit(t *testing.T) {
	r := AgentRecord{Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix, MaxRequests: 96}, Requests: 27, AccountedTokens: 1006735}
	if err := r.requestBudgetError(); err != nil {
		t.Fatal(err)
	}
	r.Spec.MaxTokens = 1000000
	if !r.tokenBudgetReached(true) {
		t.Fatal("explicit token limit bypassed")
	}
	r.Spec.MaxTokens = 0
	for _, requests := range []int{96, 128, 100000} {
		r.Requests = requests
		if err := r.requestBudgetError(); err != nil {
			t.Fatal("legacy request count stopped work", requests, err)
		}
	}
}

func TestBudgetTokenFailurePreservesPlanAndExplicitChildLimit(t *testing.T) {
	var requests atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 1 {
			fixtureAnswer(w, "plan-before-budget", "", []any{map[string]any{"type": "function_call", "id": "fc_plan", "call_id": "plan", "name": "update_plan", "arguments": `{"summary":"保留原任务","plan":[{"id":"check","description":"核实实际结果","status":"in_progress"}]}`}})
			return
		}
		fixtureAnswer(w, "explicit-new-turn", "用户明确的新请求已处理", nil)
	})
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "budget-plan", ModelID: "local-model", Task: "create plan and continue", Workdir: dir, Tools: []string{"update_plan"}, MaxTokens: 100})
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "failed" || r.Requests != 1 || !strings.Contains(r.Error, "token budget") {
		t.Fatalf("%+v %v", r, err)
	}
	archive, restored, err := RestoreSession(filepath.Join(m.dir, "config.json"), r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Plan.State == nil || restored.Plan.State.Status != "active" || len(restored.Plan.Receipts) != 1 {
		t.Fatal("budget lost or falsely completed plan")
	}
	archive.Close()
	m.Close()
	next, err := NewAgentManager(m.config, testMatrixOwner, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer next.Close()
	current, err := next.Status(testMatrixOwner, r.ID)
	if err != nil || current.State != "failed" || requests.Load() != 1 {
		t.Fatal("restart resumed failed task", current, err)
	}
	if _, err = next.SendGeneration(testMatrixOwner, r.ID, "explicit-request", "Handle this new request only.", r.Generation); err != nil {
		t.Fatal(err)
	}
	current, err = next.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || current.State != "failed" || current.Generation != 2 || current.Requests != 1 || requests.Load() != 1 {
		t.Fatalf("explicit child budget changed: %+v %v", current, err)
	}
}

func TestBudgetWorkspaceTokenFailureRequiresExplicitNewTurn(t *testing.T) {
	var requests atomic.Int32
	w, dir := testWorkspace(t, func(res http.ResponseWriter, req *http.Request) {
		if requests.Add(1) == 1 {
			fixtureAnswer(res, "budget-plan", "", []any{map[string]any{"type": "function_call", "id": "fc_p", "call_id": "p", "name": "update_plan", "arguments": `{"summary":"核对结果","plan":[{"id":"check","description":"核对结果","status":"in_progress"}]}`}})
			return
		}
		fixtureAnswer(res, "new-request", "用户明确的新请求已处理", nil)
	})
	ctx := context.WithValue(context.Background(), workspaceTrustedKey{}, true)
	r, err := w.manager.Create(ctx, w.state.ID, AgentSpec{WorkspaceRole: WorkspaceMatrix, RequestID: "budget", ModelID: "local-model", Task: "create a plan", Workdir: dir, MaxTokens: 100})
	if err != nil {
		t.Fatal(err)
	}
	r, err = w.manager.Wait(ctx, w.state.ID, r.ID, 10000)
	if err != nil || r.State != "failed" || r.Requests != 1 {
		t.Fatal(r.State, err)
	}
	w.Close()
	next, err := NewWorkspace(w.config, w.state.ID, dir, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer next.Close()
	current, err := next.manager.Status(next.state.ID, r.ID)
	if err != nil || current.State != "failed" || requests.Load() != 1 {
		t.Fatal("restart resumed failed task", err)
	}
	if _, err = next.Send("explicit-new", "Handle this new request only."); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		current, err = next.manager.Status(next.state.ID, r.ID)
		if err != nil {
			t.Fatal(err)
		}
		if current.Generation == 2 && !activeAgent(current.State) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if current.State != "completed" || current.Generation != 2 || current.Requests != 2 || current.TurnRequestBase != 1 || requests.Load() != 2 {
		t.Fatalf("explicit interactive turn: %+v", current)
	}
}

func TestBudgetRejectedResponseRetainedWithoutToolExecution(t *testing.T) {
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		fixtureAnswer(w, "retained", "", []any{
			map[string]any{"type": "message", "id": "saved", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": "RESULT_RETAINED"}}},
			map[string]any{"type": "function_call", "id": "fc_b", "call_id": "call_b", "name": "apply_patch", "arguments": `{"patch":"*** Begin Patch\n*** Add File: forbidden.txt\n+bad\n*** End Patch"}`},
		})
	})
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "retained", ModelID: "local-model", Task: "preserve response", Workdir: dir, Tools: []string{"apply_patch"}, MaxTokens: 10})
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "failed" || r.Result != "RESULT_RETAINED" || r.AccountedTokens != 100 {
		t.Fatalf("%+v %v", r, err)
	}
	if _, err = os.Stat(filepath.Join(dir, "forbidden.txt")); !os.IsNotExist(err) {
		t.Fatal("rejected tool dispatched")
	}
	path, _ := SessionPath(filepath.Join(m.dir, "config.json"), r.ID)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "unexecuted_response") || !strings.Contains(string(data), "RESULT_RETAINED") {
		t.Fatal("lost response evidence")
	}
	archive, restored, err := RestoreSession(filepath.Join(m.dir, "config.json"), r.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	for _, msg := range restored.Messages {
		b, _ := json.Marshal(msg)
		if strings.Contains(string(b), "call_b") {
			t.Fatal("rejected tools replayable")
		}
	}
}
