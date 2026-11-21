// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: testMatrixOwner; matrixTestManager; fixtureAnswer; fixtureSizedAnswer; TestMatrixAgentToolRoundtripResumeAndOwnership; TestMatrixAgentPermissionBudgetAndCancellation; TestMatrixAgentCancelDuringRequestAndRecoverUnknown
// Impact: python -B scripts/code-atlas.py show Core/matrix_agents_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const testMatrixOwner = "0123456789abcdef0123456789abcdef"

func matrixTestManager(t *testing.T, handler http.HandlerFunc) (*AgentManager, string) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	dir := t.TempDir()
	config := filepath.Join(dir, "config.json")
	s := Defaults()
	s.SetPath(config)
	s.ModelPoolVersion = 1
	s.ActiveProfile = "local-model"
	s.ProviderConnections = []ProviderConnection{{ID: "local", Provider: "custom", BaseURL: server.URL, APIKey: "fake-key-only", RequestTimeout: 10}}
	f := false
	s.APIProfiles = []APIProfile{{ID: "local-model", ConnectionID: "local", Model: "fixture", Adapter: "openai", Protocol: ProtocolResponses, BaseURL: server.URL, ToolCalls: true, ContextWindow: 128000, Parameters: rawJSON(map[string]any{"stream": f, "max_tokens": 0})}}
	s.applyPoolProfile()
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	m, err := NewAgentManager(config, testMatrixOwner, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	return m, dir
}

func fixtureAnswer(w http.ResponseWriter, id, text string, calls []any) {
	if calls == nil {
		calls = []any{map[string]any{"type": "message", "id": "msg_" + id, "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": text}}}}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "status": "completed", "output": calls, "usage": map[string]any{"input_tokens": 80, "output_tokens": 20, "input_tokens_details": map[string]any{"cached_tokens": 32}}})
}

// Automatic compaction tests need input usage that grows with their actual
// submitted history. A constant 80-token receipt makes a correctly reused
// prefix appear tiny even when the fixture sends tens of thousands of words.
func fixtureSizedAnswer(w http.ResponseWriter, request any, id, text string, calls []any) {
	recorder := httptest.NewRecorder()
	fixtureAnswer(recorder, id, text, calls)
	var response map[string]any
	_ = json.Unmarshal(recorder.Body.Bytes(), &response)
	response["usage"] = map[string]any{"input_tokens": max(80, (len(rawJSON(request))+3)/4), "output_tokens": 20}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

func TestMatrixAgentToolRoundtripResumeAndOwnership(t *testing.T) {
	var requests atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if len(body["tools"].([]any)) == 0 {
			t.Error("worker omitted tools")
		}
		n := requests.Add(1)
		if n == 1 {
			fixtureAnswer(w, "r1", "", []any{map[string]any{"type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "apply_patch", "arguments": `{"patch":"*** Begin Patch\n*** Add File: proof.txt\n+durable\n*** End Patch"}`}})
			return
		}
		b, _ := json.Marshal(body)
		if !strings.Contains(string(b), "function_call_output") {
			t.Error("tool result lost across requests")
		}
		fixtureAnswer(w, "r"+string(rune('0'+n)), "DELIVERED", nil)
	})
	spec := AgentSpec{RequestID: "create-1", ModelID: "local-model", Task: "produce proof", Prompt: "specialist", Workdir: dir, Tools: []string{"apply_patch"}, MaxRequests: 6}
	r, err := m.Create(context.Background(), testMatrixOwner, spec)
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := m.Create(context.Background(), testMatrixOwner, spec)
	if err != nil || duplicate.ID != r.ID {
		t.Fatal("idempotency", err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "completed" || r.Acceptance != "pending" || r.ToolTurns != 1 {
		t.Fatalf("%+v %v", r, err)
	}
	b, err := os.ReadFile(filepath.Join(dir, "proof.txt"))
	if err != nil || strings.TrimSpace(string(b)) != "durable" {
		t.Fatal("artifact missing", err)
	}
	if _, err = m.Status("someone-else", r.ID); err == nil {
		t.Fatal("cross-owner access")
	}
	if _, err = m.Review(testMatrixOwner, r.ID, "accepted", ""); err == nil {
		t.Fatal("review without evidence")
	}
	if _, err = m.Review(testMatrixOwner, r.ID, "accepted", "Read proof.txt independently: durable"); err != nil {
		t.Fatal(err)
	}
	r, err = m.Send(testMatrixOwner, r.ID, "turn-2", "verify again")
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "completed" || r.Requests != 3 || r.AccountedTokens != 300 {
		t.Fatalf("%+v %v", r, err)
	}
	if len(r.Usage) != 3 || r.Usage[0].Cached == nil || *r.Usage[0].Cached != 32 {
		t.Fatal("cache telemetry lost", r.Usage)
	}
	ledger, err := os.ReadFile(filepath.Join(m.dir, "usage.jsonl"))
	if err != nil || strings.Count(string(ledger), "\n") != 3 || !strings.Contains(string(ledger), `"host":"127.0.0.1"`) || !strings.Contains(string(ledger), `"at":"`) {
		t.Fatal("local request ledger", err, string(ledger))
	}
	m.Close()
	second, err := NewAgentManager(m.config, testMatrixOwner, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	loaded, err := second.Status(testMatrixOwner, r.ID)
	if err != nil || loaded.State != "completed" || requests.Load() != 3 {
		t.Fatal("restore replayed", err)
	}
}

func TestMatrixAgentPermissionBudgetAndCancellation(t *testing.T) {
	var requests atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		fixtureAnswer(w, "budget", "", []any{map[string]any{"type": "function_call", "id": "fc_b", "call_id": "call_b", "name": "apply_patch", "arguments": `{"patch":"*** Begin Patch\n*** Add File: forbidden.txt\n+bad\n*** End Patch"}`}})
	})
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "denied", ModelID: "local-model", Task: "task", Workdir: dir, Tools: []string{}, MaxRequests: 2})
	if err != nil {
		t.Fatal(err)
	}
	r, _ = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if r.State != "failed" || !strings.Contains(r.Error, "tool_not_assigned") {
		t.Fatal(r.State, r.Error)
	}
	if _, err = os.Stat(filepath.Join(dir, "forbidden.txt")); !os.IsNotExist(err) {
		t.Fatal("unassigned tool executed")
	}
	r, err = m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "budget", ModelID: "local-model", Task: "task", Workdir: dir, Tools: []string{"apply_patch"}, MaxTokens: 10})
	if err != nil {
		t.Fatal(err)
	}
	r, _ = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if r.State != "failed" || !strings.Contains(r.Error, "budget") {
		t.Fatal(r.State, r.Error)
	}
	if _, err = os.Stat(filepath.Join(dir, "forbidden.txt")); !os.IsNotExist(err) {
		t.Fatal("over-budget response dispatched")
	}
	state := &ToolboxState{Open: map[string]bool{"settings": true}}
	if got := state.Execute(WithToolPermissions(context.Background(), []string{"compact"}), "", toolboxCall("p", "call", "settings")); got.OK || !strings.Contains(got.Error.Message, "tool_not_assigned") {
		t.Fatal("toolbox bypass", got)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = m.Create(ctx, testMatrixOwner, AgentSpec{}); err == nil {
		t.Fatal("cancelled creation allowed")
	}
}

func TestMatrixAgentCancelDuringRequestAndRecoverUnknown(t *testing.T) {
	started := make(chan struct{}, 1)
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		started <- struct{}{}
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	})
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "cancel", ModelID: "local-model", Task: "task", Workdir: dir})
	if err != nil {
		t.Fatal(err)
	}
	<-started
	if err = m.Cancel(testMatrixOwner, r.ID); err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "cancelled" {
		t.Fatal(r.State, err)
	}
	if r.Failure == nil || r.Failure.Code != "cancelled" || r.Failure.Origin != "local" {
		t.Fatalf("explicit cancellation lost its cause: %+v", r.Failure)
	}
	m.Close()
	r.State = "running"
	b, _ := json.Marshal(r)
	if err = os.WriteFile(filepath.Join(m.dir, r.ID+".json"), b, 0600); err != nil {
		t.Fatal(err)
	}
	second, err := NewAgentManager(m.config, testMatrixOwner, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	r, err = second.Status(testMatrixOwner, r.ID)
	if err != nil || r.State != "interrupted" {
		t.Fatal(r.State, err)
	}
	select {
	case <-started:
		t.Fatal("restart reissued request")
	default:
	}
}
