// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: fastRetryContext; TestAlphaResponseRetryDiscardsUncommittedToolsAndReusesRequest; TestChatUpstreamReadErrorRetriesWithoutCommittingPartialTool; TestEmptyStreamErrorRetriesBothProtocols; TestAlphaRetryBoundsAndRejections; TestAlphaRetryCancelAndBudgetGuard; TestAlphaRetryAfterParsesAndKeepsUpperBound; TestAlphaRetryAttemptTimeoutIsBounded; TestStreamFirstResponseIgnoresHeadersAndHeartbeats; TestStreamIdleTimeoutAfterEffectiveResponse; TestStartedStreamHeartbeatsExtendIdleTimeout; TestRetryStopsAfterLongThinkingWithoutCommittedResponse
// Impact: python -B scripts/code-atlas.py show Core/request_retry_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func fastRetryContext(partial bool) context.Context {
	return context.WithValue(context.Background(), retryContextKey{}, retryOptions{resetPartial: partial, delay: func(int) time.Duration { return 0 }})
}

func TestAlphaResponseRetryDiscardsUncommittedToolsAndReusesRequest(t *testing.T) {
	var calls atomic.Int32
	var bodies []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		bodies = append(bodies, string(b))
		w.Header().Set("Content-Type", "text/event-stream")
		if calls.Add(1) == 1 {
			io.WriteString(w, responseFrame(map[string]any{"type": "response.output_text.delta", "output_index": 0, "item_id": "item_text", "delta": "unfinished"}))
			io.WriteString(w, responseFrame(map[string]any{"type": "response.function_call_arguments.delta", "output_index": 1, "item_id": "item_call", "delta": "{\"action\":"}))
			return
		}
		io.WriteString(w, terminalFrame("completed", responseTextItem("verified"), responseCall(`{"action":"read"}`)))
	}))
	defer server.Close()
	s := Defaults()
	s.BaseURL = server.URL
	s.APIProtocol = ProtocolResponses
	s.APIKey = "fake-alpha"
	var responses, retries, done int
	var visible string
	for event := range New(s).StreamResponses(fastRetryContext(true), s, []Message{{Role: RoleUser, Content: "fixed request"}}, nil) {
		switch event.Kind {
		case EventDelta:
			visible += event.Text
		case EventRetry:
			retries++
			visible = ""
			if !event.Retry.Partial || event.Retry.Category != "unexpected_eof" {
				t.Fatal(event.Retry)
			}
		case EventResponse:
			responses++
			if len(event.Message.ToolCalls) != 1 || event.Message.Content != "verified" {
				t.Fatal("unverified tool escaped")
			}
		case EventDone:
			done++
		case EventError:
			t.Fatal(event.Err)
		}
	}
	if calls.Load() != 2 || retries != 1 || responses != 1 || done != 1 || visible != "verified" {
		t.Fatalf("counts %d/%d/%d/%d output %q", calls.Load(), retries, responses, done, visible)
	}
	if bodies[0] != bodies[1] {
		t.Fatal("retry changed immutable request")
	}
}

func TestChatUpstreamReadErrorRetriesWithoutCommittingPartialTool(t *testing.T) {
	var calls atomic.Int32
	bodies := make(chan string, 3)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		bodies <- string(body)
		w.Header().Set("Content-Type", "text/event-stream")
		if calls.Add(1) == 1 {
			fmt.Fprint(w, `data: {"id":"initial","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"incomplete","type":"function","function":{"name":"terminal","arguments":"{"}}]}}]}`+"\n\n")
			fmt.Fprint(w, "data: {\"error\":{\"code\":\"upstream_stream_read_error\",\"status\":\"bad_gateway\",\"message\":\"Upstream response stream was interrupted\"}}\n\n")
			return
		}
		fmt.Fprint(w, "data: {\"id\":\"retry\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"verified\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}))
	defer server.Close()
	s := nativeTestSettings(ProtocolChat)
	s.BaseURL = server.URL
	var retries, responses int
	for event := range New(s).StreamChatTools(fastRetryContext(true), s, []Message{{Role: RoleUser, Content: "fixed request"}}, nil) {
		switch event.Kind {
		case EventRetry:
			retries++
			if event.Retry.Category != "http_502" || !event.Retry.Partial {
				t.Fatal(event.Retry)
			}
		case EventResponse:
			responses++
			if len(event.Message.ToolCalls) != 0 || event.Message.Content != "verified" {
				t.Fatal("a partial tool call escaped into the final response", event.Message)
			}
		case EventError:
			t.Fatal(event.Err)
		}
	}
	if calls.Load() != 2 || retries != 1 || responses != 1 {
		t.Fatal("missing retry or multiple responses", calls.Load(), retries, responses)
	}
	if first, second := <-bodies, <-bodies; first != second {
		t.Fatal("the retry changed the original request")
	}
}

func TestEmptyStreamErrorRetriesBothProtocols(t *testing.T) {
	for _, tc := range []struct {
		protocol string
		failure  string
		success  string
	}{
		{ProtocolChat, `data: {"error":{"code":"empty_response","message":"Gemini stream ended before a candidate"}}` + "\n\n",
			`data: {"id":"retry","choices":[{"index":0,"delta":{"content":"verified"},"finish_reason":"stop"}]}` + "\n\ndata: [DONE]\n\n"},
		{ProtocolResponses, "event: error\n" + `data: {"type":"error","code":"empty_response","message":"Gemini stream ended before a candidate"}` + "\n\n",
			terminalFrame("completed", responseTextItem("verified"))},
	} {
		t.Run(tc.protocol, func(t *testing.T) {
			var calls atomic.Int32
			bodies := make(chan string, 3)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				body, _ := io.ReadAll(r.Body)
				bodies <- string(body)
				w.Header().Set("Content-Type", "text/event-stream")
				if calls.Add(1) == 1 {
					fmt.Fprint(w, ": PING\n\n", tc.failure)
					return
				}
				fmt.Fprint(w, tc.success)
			}))
			defer server.Close()
			s := nativeTestSettings(tc.protocol)
			s.BaseURL = server.URL
			client := New(s)
			ctx := fastRetryContext(true)
			messages := []Message{{Role: RoleUser, Content: "fixed request"}}
			var events <-chan Event
			if tc.protocol == ProtocolResponses {
				events = client.StreamResponses(ctx, s, messages, nil)
			} else {
				events = client.StreamChatTools(ctx, s, messages, nil)
			}
			var retries, responses int
			for event := range events {
				switch event.Kind {
				case EventRetry:
					retries++
					if event.Retry.Category != "http_502" || event.Retry.Partial {
						t.Fatal(event.Retry)
					}
				case EventResponse:
					responses++
					if event.Message.Content != "verified" || len(event.Message.ToolCalls) != 0 {
						t.Fatal(event.Message)
					}
				case EventError:
					t.Fatal(event.Err)
				}
			}
			if calls.Load() != 2 || retries != 1 || responses != 1 {
				t.Fatalf("calls=%d retries=%d responses=%d", calls.Load(), retries, responses)
			}
			if first, second := <-bodies, <-bodies; first != second {
				t.Fatal("retry changed the request")
			}
		})
	}
}

func TestAlphaRetryBoundsAndRejections(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		want int
	}{
		{"eof", io.ErrUnexpectedEOF, 3}, {"unavailable", &APIError{StatusCode: 503}, 3},
		{"unauthorized", &APIError{StatusCode: 401}, 1}, {"invalid", &APIError{StatusCode: 400}, 1},
		{"quota", &APIError{StatusCode: 429, Code: "insufficient_quota"}, 1},
		{"long_wait", &APIError{StatusCode: 429, RetryAfter: time.Minute}, 1},
		{"protocol", errors.New("inconsistent output identity"), 1},
		{"goaway", errors.New("读取 Responses 中断：http2: server sent GOAWAY and closed the connection; LastStreamID=1, ErrCode=NO_ERROR"), 3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			c := New(Defaults())
			err := c.retryStream(fastRetryContext(true), func(Event) error { return nil }, func(context.Context, func(Event) error) error { calls++; return tc.err })
			if err == nil || calls != tc.want {
				t.Fatalf("calls=%d err=%v", calls, err)
			}
		})
	}
	for _, kind := range []EventKind{EventDelta, EventResponse, EventDone} {
		t.Run("output_guard_"+string(rune('a'+kind)), func(t *testing.T) {
			calls := 0
			c := New(Defaults())
			ctx := fastRetryContext(kind != EventDelta)
			err := c.retryStream(ctx, func(Event) error { return nil }, func(_ context.Context, send func(Event) error) error {
				calls++
				_ = send(Event{Kind: kind, Text: "visible"})
				return io.ErrUnexpectedEOF
			})
			if err == nil || calls != 1 {
				t.Fatal("replayed published response or non-reset-aware output")
			}
		})
	}
}

func TestAlphaRetryCancelAndBudgetGuard(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	calls := 0
	err := New(Defaults()).retryStream(ctx, func(e Event) error {
		if e.Kind == EventRetry {
			cancel()
		}
		return nil
	}, func(context.Context, func(Event) error) error { calls++; return io.ErrUnexpectedEOF })
	if !errors.Is(err, context.Canceled) || calls != 1 {
		t.Fatal("backoff ignored cancel")
	}
	ctx = context.WithValue(context.Background(), retryContextKey{}, retryOptions{resetPartial: true, delay: func(int) time.Duration { return 0 }, beforeRetry: func(RetryInfo) error { return errors.New("budget exhausted") }})
	calls = 0
	err = New(Defaults()).retryStream(ctx, func(Event) error { return nil }, func(context.Context, func(Event) error) error { calls++; return io.ErrUnexpectedEOF })
	if err == nil || !strings.Contains(err.Error(), "budget") || calls != 1 {
		t.Fatal("retry bypassed budget")
	}
}

func TestAlphaRetryAfterParsesAndKeepsUpperBound(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	if retryAfter("2", now) != 2*time.Second || retryAfter(now.Add(5*time.Second).UTC().Format(http.TimeFormat), now) != 5*time.Second || retryAfter("9223372036854775807", now) <= 30*time.Second {
		t.Fatal("Retry-After mismatch or overflow")
	}
}

func TestAlphaRetryAttemptTimeoutIsBounded(t *testing.T) {
	c := New(Defaults())
	ctx := context.WithValue(fastRetryContext(true), retryContextKey{}, retryOptions{firstResponseTimeout: 15 * time.Millisecond, delay: func(int) time.Duration { return 0 }})
	calls := 0
	err := c.retryStream(ctx, func(Event) error { return nil }, func(ctx context.Context, _ func(Event) error) error { calls++; <-ctx.Done(); return ctx.Err() })
	if !errors.Is(err, context.DeadlineExceeded) || calls != 3 {
		t.Fatal("attempt timeout did not converge")
	}
}

func TestStreamFirstResponseIgnoresHeadersAndHeartbeats(t *testing.T) {
	for _, kind := range []string{ProtocolChat, ProtocolResponses, ProtocolMessages, ProtocolGoogle} {
		t.Run(kind, func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "text/event-stream")
				ticker := time.NewTicker(5 * time.Millisecond)
				defer ticker.Stop()
				for {
					fmt.Fprint(w, ": keepalive\n\n")
					w.(http.Flusher).Flush()
					select {
					case <-r.Context().Done():
						return
					case <-ticker.C:
					}
				}
			}))
			defer server.Close()
			parent, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			ctx := context.WithValue(parent, retryContextKey{}, retryOptions{firstResponseTimeout: 40 * time.Millisecond, delay: func(int) time.Duration { return 0 }})
			s := nativeTestSettings(kind)
			s.BaseURL = server.URL
			_, _, err := completeAgent(ctx, New(s), s, nil, nil)
			failure := classifyAgentFailure(err, server.URL)
			if calls.Load() != 3 || !errors.Is(err, context.DeadlineExceeded) || !strings.Contains(err.Error(), "首个有效响应") || failure.Code != modelFirstResponseTimeout || !failure.Retryable {
				t.Fatalf("calls=%d err=%v", calls.Load(), err)
			}
		})
	}
}

func TestStreamIdleTimeoutAfterEffectiveResponse(t *testing.T) {
	ctx := context.WithValue(context.Background(), retryContextKey{}, retryOptions{noRetry: true, firstResponseTimeout: time.Second})
	client := New(Defaults())
	client.http.Timeout = 20 * time.Millisecond
	err := client.retryStream(ctx, func(Event) error { return nil }, func(attempt context.Context, emit func(Event) error) error {
		if err := emit(Event{Kind: EventDelta, Text: "hello"}); err != nil {
			return err
		}
		<-attempt.Done()
		return attempt.Err()
	})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected a timeout, got %v", err)
	}
	failure := classifyAgentFailure(err, "")
	if failure.Code != modelStreamIdleTimeout || !failure.Retryable {
		t.Fatalf("failure=%+v", failure)
	}
	if brief := codingResultBrief(AgentRecord{State: "timed_out", Failure: failure}); !strings.Contains(brief, failure.Title) {
		t.Fatalf("Coding Brief lost the stream stage: %s", brief)
	}
}

func TestStartedStreamHeartbeatsExtendIdleTimeout(t *testing.T) {
	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"id\":\"test\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello\"}}]}\n\n")
		w.(http.Flusher).Flush()
		select {
		case <-started:
		case <-r.Context().Done():
			return
		}
		ticker := time.NewTicker(20 * time.Millisecond)
		defer ticker.Stop()
		for i := 0; i < 24; i++ {
			select {
			case <-r.Context().Done():
				return
			case <-ticker.C:
				fmt.Fprint(w, ": keepalive\n\n")
				w.(http.Flusher).Flush()
			}
		}
		fmt.Fprint(w, "data: {\"id\":\"test\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}))
	defer server.Close()
	parent, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	ctx := context.WithValue(parent, retryContextKey{}, retryOptions{firstResponseTimeout: 300 * time.Millisecond, noRetry: true})
	s := nativeTestSettings(ProtocolChat)
	s.BaseURL = server.URL
	c := New(s)
	c.http.Timeout = 180 * time.Millisecond
	done := false
	for event := range c.StreamChatTools(ctx, s, nil, nil) {
		if event.Kind == EventDelta && event.Text == "hello" {
			close(started)
		}
		if event.Kind == EventError {
			t.Fatal(event.Err)
		}
		done = done || event.Kind == EventDone
	}
	if !done {
		t.Fatal("stream did not finish")
	}
}

func TestRetryStopsAfterLongThinkingWithoutCommittedResponse(t *testing.T) {
	old := longThinkingCutoff
	longThinkingCutoff = 0
	defer func() { longThinkingCutoff = old }()
	for _, tc := range []struct {
		name   string
		events []Event
		want   int
	}{
		{"thinking_only", []Event{{Kind: EventReasoning, Text: "想"}}, 1},
		{"late_partial_answer", []Event{{Kind: EventReasoning, Text: "想"}, {Kind: EventDelta, Text: "开始绘制"}}, 1},
		{"uncommitted_tool", []Event{{Kind: EventReasoning, Text: "想"}, {Kind: EventToolPreparing}}, 1},
		{"text_without_reasoning", []Event{{Kind: EventDelta, Text: "答"}}, 3},
		{"no_output", nil, 3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls, retries := 0, 0
			err := New(Defaults()).retryStream(fastRetryContext(true), func(e Event) error {
				if e.Kind == EventRetry {
					retries++
				}
				return nil
			}, func(_ context.Context, send func(Event) error) error {
				calls++
				for _, e := range tc.events {
					_ = send(e)
				}
				return io.ErrUnexpectedEOF
			})
			var long *LongThinkingError
			if calls != tc.want || retries != tc.want-1 || errors.As(err, &long) != (tc.want == 1) || !errors.Is(err, io.ErrUnexpectedEOF) {
				t.Fatalf("calls=%d retries=%d err=%v", calls, retries, err)
			}
		})
	}
}
