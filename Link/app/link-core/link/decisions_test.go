// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: question; TestHumanDecisionAuthorizationBindingDurabilityAndImmutableReceipt; TestExpiredQuestionAndCancellationRejectNewAnswer; TestCancellationPrecedesCappedQueueAndCatalogMode; TestBridgeHumanAnswerLostReceiptReconcilesWithoutReplay
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/decisions_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

func question(t *testing.T, f *hubFixture) (*Client, *Client, Message, map[string]any) {
	t.Helper()
	executor, sender := pairDevice(t, f, "executor"), pairDevice(t, f, "sender")
	var session Session
	mustCall(t, executor, "/v1/attach", map[string]string{"local_id": "human-core", "mode": "cli"}, &session)
	var m Message
	mustCall(t, sender, "/v1/send", map[string]string{"session_id": session.ID, "request_id": "question", "text": "Choose"}, &m)
	h := HumanQuestion{ID: "h1", SessionID: "human-core", AgentID: "matrix", Generation: 1, Version: 1, Token: strings.Repeat("a", 64), Question: "Which?", State: "waiting_user", ExpiresAt: time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano), Options: []HumanOption{{ID: "one", Label: "One"}}}
	mustCall(t, executor, "/v1/receipt", map[string]any{"id": m.ID, "state": "waiting_user", "human": h}, &m)
	args := map[string]any{"id": m.ID, "request_id": "answer-one", "human_id": h.ID, "expected_request_version": h.Version, "request_token_sha256": h.Token, "decision": Decision{OptionID: "one"}}
	return executor, sender, m, args
}

func TestHumanDecisionAuthorizationBindingDurabilityAndImmutableReceipt(t *testing.T) {
	f := fixtureHub(t)
	executor, sender, m, args := question(t, f)
	other := pairDevice(t, f, "unrelated")
	for _, endpoint := range []string{"/v1/answer", "/v1/cancel"} {
		if err := other.Call(context.Background(), endpoint, args, nil); err == nil {
			t.Fatal("unrelated device accepted", endpoint)
		}
	}
	args["expected_request_version"] = 2
	if err := sender.Call(context.Background(), "/v1/answer", args, nil); err == nil {
		t.Fatal("stale binding accepted")
	}
	args["expected_request_version"] = 1
	var a Answer
	mustCall(t, sender, "/v1/answer", args, &a)
	if err := sender.Call(context.Background(), "/v1/answer-receipt", map[string]string{"id": a.ID, "state": "applied"}, nil); err == nil {
		t.Fatal("sender forged execution")
	}
	mustCall(t, executor, "/v1/answer-receipt", map[string]string{"id": a.ID, "state": "applied"}, nil)
	mustCall(t, executor, "/v1/receipt", map[string]string{"id": m.ID, "state": "completed"}, nil)
	f.mu.Lock()
	f.hub.Close()
	var err error
	f.hub, err = OpenHub(f.directory)
	f.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	var retry Answer
	mustCall(t, sender, "/v1/answer", args, &retry)
	if retry.ID != a.ID || retry.State != "applied" {
		t.Fatal(retry)
	}
	if err := executor.Call(context.Background(), "/v1/answer-receipt", map[string]string{"id": a.ID, "state": "rejected"}, nil); err == nil {
		t.Fatal("receipt rewound")
	}
	args["decision"] = Decision{Text: "changed"}
	if err := sender.Call(context.Background(), "/v1/answer", args, nil); err == nil {
		t.Fatal("conflicting decision accepted")
	}
}

func TestExpiredQuestionAndCancellationRejectNewAnswer(t *testing.T) {
	for _, cancel := range []bool{false, true} {
		t.Run(fmt.Sprint(cancel), func(t *testing.T) {
			f := fixtureHub(t)
			executor, sender, m, args := question(t, f)
			if cancel {
				mustCall(t, sender, "/v1/cancel", map[string]string{"id": m.ID}, nil)
			} else {
				h := *m.Human
				h.ExpiresAt = time.Now().Add(-time.Minute).UTC().Format(time.RFC3339Nano)
				mustCall(t, executor, "/v1/receipt", map[string]any{"id": m.ID, "state": "waiting_user", "human": h}, nil)
			}
			if err := sender.Call(context.Background(), "/v1/answer", args, nil); err == nil {
				t.Fatal("invalid question accepted")
			}
		})
	}
}

func TestCancellationPrecedesCappedQueueAndCatalogMode(t *testing.T) {
	f := fixtureHub(t)
	executor := pairDevice(t, f, "executor")
	var s Session
	mustCall(t, executor, "/v1/attach", map[string]string{"local_id": "queue", "mode": "os"}, &s)
	if err := executor.Call(context.Background(), "/v1/attach", map[string]string{"local_id": "queue", "mode": "cli"}, nil); err == nil {
		t.Fatal("mode changed")
	}
	var tail Message
	for i := 0; i < 105; i++ {
		mustCall(t, f.owner, "/v1/send", map[string]string{"session_id": s.ID, "request_id": fmt.Sprintf("q-%03d", i), "text": "queued"}, &tail)
	}
	mustCall(t, f.owner, "/v1/cancel", map[string]string{"id": tail.ID}, nil)
	var pending []Message
	mustCall(t, executor, "/v1/messages", map[string]any{"session_id": s.ID, "pending": true}, &pending)
	if len(pending) != 100 || pending[0].ID != tail.ID {
		t.Fatal("cancellation hidden behind queue", len(pending))
	}
	mustCall(t, f.owner, "/v1/revoke", map[string]string{"device_id": executor.Identity.ID}, nil)
	var catalog struct{ Sessions []Session }
	mustCall(t, f.owner, "/v1/catalog", nil, &catalog)
	if len(catalog.Sessions) != 1 || catalog.Sessions[0].State != "offline" || catalog.Sessions[0].Mode != "os" {
		t.Fatal(catalog)
	}
}

func TestBridgeHumanAnswerLostReceiptReconcilesWithoutReplay(t *testing.T) {
	f := fixtureHub(t)
	executor, sender := pairDevice(t, f, "executor"), pairDevice(t, f, "sender")
	discovery, _, calls := realCore(t, func(n int, body any) []any {
		var args any
		switch n {
		case 1:
			args = map[string]any{"action": "open", "name": "human"}
		case 2:
			args = map[string]any{"action": "call", "name": "human", "arguments": map[string]any{"action": "request", "request_id": "format", "category": "direction", "question": "Choose", "recommendation": "Plain", "impact": "Format", "resume_summary": "Use chosen format", "options": []any{map[string]string{"id": "plain", "label": "Plain", "impact": "Readable"}, map[string]string{"id": "json", "label": "JSON", "impact": "Structured"}}}}
		default:
			b, _ := json.Marshal(body)
			if !strings.Contains(string(b), "human_request_id") {
				t.Error("missing core decision")
			}
			return []any{map[string]any{"type": "message", "id": "done", "role": "assistant", "status": "completed", "content": []any{map[string]string{"type": "output_text", "text": "ANSWER_ONCE"}}}}
		}
		b, _ := json.Marshal(args)
		return []any{map[string]any{"type": "function_call", "id": fmt.Sprint(n), "call_id": fmt.Sprint(n), "name": "toolbox", "arguments": string(b)}}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	b, err := OpenBridge(ctx, executor, discovery, "human")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { b.Close() }()
	var m Message
	mustCall(t, sender, "/v1/send", map[string]string{"session_id": b.SessionID(), "request_id": "ask", "text": "Choose a format"}, &m)
	for m.Human == nil {
		if err = b.Step(ctx); err != nil {
			t.Fatal(err)
		}
		mustCall(t, sender, "/v1/messages", map[string]string{"id": m.ID}, &m)
		if ctx.Err() != nil {
			t.Fatal(ctx.Err())
		}
		time.Sleep(10 * time.Millisecond)
	}
	var a Answer
	mustCall(t, sender, "/v1/answer", map[string]any{"id": m.ID, "request_id": "choose-plain", "human_id": m.Human.ID, "expected_request_version": m.Human.Version, "request_token_sha256": m.Human.Token, "decision": Decision{OptionID: "plain"}}, &a)
	f.mu.Lock()
	f.failAnswers = true
	f.mu.Unlock()
	if err = b.Step(ctx); err == nil {
		t.Fatal("receipt outage missing")
	}
	// Simulate another poll committing final task state before decision recovery.
	d, err := loadDiscovery(discovery)
	if err != nil {
		t.Fatal(err)
	}
	var status coreStatus
	for !finalState(status.State) {
		if err = coreCall(ctx, d, "matrix.status", map[string]string{"request_id": m.CoreRequestID}, &status); err != nil {
			t.Fatal(err)
		}
		if ctx.Err() != nil {
			t.Fatal(ctx.Err())
		}
		time.Sleep(10 * time.Millisecond)
	}
	mustCall(t, executor, "/v1/receipt", map[string]string{"id": m.ID, "state": status.State, "reply": status.Reply}, nil)
	b.Close()
	f.mu.Lock()
	f.failAnswers = false
	f.mu.Unlock()
	b, err = OpenBridge(ctx, executor, discovery, "human")
	if err != nil {
		t.Fatal(err)
	}
	if err = b.Step(ctx); err != nil {
		t.Fatal(err)
	}
	mustCall(t, sender, "/v1/answers", map[string]string{"id": a.ID}, &a)
	if a.State != "applied" || calls.Load() != 3 {
		t.Fatal(a, calls.Load())
	}
}
