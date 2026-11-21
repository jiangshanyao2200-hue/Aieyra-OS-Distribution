// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: truncatedFixture; configureOutputFixture; TestOutputAutomaticAcceptsAnswerBeyondLocalReservation; TestOutputContinuationRetainsTextUsageAndUnexecutedCalls; TestOutputContinuationStopsAtBoundAndPreservesExplicitBudget; TestOutputLimitWorkerRetainsTypedCauseAndPartialAnswer; TestOutputContinuationHonorsTaskBudgetAndDoesNotExecutePartialTools; TestOutputContinuationWindowAndModelOverrides; TestOutputLimitStreamingChatKeepsPartialArguments; TestOutputContinuationCanBeCancelledDuringNextRequest; TestOutputLimitNativeProtocolsKeepOnlyAuditCalls
// Impact: python -B scripts/code-atlas.py show Core/output_continuation_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func truncatedFixture(w http.ResponseWriter, content, reasoning, args string) {
	message := map[string]any{"role": "assistant", "content": content, "reasoning_content": reasoning}
	if args != "" {
		message["tool_calls"] = []any{map[string]any{"id": "unfinished", "type": "function", "function": map[string]any{"name": "apply_patch", "arguments": args}}}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"id": "truncated", "choices": []any{map[string]any{"index": 0, "finish_reason": "length", "message": message}}, "usage": map[string]any{"prompt_tokens": 100, "completion_tokens": 4096, "prompt_cache_hit_tokens": 80}})
}

func configureOutputFixture(t *testing.T, m *AgentManager, explicit int) {
	t.Helper()
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	p := &s.APIProfiles[0]
	p.Protocol = ProtocolChat
	p.OutputLimit = 32768
	p.Parameters = rawJSON(map[string]any{"stream": false, "max_tokens": explicit})
	s.applyPoolProfile()
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
}

func TestOutputAutomaticAcceptsAnswerBeyondLocalReservation(t *testing.T) {
	answer := strings.Repeat("完整输出保留。", 1500) + "FINAL_OUTPUT_MARKER"
	var requests atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		for _, key := range []string{"max_tokens", "max_completion_tokens", "max_output_tokens"} {
			if _, exists := body[key]; exists {
				t.Errorf("unexpected output cap: %s", key)
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]any{"role": "assistant", "content": answer}}}, "usage": map[string]any{"prompt_tokens": 100, "completion_tokens": 9000}})
	})
	configureOutputFixture(t, m, 0)
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "automatic-long", ModelID: "local-model", Task: "read complete answer", Workdir: dir})
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "completed" || r.Result != answer || requests.Load() != 1 || len(r.Usage) != 1 || r.Usage[0].OutputLimit != 0 || r.AccountedTokens != 9100 {
		t.Fatalf("state=%s bytes=%d calls=%d usage=%+v error=%v/%s", r.State, len(r.Result), requests.Load(), r.Usage, err, r.Error)
	}
}

func TestOutputContinuationRetainsTextUsageAndUnexecutedCalls(t *testing.T) {
	for _, mode := range []string{"text", "tool"} {
		t.Run(mode, func(t *testing.T) {
			var requests atomic.Int32
			var limits []int
			m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				_ = json.NewDecoder(r.Body).Decode(&body)
				if _, capped := body["max_tokens"]; capped {
					t.Error("automatic output unexpectedly sent max_tokens")
				}
				limit, _ := body["max_tokens"].(float64)
				limits = append(limits, int(limit))
				if requests.Add(1) == 1 {
					switch mode {
					case "text":
						truncatedFixture(w, "已完成的第一段。", "", "")
					case "reasoning":
						truncatedFixture(w, "", "private reasoning", "")
					case "tool":
						truncatedFixture(w, "", "", `{"patch":"*** Begin Patch`)
					}
					return
				}
				raw := string(rawJSON(body))
				if !strings.Contains(raw, "上一请求因输出长度上限结束") {
					t.Error("missing external continuation notice")
				}
				if mode == "text" && !strings.Contains(raw, "已完成的第一段。") {
					t.Error("partial text missing")
				}
				if strings.Contains(raw, "unfinished") || strings.Contains(raw, "private reasoning") || strings.Contains(raw, "incomplete_tool_calls") {
					t.Error("incomplete protocol data replayed")
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"id": "final", "choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]any{"role": "assistant", "content": "后续完成。"}}}, "usage": map[string]any{"prompt_tokens": 120, "completion_tokens": 10, "prompt_cache_hit_tokens": 90}})
			})
			configureOutputFixture(t, m, 0)
			before, _ := os.ReadFile(m.config)
			r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: mode, ModelID: "local-model", Task: "continue bounded output", Workdir: dir, Tools: []string{"apply_patch"}})
			if err != nil {
				t.Fatal(err)
			}
			r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
			want := "后续完成。"
			if mode == "text" {
				want = "已完成的第一段。" + want
			}
			if err != nil || r.State != "completed" || r.Result != want || r.ToolTurns != 0 || requests.Load() != 2 {
				t.Fatalf("state=%s result=%q error=%v/%s calls=%d", r.State, r.Result, err, r.Error, requests.Load())
			}
			if len(limits) != 2 || limits[0] != 0 || limits[1] != 0 {
				t.Fatal("automatic output must not acquire a cap during continuation", limits)
			}
			if r.AccountedTokens != 4326 || len(r.Usage) != 2 || r.Usage[0].FinishReason != "length" || r.Usage[0].OutputLimit != 0 || r.Usage[0].Cached == nil || *r.Usage[0].Cached != 80 {
				t.Fatal("usage lost", r.Usage, r.AccountedTokens)
			}
			after, _ := os.ReadFile(m.config)
			if string(before) != string(after) {
				t.Fatal("configuration rewritten")
			}
			a, restored, err := RestoreSession(filepath.Join(m.dir, "config.json"), r.ID)
			if err != nil {
				t.Fatal(err)
			}
			defer a.Close()
			textCount := 0
			for _, msg := range restored.Messages {
				if msg.Content == "已完成的第一段。" {
					textCount++
				}
				if len(msg.ToolCalls)+len(msg.IncompleteTools) > 0 {
					t.Fatal("unexecuted calls restored")
				}
			}
			if mode == "text" && textCount != 1 {
				t.Fatal("partial text not retained exactly once", textCount)
			}
		})
	}
}

func TestOutputContinuationStopsAtBoundAndPreservesExplicitBudget(t *testing.T) {
	for _, tc := range []struct {
		name, content   string
		explicit, calls int
	}{{"provider reasoning limit", "", 0, 1}, {"explicit reasoning", "", 4096, 1}, {"explicit text", "same partial", 4096, 2}} {
		t.Run(tc.name, func(t *testing.T) {
			var requests atomic.Int32
			m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				truncatedFixture(w, tc.content, "thinking", "")
			})
			configureOutputFixture(t, m, tc.explicit)
			r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "bound", ModelID: "local-model", Task: "stop bounded truncation", Workdir: dir})
			if err != nil {
				t.Fatal(err)
			}
			r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
			if err != nil || r.State != "failed" || r.Failure == nil || r.Failure.Code != "output_limit" || requests.Load() != int32(tc.calls) {
				t.Fatal(r.State, r.Failure, r.Error, err, requests.Load())
			}
			if tc.explicit > 0 {
				for _, u := range r.Usage {
					if u.OutputLimit != tc.explicit {
						t.Fatal("explicit limit changed", u)
					}
				}
			}
		})
	}
}

func TestOutputLimitWorkerRetainsTypedCauseAndPartialAnswer(t *testing.T) {
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		truncatedFixture(w, "saved partial", "thinking", `{"patch":`)
	})
	configureOutputFixture(t, m, 0)
	s, err := m.settings("local-model")
	if err != nil {
		t.Fatal(err)
	}
	answer, usage, err := completeAgentProcess(WithProviderSession(context.Background(), testMatrixOwner), s, []Message{{Role: RoleUser, Content: "fixture"}}, nil, nil, nil)
	var limit *OutputLimitError
	if !errors.As(err, &limit) || limit.Limit != 0 || limit.Tools != 1 || answer.Content != "saved partial" || answer.FinishReason != "length" || len(answer.ToolCalls) != 0 || len(answer.IncompleteTools) != 1 || usage == nil || usage.CompletionTokens != 4096 {
		t.Fatalf("%+v %+v %T %v", answer, usage, err, err)
	}
	if classifyAgentFailure(err, s.BaseURL).Code != "output_limit" {
		t.Fatal("typed classification lost")
	}
	if _, _, err = completeAgent(context.Background(), New(s), s, nil, nil); !errors.As(err, &limit) {
		t.Fatal("maintenance caller accepted truncated output", err)
	}
}

func TestOutputContinuationHonorsTaskBudgetAndDoesNotExecutePartialTools(t *testing.T) {
	var requests atomic.Int32
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		truncatedFixture(w, "retained", "", `{"patch":"*** Begin Patch\n*** Add File: forbidden.txt\n+bad\n*** End Patch"}`)
	})
	configureOutputFixture(t, m, 0)
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "budget", ModelID: "local-model", Task: "bounded", Workdir: dir, Tools: []string{"apply_patch"}, MaxTokens: 100})
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.Failure == nil || r.Failure.Code != "task_token_limit" || requests.Load() != 1 || r.Result != "retained" {
		t.Fatal(r.State, r.Failure, err, requests.Load())
	}
	if _, err = os.Stat(filepath.Join(dir, "forbidden.txt")); !os.IsNotExist(err) {
		t.Fatal("truncated tool executed")
	}
}

func TestOutputContinuationWindowAndModelOverrides(t *testing.T) {
	s := Defaults()
	s.ModelPoolVersion = 1
	s.ActiveProfile = "x"
	s.APIProfiles = []APIProfile{{ID: "x", Model: "fixture", ContextWindow: 12000, OutputLimit: 10000, Parameters: rawJSON(map[string]any{"max_tokens": 0})}}
	s.MaxTokens = 4096
	c := outputContinuation{}
	if c.next(s, nil, Message{ReasoningContent: "thinking"}, 7000) {
		t.Fatal("attempt without output room")
	}
	if c.next(s, rawJSON(map[string]any{"max_tokens": 4096}), Message{ReasoningContent: "thinking"}, 10) {
		t.Fatal("explicit override enlarged")
	}
}

func TestOutputLimitStreamingChatKeepsPartialArguments(t *testing.T) {
	stream := ""
	for _, chunk := range []any{
		map[string]any{"id": "partial-stream", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"content": "visible prefix", "tool_calls": []any{map[string]any{"index": 0, "id": "incomplete", "function": map[string]any{"name": "apply_patch", "arguments": `{"patch":`}}}}}}},
		map[string]any{"id": "partial-stream", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{}, "finish_reason": "length"}}, "usage": map[string]any{"prompt_tokens": 100, "completion_tokens": 4096}},
	} {
		stream += "data: " + string(rawJSON(chunk)) + "\n\n"
	}
	stream += "data: [DONE]\n\n"
	var response *Message
	var usage *Usage
	done := false
	err := readChatTools(strings.NewReader(stream), func(e Event) error {
		if e.Message != nil {
			copy := *e.Message
			response = &copy
		}
		if e.Usage != nil {
			usage = e.Usage
		}
		done = done || e.Kind == EventDone
		return nil
	})
	if err != nil || !done || response == nil || response.Content != "visible prefix" || len(response.ToolCalls) != 0 || len(response.IncompleteTools) != 1 || usage == nil || usage.CompletionTokens != 4096 {
		t.Fatalf("%+v %+v %v", response, usage, err)
	}
	if _, err = ExecuteToolTurn(context.Background(), nil, nil, *response, "partial", nil); err == nil {
		t.Fatal("incomplete turn accepted")
	}
}

func TestOutputContinuationCanBeCancelledDuringNextRequest(t *testing.T) {
	var requests atomic.Int32
	entered := make(chan struct{})
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 1 {
			truncatedFixture(w, "prefix", "", "")
			return
		}
		close(entered)
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	})
	configureOutputFixture(t, m, 0)
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "cancel-continuation", ModelID: "local-model", Task: "cancel continued output", Workdir: dir})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("continuation not started")
	}
	if err = m.Cancel(testMatrixOwner, r.ID); err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 10000)
	if err != nil || r.State != "cancelled" || requests.Load() != 2 {
		t.Fatal(r.State, err, requests.Load())
	}
}

func TestOutputLimitNativeProtocolsKeepOnlyAuditCalls(t *testing.T) {
	for _, tc := range []struct {
		reason string
		google bool
		parts  []map[string]any
	}{
		{"MAX_TOKENS", true, []map[string]any{{"text": "prefix"}, {"functionCall": map[string]any{"name": "apply_patch", "args": map[string]any{"patch": "incomplete"}}}}},
		{"max_tokens", false, []map[string]any{{"type": "text", "text": "prefix"}, {"type": "tool_use", "id": "p", "name": "apply_patch", "input": nil, "partial_json": `{"patch":`}}},
	} {
		m, err := nativeMessage("native", tc.reason, tc.parts, tc.google)
		if err != nil || m.FinishReason != "length" || m.Content != "prefix" || len(m.ToolCalls) != 0 || len(m.IncompleteTools) != 1 {
			t.Fatalf("%+v %v", m, err)
		}
	}
	frame := modelWorkerFrame{}
	frame.setError(fmt.Errorf("request: %w", &OutputLimitError{Limit: 4096, Tools: 1}))
	var typed *OutputLimitError
	if !errors.As(frame.decodedError(), &typed) || typed.Tools != 1 {
		t.Fatal("worker type lost")
	}
}
