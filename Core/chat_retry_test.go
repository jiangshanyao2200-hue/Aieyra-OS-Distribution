// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestChatRetryUsesOneOriginalInputAndOneExecution
// Impact: python -B scripts/code-atlas.py show Core/chat_retry_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"sync/atomic"
	"testing"
)

func TestChatRetryUsesOneOriginalInputAndOneExecution(t *testing.T) {
	var requests atomic.Int32
	bodies := make(chan []Message, 2)
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Input []Message `json:"input"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		select {
		case bodies <- body.Input:
		default:
		}
		if requests.Add(1) == 1 {
			w.Header().Set("Retry-After", "90")
			http.Error(w, "fixture unavailable", http.StatusServiceUnavailable)
			return
		}
		fixtureAnswer(w, "retry", "done", nil)
	})
	ctx := context.Background()
	const original = "Exact original input."
	r, err := m.Create(ctx, testMatrixOwner, AgentSpec{RequestID: "original", ModelID: "local-model", Task: original, Workdir: dir, MaxRequests: 4})
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(ctx, testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "failed" || r.Failure == nil || !r.Failure.Retryable {
		t.Fatalf("initial failure: %#v %v", r, err)
	}
	request := chatRetryRequest{Generation: r.Generation}
	for range 2 {
		if _, err := m.retryChat(testMatrixOwner, r.ID, request, nil); err != nil {
			t.Fatal(err)
		}
	}
	final, err := m.Wait(ctx, testMatrixOwner, r.ID, 10000)
	if err != nil || final.State != "completed" || final.Generation != r.Generation ||
		final.ChatRetryAttempt != 1 || len(final.Turns) != 1 || final.Turns["original"] != original || requests.Load() != 2 {
		t.Fatalf("retry result: %#v requests=%d %v", final, requests.Load(), err)
	}
	for range 2 {
		body := <-bodies
		if !slices.ContainsFunc(body, func(m Message) bool { return m.Role == RoleUser && m.Content == original }) {
			t.Fatalf("missing original input: %#v", body)
		}
		count := 0
		for _, m := range body {
			if m.Role == RoleUser && m.Content == original {
				count++
			}
		}
		if count != 1 {
			t.Fatalf("original input count = %d", count)
		}
	}
}
