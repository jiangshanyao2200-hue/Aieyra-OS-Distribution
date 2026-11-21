// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: humanTestQuestion; humanToolAnswer; waitingHuman; humanTestReply; TestHumanSameGenerationArchiveAndDuplicateDecision; TestHumanRejectsOldBindingsOptionsAndModelReply; TestHumanFreeAnswerKeepsQuestionBindingAndIdempotency; TestHumanWaitingSurvivesRestartWithoutPolling; TestHumanCancelledExpiredAndDecisionCrashNeverReplay; TestHumanRejectsBatchedRequestAndUnknownHostFields
// Impact: python -B scripts/code-atlas.py show Core/matrix_human_test.go
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
	"time"
)

func humanTestQuestion() HumanQuestion {
	return HumanQuestion{Action: "request", RequestID: "output-direction", Category: "direction", Question: "Choose the report format", Recommendation: "Use plain text for easy review", Facts: "Source checks are finished", Impact: "Only report format changes", ResumeSummary: "Write the report using the selected format", Options: []HumanOption{{ID: "plain", Label: "Plain text", Impact: "Readable without a browser"}, {ID: "json", Label: "JSON", Impact: "Machine-readable"}}}
}
func humanToolAnswer(w http.ResponseWriter, n int, action string, args any) {
	b, _ := json.Marshal(map[string]any{"action": action, "name": "human", "arguments": args})
	fixtureAnswer(w, fmt.Sprint("human", n), "", []any{map[string]any{"type": "function_call", "id": fmt.Sprint("fc_", n), "call_id": fmt.Sprint("call_", n), "name": "toolbox", "arguments": string(b)}})
}
func waitingHuman(t *testing.T) (*AgentManager, AgentRecord, *atomic.Int32) {
	t.Helper()
	requests := &atomic.Int32{}
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		n := int(requests.Add(1))
		switch n {
		case 1:
			humanToolAnswer(w, n, "open", nil)
		case 2:
			humanToolAnswer(w, n, "call", humanTestQuestion())
		default:
			var body any
			_ = json.NewDecoder(r.Body).Decode(&body)
			b, _ := json.Marshal(body)
			if !strings.Contains(string(b), "human_request_id") || !strings.Contains(string(b), "decision-1") || !strings.Contains(string(b), "function_call_output") {
				t.Error("original archive or decision missing")
			}
			fixtureAnswer(w, "final", "Report delivered after the recorded decision", nil)
		}
	})
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "needs-human", ModelID: "local-model", Task: "produce report", Prompt: "fixture", Workdir: dir, Tools: []string{"human"}, MaxRequests: 6})
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "waiting_user" || r.Requests != 2 || r.ToolTurns != 2 || len(r.HumanRequests) != 1 || r.HumanRequests[0].State != "waiting_user" {
		t.Fatalf("pause: %+v %v", r, err)
	}
	if len(m.slots) != 0 {
		t.Fatal("human waiting occupied model network slot")
	}
	return m, r, requests
}
func humanTestReply(r AgentRecord) HumanReply {
	h := r.HumanRequests[0]
	return HumanReply{RequestID: "decision-1", SessionID: testMatrixOwner, AgentID: r.ID, Generation: r.Generation, HumanID: h.ID, ExpectedRequestVersion: h.Version, RequestTokenSHA256: h.RequestTokenSHA256, Decision: HumanDecision{OptionID: "plain"}}
}

func TestHumanSameGenerationArchiveAndDuplicateDecision(t *testing.T) {
	m, r, requests := waitingHuman(t)
	if _, err := m.Send(testMatrixOwner, r.ID, "bypass", "continue without decision"); err == nil {
		t.Fatal("send bypassed pending human")
	}
	p := humanTestReply(r)
	h, err := m.ReplyHuman(testMatrixOwner, p)
	if err != nil || h.State != "decision_recorded" {
		t.Fatal(h, err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "completed" || r.Generation != 1 || r.Acceptance != "pending" || r.HumanRequests[0].State != "resolved" || requests.Load() != 3 {
		t.Fatalf("resume: %+v %v", r, err)
	}
	if _, err = m.ReplyHuman(testMatrixOwner, p); err != nil || requests.Load() != 3 {
		t.Fatal("duplicate replay", err)
	}
	p.Decision.OptionID = "json"
	if _, err = m.ReplyHuman(testMatrixOwner, p); err == nil {
		t.Fatal("conflicting duplicate accepted")
	}
	all, _ := m.Humans("unrelated-owner")
	if len(all) != 0 {
		t.Fatal("human request leaked across owner")
	}
}

func TestHumanRejectsOldBindingsOptionsAndModelReply(t *testing.T) {
	m, r, requests := waitingHuman(t)
	for name, change := range map[string]func(*HumanReply){
		"session":    func(p *HumanReply) { p.SessionID = "other" },
		"agent":      func(p *HumanReply) { p.AgentID = "other" },
		"generation": func(p *HumanReply) { p.Generation++ },
		"request":    func(p *HumanReply) { p.HumanID = "other" },
		"version":    func(p *HumanReply) { p.ExpectedRequestVersion++ },
		"token":      func(p *HumanReply) { p.RequestTokenSHA256 = "wrong" },
		"choice":     func(p *HumanReply) { p.Decision.OptionID = "unlisted" },
	} {
		t.Run(name, func(t *testing.T) {
			p := humanTestReply(r)
			change(&p)
			if _, err := m.ReplyHuman(testMatrixOwner, p); err == nil {
				t.Fatal("invalid binding accepted")
			}
		})
	}
	ctx := WithAgentManager(context.Background(), m, r.ID, nil)
	ctx = WithToolPermissions(ctx, []string{"human"})
	state := &ToolboxState{Open: map[string]bool{"human": true}}
	b, _ := json.Marshal(map[string]any{"action": "call", "name": "human", "arguments": map[string]any{"action": "reply"}})
	if got := state.Execute(ctx, m.config, ToolCall{Function: FunctionCall{Name: "toolbox", Arguments: string(b)}}); got.OK {
		t.Fatal("model decided for human")
	}
	if requests.Load() != 2 {
		t.Fatal("rejected callback triggered inference")
	}
}

func TestHumanFreeAnswerKeepsQuestionBindingAndIdempotency(t *testing.T) {
	m, r, requests := waitingHuman(t)
	p := humanTestReply(r)
	p.Decision = HumanDecision{Text: "Use a concise annotated table for this report"}
	if h, err := m.ReplyHuman(testMatrixOwner, p); err != nil || h.State != "decision_recorded" {
		t.Fatal(h, err)
	}
	r, err := m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "completed" || requests.Load() != 3 {
		t.Fatal(r.State, requests.Load(), err)
	}
	if _, err = m.ReplyHuman(testMatrixOwner, p); err != nil || requests.Load() != 3 {
		t.Fatal("free answer replayed", err)
	}
	p.Decision.Text = "different answer"
	if _, err = m.ReplyHuman(testMatrixOwner, p); err == nil {
		t.Fatal("conflicting free answer accepted")
	}
}

func TestHumanWaitingSurvivesRestartWithoutPolling(t *testing.T) {
	m, r, requests := waitingHuman(t)
	m.Close()
	second, err := NewAgentManager(m.config, testMatrixOwner, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	h, err := second.HumanStatus(testMatrixOwner, r.HumanRequests[0].ID)
	if err != nil || h.State != "waiting_user" || requests.Load() != 2 {
		t.Fatal(h, err)
	}
	if _, err = second.ReplyHuman(testMatrixOwner, humanTestReply(r)); err != nil {
		t.Fatal(err)
	}
	r, err = second.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "completed" || requests.Load() != 3 {
		t.Fatal(r.State, err)
	}
}

func TestHumanCancelledExpiredAndDecisionCrashNeverReplay(t *testing.T) {
	for _, mode := range []string{"cancel", "expire", "crash_after_decision", "crash_before_tool_commit"} {
		t.Run(mode, func(t *testing.T) {
			m, r, requests := waitingHuman(t)
			p := humanTestReply(r)
			want := "cancelled"
			switch mode {
			case "cancel":
				if err := m.Cancel(testMatrixOwner, r.ID); err != nil {
					t.Fatal(err)
				}
			case "expire":
				m.mu.Lock()
				m.jobs[r.ID].record.HumanRequests[0].ExpiresAt = time.Now().Add(-time.Second).UTC().Format(time.RFC3339Nano)
				m.mu.Unlock()
				want = "expired"
			default:
				m.Close()
				r.State = "running"
				if mode == "crash_after_decision" {
					r.HumanRequests[0].State = "decision_recorded"
					r.HumanRequests[0].DecisionID = p.RequestID
					r.HumanRequests[0].Decision = &p.Decision
					r.HumanRequests[0].ReplySHA256 = humanHash(p)
				} else {
					r.HumanRequests[0].State = "preparing"
				}
				b, _ := json.Marshal(r)
				if err := os.WriteFile(filepath.Join(m.dir, r.ID+".json"), b, 0600); err != nil {
					t.Fatal(err)
				}
				second, err := NewAgentManager(m.config, testMatrixOwner, nil)
				if err != nil {
					t.Fatal(err)
				}
				defer second.Close()
				m = second
				want = "unknown"
			}
			h, err := m.HumanStatus(testMatrixOwner, p.HumanID)
			if err != nil || h.State != want {
				t.Fatal(h, err)
			}
			h, err = m.ReplyHuman(testMatrixOwner, p)
			if mode == "crash_after_decision" {
				if err != nil || h.State != "unknown" {
					t.Fatal(h, err)
				}
			} else if err == nil {
				t.Fatal("closed request resumed")
			}
			if requests.Load() != 2 {
				t.Fatal("cancel/expiry/crash replayed inference")
			}
		})
	}
}

func TestHumanRejectsBatchedRequestAndUnknownHostFields(t *testing.T) {
	m, r, _ := waitingHuman(t)
	b, _ := json.Marshal(humanTestQuestion())
	if _, err := m.requestHuman(context.Background(), r.ID, b); err == nil || !strings.Contains(err.Error(), "single_top_level") {
		t.Fatal(err)
	}
	if _, err := m.callHuman("humans.list", json.RawMessage(`{"callback_url":"http://example.invalid"}`)); err == nil {
		t.Fatal("unknown host field accepted")
	}
	if _, err := m.callHuman("humans.status", json.RawMessage(`{"id":"missing"}`)); err == nil {
		t.Fatal("unknown request accepted")
	}
}
