// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: contractFixture; TestMatrixContractAcceptanceRequiresIndependentFreshEvidenceAndUnchangedArtifacts; TestMatrixReworkPreservesOriginalContractDeliveryAndReviewHistory; TestMatrixDeliveryMissingFileAndEscapingLinkAreNotCollected
// Impact: python -B scripts/code-atlas.py show Core/matrix_contract_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func contractFixture(t *testing.T) (*AgentManager, string, string) {
	t.Helper()
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body any
		_ = json.NewDecoder(r.Body).Decode(&body)
		b, _ := json.Marshal(body)
		if !strings.Contains(string(b), "Keep exact values") {
			t.Error("original contract not in next request")
		}
		fixtureAnswer(w, "continued", "DELIVERED", nil)
	})
	id := "11111111111111111111111111111111"
	if err := os.WriteFile(filepath.Join(dir, "result.txt"), []byte("exact value"), 0600); err != nil {
		t.Fatal(err)
	}
	spec := AgentSpec{RequestID: "initial", ModelID: "local-model", Task: "Keep exact values", Workdir: dir, MaxRequests: 5, TimeoutSeconds: 10, MaxTokens: 100000, Contract: &AgentContract{Acceptance: []string{"Keep exact values"}, Deliverables: []string{"result.txt"}, Constraints: []string{"do not weaken validation"}}}
	done := make(chan struct{})
	close(done)
	m.jobs[id] = &agentJob{record: AgentRecord{ID: id, Parent: testMatrixOwner, Depth: 1, State: "completed", Spec: spec, Generation: 1, Delivery: collectAgentDelivery(spec, 1), Turns: map[string]string{"initial": spec.Task}}, done: done}
	if err := m.saveLocked(m.jobs[id]); err != nil {
		t.Fatal(err)
	}
	return m, id, dir
}

func TestMatrixContractAcceptanceRequiresIndependentFreshEvidenceAndUnchangedArtifacts(t *testing.T) {
	m, id, dir := contractFixture(t)
	parentPath, _ := SessionPath(m.config, testMatrixOwner)
	shell, err := NewShellManager(dir, strings.TrimSuffix(parentPath, filepath.Ext(parentPath))+".shell")
	if err != nil {
		t.Fatal(err)
	}
	defer shell.Close()
	command := "Get-Content result.txt"
	if runtime.GOOS != "windows" {
		command = "cat result.txt"
	}
	result := shell.Execute(context.Background(), executionCall("exec_command", map[string]any{"cmd": command, "yield_time_ms": 30000}))
	if result.ExitCode == nil || *result.ExitCode != 0 || !strings.Contains(result.Output, "exact value") {
		t.Fatal(result)
	}
	base := AgentReview{RequestID: "review-1", Generation: 1, Verdict: "accepted", Evidence: "Read actual artifact independently", Checks: []AgentCriterionCheck{{Criterion: 0, Verdict: "passed", Evidence: "stdout contains exact value", Receipts: []AgentReceiptRef{{SessionID: result.SessionID}}}}}
	testBad := func(name string, change func(*AgentReview)) {
		t.Helper()
		b, _ := json.Marshal(base)
		var bad AgentReview
		_ = json.Unmarshal(b, &bad)
		change(&bad)
		if _, e := m.ReviewWithChecks(testMatrixOwner, id, bad); e == nil {
			t.Errorf("accepted %s", name)
		}
	}
	testBad("missing checks", func(r *AgentReview) { r.Checks = nil })
	testBad("stale generation", func(r *AgentReview) { r.Generation = 0 })
	testBad("self review", func(r *AgentReview) { r.Checks[0].Receipts[0].AgentID = id })
	testBad("foreign reviewer", func(r *AgentReview) { r.Checks[0].Receipts[0].AgentID = "22222222222222222222222222222222" })
	testBad("invented receipt", func(r *AgentReview) { r.Checks[0].Receipts[0].SessionID = 99999 })
	testBad("wrong exit", func(r *AgentReview) { r.Checks[0].Receipts[0].ExpectedExit = 1 })
	testBad("unknown result", func(r *AgentReview) { r.Checks[0].Verdict = "unknown" })
	testBad("duplicate criterion", func(r *AgentReview) { r.Checks = append(r.Checks, r.Checks[0]) })
	_ = os.WriteFile(filepath.Join(dir, "result.txt"), []byte("changed"), 0600)
	testBad("changed artifact", func(*AgentReview) {})
	_ = os.WriteFile(filepath.Join(dir, "result.txt"), []byte("exact value"), 0600)
	r, err := m.ReviewWithChecks(testMatrixOwner, id, base)
	if err != nil {
		t.Fatal(err)
	}
	if r.Acceptance != "accepted" || len(r.Reviews) != 1 {
		t.Fatal(r)
	}
	r, err = m.ReviewWithChecks(testMatrixOwner, id, base)
	if err != nil || len(r.Reviews) != 1 {
		t.Fatal("retry duplicated review", err)
	}
	base.Checks[0].Evidence = "caller changed"
	stored, _ := m.Status(testMatrixOwner, id)
	if stored.Reviews[0].Checks[0].Evidence == base.Checks[0].Evidence {
		t.Fatal("caller slice was retained")
	}
	if _, err = m.ReviewWithChecks(testMatrixOwner, id, base); err == nil {
		t.Fatal("conflicting review request accepted")
	}
	// A new captured delivery invalidates an older successful process receipt.
	m.jobs[id].record.Delivery.CapturedAt = time.Now().Add(time.Second).UTC().Format(time.RFC3339Nano)
	base.RequestID = "new-check"
	if _, err = m.ReviewWithChecks(testMatrixOwner, id, base); err == nil {
		t.Fatal("stale verification accepted")
	}
}

func TestMatrixReworkPreservesOriginalContractDeliveryAndReviewHistory(t *testing.T) {
	m, id, _ := contractFixture(t)
	_, err := m.ReviewWithChecks(testMatrixOwner, id, AgentReview{RequestID: "rework", Generation: 1, Verdict: "rework", Evidence: "Keep the counterexample, correct the boundary"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.Send(testMatrixOwner, id, "next", "Recheck unchanged exact values"); err != nil {
		t.Fatal(err)
	}
	r, err := m.Wait(context.Background(), testMatrixOwner, id, 10000)
	if err != nil || r.State != "completed" {
		t.Fatalf("%+v %v", r, err)
	}
	if len(r.History) != 1 || r.History[0].Evidence == "" || r.History[0].Delivery == nil || len(r.Reviews) != 1 || r.Generation != 2 || r.Acceptance != "pending" || r.Spec.Contract.Acceptance[0] != "Keep exact values" {
		t.Fatal(r)
	}
	m.Close()
	restored, err := NewAgentManager(m.config, testMatrixOwner, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	r, err = restored.Status(testMatrixOwner, id)
	if err != nil || len(r.Reviews) != 1 || len(r.History) != 1 {
		t.Fatal("recovery lost history", err)
	}
}

func TestMatrixDeliveryMissingFileAndEscapingLinkAreNotCollected(t *testing.T) {
	dir, outside := t.TempDir(), t.TempDir()
	spec := AgentSpec{Workdir: dir, Contract: &AgentContract{Acceptance: []string{"x"}, Deliverables: []string{"missing"}}}
	if d := collectAgentDelivery(spec, 1); d.Artifacts[0].Error == "" {
		t.Fatal("missing file passed")
	}
	_ = os.WriteFile(filepath.Join(outside, "secret"), []byte("outside"), 0600)
	if err := os.Symlink(filepath.Join(outside, "secret"), filepath.Join(dir, "link")); err != nil {
		t.Skip("OS symlink privilege unavailable")
	}
	spec.Contract.Deliverables = []string{"link"}
	if d := collectAgentDelivery(spec, 1); d.Artifacts[0].SHA256 != "" || d.Artifacts[0].Error == "" {
		t.Fatal("outside link read", d)
	}
}
