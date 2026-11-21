// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: responseFrame; responseCall; responseTextItem; terminalFrame; parseResponseFixture; responsesFailedMessage; responsesFailedFixture; assertResponsesFailedError; assertResponsesFailedUsage; TestResponsesFailedHTTPPathsMetadataAndNoRetry; TestResponsesFailedEnvelopePrefersProviderError; TestResponsesInterleavingAndDoneDeduplication; TestResponsesRejectCorruptOrUnfinishedTools; TestResponsesRetainTerminalUsageOnFailure; TestResponsesObservedFailureRetainsUsage; TestResponsesRequestReplayAndSnapshot; boolRef; TestResponsesNonstreamingAndCancellation; replayTextEvent; TestResponsesAuthoritativeTextReplay; TestResponsesSummaryRewriteDoesNotRestartActivity; TestResponsesCorrectionsRetainOtherOutputParts; TestResponsesMergedFinalPartsAndLateDisplayDelta; TestResponsesFinalMissingUnsentPartDoesNotBlockLaterBody; TestResponsesConflictingArgumentsStillRejectTools; TestResponsesStaleCorrectionCannotRestoreInvalidatedBody
// Impact: python -B scripts/code-atlas.py show Core/responses_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/aieyra/aieyra-os/api/codec"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func responseFrame(v any) string { b, _ := json.Marshal(v); return "data: " + string(b) + "\n\n" }
func responseCall(args string) json.RawMessage {
	return rawJSON(map[string]any{"type": "function_call", "id": "item_call", "call_id": "call_1", "name": "update_plan", "arguments": args, "status": "completed"})
}
func responseTextItem(text string) json.RawMessage {
	return rawJSON(map[string]any{"type": "message", "id": "item_text", "role": "assistant", "status": "completed", "content": []any{map[string]string{"type": "output_text", "text": text}}})
}
func terminalFrame(status string, items ...json.RawMessage) string {
	return responseFrame(map[string]any{"type": "response." + status, "response": map[string]any{"id": "resp_test", "status": status, "output": items, "usage": map[string]any{"input_tokens": 100, "output_tokens": 20, "input_tokens_details": map[string]int{"cached_tokens": 70}, "output_tokens_details": map[string]int{"reasoning_tokens": 8}}}})
}
func parseResponseFixture(stream string) ([]Event, error) {
	var events []Event
	err := readResponseStream(strings.NewReader(stream), func(e Event) error { events = append(events, e); return nil })
	return events, err
}

const responsesFailedMessage = "Our servers are currently overloaded. Please try again later."

func responsesFailedFixture(kind string, knownUsage bool) map[string]any {
	providerError := map[string]string{"code": "server_error", "message": responsesFailedMessage}
	if kind != "" {
		providerError["type"] = kind
	}
	// The synthetic function item proves that failed output never becomes
	// executable, even when an otherwise valid call is included in the body.
	envelope := map[string]any{"id": "resp_failed", "status": "failed", "error": providerError, "output": []json.RawMessage{responseCall(`{}`)}, "usage": nil}
	if knownUsage {
		envelope["usage"] = map[string]any{"input_tokens": 17, "output_tokens": 4, "total_tokens": 21, "input_tokens_details": map[string]int{"cached_tokens": 0}, "output_tokens_details": map[string]int{"reasoning_tokens": 2}}
	}
	return envelope
}

func assertResponsesFailedError(t *testing.T, err error, kind string) {
	t.Helper()
	var api *APIError
	if !errors.As(err, &api) || api.StatusCode != http.StatusOK || api.Code != "server_error" || api.Type != kind || api.Message != responsesFailedMessage || api.Transient || api.Raw != "" {
		t.Fatalf("failed metadata lost: %T %v (%+v)", err, err, api)
	}
	if !strings.Contains(err.Error(), "HTTP 200") || strings.Contains(err.Error(), "HTTP 0 ") {
		t.Fatalf("failure text does not retain the observed HTTP status: %v", err)
	}
	if category := transientRequestError(err); category != "" {
		t.Fatalf("terminal classification enabled transport retries: %s", category)
	}
	failure := classifyAgentFailure(err, "https://relay.invalid")
	if failure == nil || failure.Code != "provider_unavailable" || failure.Origin != "upstream" || !failure.Retryable {
		t.Fatalf("structured failure lost its origin: %+v", failure)
	}
}

func assertResponsesFailedUsage(t *testing.T, usage *Usage, known bool) {
	t.Helper()
	if !known {
		if usage != nil {
			t.Fatalf("unknown supplier usage became a zero receipt: %+v", usage)
		}
		return
	}
	if usage == nil || usage.PromptTokens != 17 || usage.CompletionTokens != 4 || usage.TotalTokens != 21 || !usage.CacheHitKnown || usage.PromptCacheHitTokens != 0 || usage.PromptCacheMissTokens != 17 || usage.PromptTokensDetails == nil || usage.PromptTokensDetails.CachedTokens != 0 || usage.CompletionTokensDetails == nil || usage.CompletionTokensDetails.ReasoningTokens != 2 {
		t.Fatalf("supplier usage or explicit zero cache receipt changed: %+v", usage)
	}
}

func TestResponsesFailedHTTPPathsMetadataAndNoRetry(t *testing.T) {
	for _, mode := range []string{"stream", "nonstream-events", "complete"} {
		for _, usageMode := range []string{"known", "null", "omitted"} {
			for _, kind := range []string{"", "fixture_error"} {
				t.Run(mode+"/"+usageMode+"/"+kind, func(t *testing.T) {
					known := usageMode == "known"
					envelope := responsesFailedFixture(kind, known)
					if usageMode == "omitted" {
						delete(envelope, "usage")
					}
					var requests atomic.Int32
					server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						requests.Add(1)
						var request ResponsesRequest
						if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
							t.Error(err)
						}
						if request.Stream != (mode == "stream") {
							t.Errorf("wrong fixture path: stream=%v mode=%s", request.Stream, mode)
						}
						if mode == "stream" {
							w.Header().Set("Content-Type", "text/event-stream")
							fmt.Fprint(w, responseFrame(map[string]any{"type": "response.failed", "response": envelope}))
						} else {
							w.Header().Set("Content-Type", "application/json")
							_ = json.NewEncoder(w).Encode(envelope)
						}
					}))
					defer server.Close()
					settings := Defaults()
					settings.APIProtocol, settings.APIKey, settings.BaseURL, settings.Stream = ProtocolResponses, "fixture-key", server.URL, boolRef(mode == "stream")
					// Leave retries enabled; noRetry would conceal a synthetic 503.
					ctx, cancel := context.WithTimeout(fastRetryContext(true), 5*time.Second)
					defer cancel()
					var usage *Usage
					var failure error
					if mode == "complete" {
						var answer Message
						answer, usage, failure = New(settings).CompleteResponses(ctx, settings, []Message{{Role: RoleUser, Content: "fixture"}})
						if len(answer.ToolCalls) != 0 || len(answer.IncompleteTools) != 0 || len(answer.ResponseItems) != 0 {
							t.Fatalf("failed response published tools: %+v", answer)
						}
					} else {
						errorsSeen, usagesSeen := 0, 0
						for event := range New(settings).StreamResponses(ctx, settings, []Message{{Role: RoleUser, Content: "fixture"}}, []ToolDefinition{PlanToolDefinition()}) {
							switch event.Kind {
							case EventResponse, EventFinish, EventDone, EventRetry:
								t.Fatalf("failed terminal published success or retry: %+v", event)
							case EventUsage:
								usagesSeen++
								usage = event.Usage
							case EventError:
								errorsSeen++
								failure = event.Err
							}
						}
						wantUsages := 0
						if known {
							wantUsages = 1
						}
						if errorsSeen != 1 || usagesSeen != wantUsages {
							t.Fatalf("terminal receipts: errors=%d usages=%d", errorsSeen, usagesSeen)
						}
					}
					assertResponsesFailedError(t, failure, kind)
					assertResponsesFailedUsage(t, usage, known)
					if requests.Load() != 1 {
						t.Fatalf("classification increased HTTP requests: %d", requests.Load())
					}
				})
			}
		}
	}
}

func TestResponsesFailedEnvelopePrefersProviderError(t *testing.T) {
	for _, raw := range []json.RawMessage{json.RawMessage(`{"type":"function_call","arguments":7}`), json.RawMessage(`{"type":"custom_tool_call"}`)} {
		envelope := responsesFailedFixture("fixture_error", false)
		envelope["output"] = []json.RawMessage{raw}
		data, err := json.Marshal(envelope)
		if err != nil {
			t.Fatal(err)
		}
		var decoded responseEnvelope
		if err := json.Unmarshal(data, &decoded); err != nil {
			t.Fatal(err)
		}
		message, err := decoded.message()
		var api *APIError
		if !errors.As(err, &api) || api.StatusCode != 0 || api.Code != "server_error" || api.Type != "fixture_error" || api.Message != responsesFailedMessage || api.Transient {
			t.Fatalf("failed output masked the provider error or invented HTTP status: %v %+v", err, api)
		}
		if len(message.ToolCalls) != 0 || len(message.IncompleteTools) != 0 || len(message.ResponseItems) != 0 {
			t.Fatal("failed envelope returned executable output")
		}
		events, err := parseResponseFixture(responseFrame(map[string]any{"type": "response.failed", "response": envelope}))
		if !errors.As(err, &api) || api.Code != "server_error" {
			t.Fatalf("stream masked the provider failure: %v", err)
		}
		for _, event := range events {
			if event.Kind == EventResponse || event.Kind == EventFinish || event.Kind == EventDone || event.Kind == EventUsage {
				t.Fatalf("failed terminal published output or invented usage: %+v", event)
			}
		}
	}
}

func TestResponsesInterleavingAndDoneDeduplication(t *testing.T) {
	args := `{"action":"create","expected_revision":0}`
	// 两个输出交错到达，显示保持输出索引顺序；done 携带全文不能重复追加。
	first := responseFrame(map[string]any{"type": "response.output_text.delta", "sequence_number": 2, "output_index": 0, "item_id": "item_text", "delta": "正"})
	stream := responseFrame(map[string]any{"type": "response.output_item.added", "sequence_number": 1, "output_index": 0, "item": map[string]any{"id": "item_text", "type": "message", "content": []any{}}}) + first + first
	stream += responseFrame(map[string]any{"type": "response.function_call_arguments.delta", "sequence_number": 3, "output_index": 1, "item_id": "item_call", "delta": args[:15]})
	stream += responseFrame(map[string]any{"type": "response.function_call_arguments.delta", "sequence_number": 4, "output_index": 1, "item_id": "item_call", "delta": args[15:]})
	stream += responseFrame(map[string]any{"type": "response.output_text.done", "output_index": 0, "item_id": "item_text", "text": "正文"})
	stream += responseFrame(map[string]any{"type": "response.output_text.done", "output_index": 0, "item_id": "item_text", "text": "正文"})
	stream += responseFrame(map[string]any{"type": "response.output_item.done", "output_index": 0, "item": responseTextItem("正文")})
	stream += responseFrame(map[string]any{"type": "response.function_call_arguments.done", "output_index": 1, "item_id": "item_call", "arguments": args})
	stream += terminalFrame("completed", responseTextItem("正文"), responseCall(args))
	events, err := parseResponseFixture(stream)
	if err != nil {
		t.Fatal(err)
	}
	text := ""
	responses, done := 0, 0
	for _, e := range events {
		switch e.Kind {
		case EventDelta:
			text += e.Text
		case EventResponse:
			responses++
			if len(e.Message.ToolCalls) != 1 || len(e.Message.ResponseItems) != 2 {
				t.Fatal("lost output/call")
			}
		case EventDone:
			done++
		case EventUsage:
			if e.Usage.PromptCacheHitTokens != 70 || e.Usage.CompletionTokensDetails.ReasoningTokens != 8 {
				t.Fatal("usage mapping")
			}
		}
	}
	if text != "正文" || responses != 1 || done != 1 {
		t.Fatalf("duplicate or missing output: %q %d %d", text, responses, done)
	}
}
func TestResponsesRejectCorruptOrUnfinishedTools(t *testing.T) {
	args := `{"action":"create","expected_revision":0}`
	delta := func(index int, text string) string {
		return responseFrame(map[string]any{"type": "response.output_text.delta", "output_index": index, "item_id": "item_text", "delta": text})
	}
	cases := map[string]string{
		"eof":               responseFrame(map[string]any{"type": "response.function_call_arguments.delta", "output_index": 0, "delta": args}),
		"invalid-json":      "data: {broken}\n\n",
		"failed":            terminalFrame("failed", responseCall(args)),
		"truncated-args":    terminalFrame("completed", responseCall(`{"action":`)),
		"missing-item":      delta(4, "已收到") + terminalFrame("completed", responseCall(args)),
		"duplicate-call":    terminalFrame("completed", responseCall(args), responseCall(args)),
		"changed-call-id":   responseFrame(map[string]any{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"type": "function_call", "id": "item_call", "call_id": "different", "name": "update_plan", "arguments": ""}}) + terminalFrame("completed", responseCall(args)),
		"sequence-conflict": responseFrame(map[string]any{"type": "response.created", "sequence_number": 1}) + responseFrame(map[string]any{"type": "response.in_progress", "sequence_number": 1}),
		"sequence-reverse":  responseFrame(map[string]any{"type": "response.created", "sequence_number": 2}) + responseFrame(map[string]any{"type": "response.in_progress", "sequence_number": 1}),
	}
	for name, stream := range cases {
		t.Run(name, func(t *testing.T) {
			events, err := parseResponseFixture(stream)
			if err == nil {
				t.Fatal("corrupt stream accepted")
			}
			for _, e := range events {
				if e.Kind == EventResponse || e.Kind == EventDone {
					t.Fatal("unfinished tool exposed as executable")
				}
			}
		})
	}
	events, err := parseResponseFixture(terminalFrame("incomplete", responseCall(args)))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range events {
		if e.Message != nil && (len(e.Message.ToolCalls) > 0 || len(e.Message.ResponseItems) > 0 || e.Message.FinishReason != "length") {
			t.Fatal("incomplete response exposed tools")
		}
	}
}

func TestResponsesRetainTerminalUsageOnFailure(t *testing.T) {
	reasoning := rawJSON(map[string]any{"type": "reasoning", "id": "reason_1", "status": "completed", "summary": []any{}})
	startedMessage := responseFrame(map[string]any{"type": "response.output_item.added", "output_index": 1, "item": map[string]any{"type": "message", "id": "item_text", "role": "assistant", "status": "in_progress", "content": []any{}}})
	cases := map[string]string{
		"incomplete-missing-started-message": startedMessage + terminalFrame("incomplete", reasoning),
		"failed":                             terminalFrame("failed", responseCall(`{}`)),
		"invalid-tool":                       terminalFrame("completed", responseCall(`{"action":`)),
	}
	for name, stream := range cases {
		t.Run(name, func(t *testing.T) {
			events, err := parseResponseFixture(stream)
			if err == nil {
				t.Fatal("invalid response accepted")
			}
			usages := 0
			for _, event := range events {
				if event.Kind == EventResponse || event.Kind == EventFinish || event.Kind == EventDone {
					t.Fatal("failed response exposed a completed result")
				}
				if event.Kind == EventUsage {
					usages++
					if event.Usage == nil || event.Usage.PromptTokens != 100 || event.Usage.CompletionTokens != 20 || event.Usage.TotalTokens != 120 || event.Usage.PromptCacheHitTokens != 70 || event.Usage.CompletionTokensDetails.ReasoningTokens != 8 {
						t.Fatalf("lost terminal usage: %+v", event.Usage)
					}
				}
			}
			if usages != 1 {
				t.Fatalf("want one actual usage receipt, got %d", usages)
			}
		})
	}
	for name, stream := range map[string]string{
		"missing-terminal":  startedMessage,
		"mismatched-status": responseFrame(map[string]any{"type": "response.completed", "response": map[string]any{"status": "failed", "usage": map[string]int{"input_tokens": 100, "output_tokens": 20}}}),
	} {
		t.Run(name, func(t *testing.T) {
			events, err := parseResponseFixture(stream)
			if err == nil {
				t.Fatal("invalid terminal accepted")
			}
			for _, event := range events {
				if event.Kind == EventUsage {
					t.Fatal("usage claimed without a valid terminal envelope")
				}
			}
		})
	}
}

func TestResponsesObservedFailureRetainsUsage(t *testing.T) {
	for _, stream := range []bool{true, false} {
		t.Run(fmt.Sprint(stream), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				frame := terminalFrame("failed")
				if stream {
					w.Header().Set("Content-Type", "text/event-stream")
					fmt.Fprint(w, frame)
				} else {
					var event map[string]json.RawMessage
					json.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(frame, "data: "))), &event)
					w.Header().Set("Content-Type", "application/json")
					w.Write(event["response"])
				}
			}))
			defer server.Close()
			settings := Defaults()
			settings.APIKey, settings.BaseURL, settings.Stream = "sk-test", server.URL, boolRef(stream)
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			answer, usage, err := completeAgent(ctx, New(settings), settings, []Message{{Role: RoleUser, Content: "hi"}}, nil)
			if err == nil || answer.Content != "" || len(answer.ToolCalls) != 0 {
				t.Fatalf("failed response exposed as success: %+v %v", answer, err)
			}
			if usage == nil || usage.PromptTokens != 100 || usage.CompletionTokens != 20 {
				t.Fatalf("observed failure lost supplier usage: %+v", usage)
			}
		})
	}
}
func TestResponsesRequestReplayAndSnapshot(t *testing.T) {
	s := Defaults()
	s.APIKey = "sk-test"
	s.TopP = .9
	s.MaxTokens = 1234
	s.UserID = " test-user "
	raw := rawJSON(map[string]any{"type": "reasoning", "id": "reason_1", "content": []any{map[string]string{"type": "reasoning_text", "text": "exact reasoning"}}, "future_metadata": true})
	messages := []Message{{Role: RoleSystem, Content: "external prompt"}, {Role: RoleUser, Content: "question"}, {Role: RoleAssistant, Content: "render copy", ResponseItems: []json.RawMessage{raw, responseCall(`{}`)}}, {Role: RoleTool, ToolCallID: "call_1", Content: `{"ok":true}`}}
	req := BuildResponsesRequest(s, messages, true, []ToolDefinition{PlanToolDefinition()})
	if len(req.Input) != 5 || string(req.Input[2]) != string(raw) || req.Reasoning.Effort != Defaults().ReasoningEffort || req.ToolChoice != "auto" || req.Temperature != nil || req.TopP != nil || req.User != "test-user" {
		t.Fatal("request mapping/replay invalid")
	}
	body, _ := json.Marshal(req)
	for _, bad := range []string{`"messages"`, `"max_tokens"`, `"stream_options"`, `"thinking"`, `"reasoning_effort"`} {
		if strings.Contains(string(body), bad) {
			t.Fatalf("legacy field %s leaked", bad)
		}
	}
	captured := make(chan ResponsesRequest, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/responses" {
			t.Errorf("wrong endpoint: %s", r.URL.Path)
		}
		var got ResponsesRequest
		json.NewDecoder(r.Body).Decode(&got)
		captured <- got
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, terminalFrame("completed", responseTextItem("ok")))
	}))
	defer srv.Close()
	s.BaseURL = srv.URL
	s.Stream = boolRef(true)
	old := s.Model
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	events := New(s).StreamResponses(ctx, s, messages, []ToolDefinition{PlanToolDefinition()})
	s.Model = ModelV4Pro
	messages[2].ResponseItems[0][0] = 'x'
	for e := range events {
		if e.Err != nil {
			t.Fatal(e.Err)
		}
	}
	got := <-captured
	if got.Model != old || !json.Valid(got.Input[2]) {
		t.Fatal("request read mutable settings/messages after returning")
	}
}
func boolRef(v bool) *bool { return &v }
func TestResponsesNonstreamingAndCancellation(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprint(stream), func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if stream {
					w.Header().Set("Content-Type", "text/event-stream")
					fmt.Fprint(w, "event: response.created\ndata: {\"type\":\"response.created\"}\n\n")
					w.(http.Flusher).Flush()
					<-r.Context().Done()
					return
				}
				json.NewEncoder(w).Encode(map[string]any{"id": "r1", "status": "completed", "output": []json.RawMessage{responseTextItem("完整正文")}})
			}))
			defer srv.Close()
			s := Defaults()
			s.BaseURL = srv.URL
			s.APIKey = "sk-test"
			s.Stream = boolRef(stream)
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			defer cancel()
			var kinds []EventKind
			for e := range New(s).StreamResponses(ctx, s, []Message{{Role: RoleUser, Content: "test"}}, nil) {
				kinds = append(kinds, e.Kind)
				if stream && e.Message != nil {
					t.Fatal("cancelled response ready")
				}
				if !stream && e.Err != nil {
					t.Fatal(e.Err)
				}
			}
			if !stream && !reflect.DeepEqual(kinds, []EventKind{EventReasoning, EventDelta, EventUsage, EventResponse, EventFinish, EventDone}) {
				t.Fatal(kinds)
			}
		})
	}
}

func replayTextEvent(kind string, output, part int, id, text string) string {
	value := map[string]any{"type": kind, "output_index": output, "content_index": part, "item_id": id}
	if strings.HasSuffix(kind, ".delta") {
		value["delta"] = text
	} else {
		value["text"] = text
	}
	return responseFrame(value)
}

func TestResponsesAuthoritativeTextReplay(t *testing.T) {
	for _, sample := range []struct {
		name, delta, full string
		corrections       int
	}{
		{"identical", "正文", "正文", 0},
		{"whitespace-and-paragraphs", "第一段 \n\n 第二段", "第一段\n第二段", 1},
		{"shortened", "全文带着多余尾巴", "全文", 1},
		{"empty-final", "将被撤回", "", 1},
	} {
		t.Run(sample.name, func(t *testing.T) {
			w := &Workspace{live: map[string]WorkspaceLive{}}
			w.taskRequestStart(WorkspaceMatrix, 9, true)
			stream := replayTextEvent("response.output_text.delta", 0, 0, "item_text", sample.delta)
			stream += replayTextEvent("response.output_text.done", 0, 0, "item_text", sample.full)
			stream += replayTextEvent("response.output_text.done", 0, 0, "item_text", sample.full)
			stream += terminalFrame("completed", responseTextItem(sample.full), responseCall(`{"action":"create"}`))
			var complete *Message
			corrections, warnings, done := 0, 0, 0
			err := readResponseStream(strings.NewReader(stream), func(event Event) error {
				before := w.live[WorkspaceMatrix]
				w.taskStream(WorkspaceMatrix, 9, event)
				if event.Kind == EventTextCorrection {
					corrections++
					if w.live[WorkspaceMatrix].Text != sample.full {
						t.Fatal("replacement did not reach live snapshot", w.live[WorkspaceMatrix])
					}
					if before.StreamBodyParts[0].Text != sample.delta {
						t.Fatal("correction mutated old snapshot")
					}
				}
				if event.Kind == EventWarn {
					warnings++
					if strings.Contains(event.Err.Error(), sample.delta) || strings.Contains(event.Err.Error(), "已停止执行工具") {
						t.Fatal("diagnostic leaked text or claimed tool failure", event.Err)
					}
				}
				if event.Kind == EventResponse {
					complete = event.Message
				}
				if event.Kind == EventDone {
					done++
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			if complete == nil || complete.Content != sample.full || len(complete.ToolCalls) != 1 || done != 1 || corrections != sample.corrections || warnings != sample.corrections {
				t.Fatalf("wrong final result: complete=%+v done=%d corrections=%d warnings=%d", complete, done, corrections, warnings)
			}
			if v := w.live[WorkspaceMatrix]; v.Text != sample.full || v.Phase != "settled" {
				t.Fatal(v)
			}
		})
	}
}

func TestResponsesSummaryRewriteDoesNotRestartActivity(t *testing.T) {
	for _, hidden := range []bool{false, true} {
		w := &Workspace{live: map[string]WorkspaceLive{}}
		w.taskRequestStart(WorkspaceMatrix, 1, !hidden)
		reason := rawJSON(map[string]any{"id": "reason", "type": "reasoning", "summary": []any{map[string]any{"type": "summary_text", "text": "最终公开摘要"}}})
		stream := replayTextEvent("response.reasoning_summary_text.delta", 0, 0, "reason", "初步公开摘要")
		stream += replayTextEvent("response.reasoning_summary_text.done", 0, 0, "reason", "done摘要")
		stream += terminalFrame("completed", reason, responseTextItem("正文"))
		corrections := 0
		if err := readResponseStream(strings.NewReader(stream), func(event Event) error {
			before := w.live[WorkspaceMatrix]
			w.taskStream(WorkspaceMatrix, 1, event)
			if event.Kind == EventTextCorrection {
				corrections++
				v := w.live[WorkspaceMatrix]
				if v.Phase != before.Phase || v.ReasoningStartedAt != before.ReasoningStartedAt {
					t.Fatal("correction restarted activity", before, v)
				}
				if hidden && v.Thought != "" || !hidden && v.Thought != event.Text {
					t.Fatal("incorrect public summary", v)
				}
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		if corrections != 2 {
			t.Fatal("lost done/terminal correction", corrections)
		}
		if v := w.live[WorkspaceMatrix]; v.Text != "正文" || v.Phase != "settled" || len(v.ReasoningHistory) != 1 {
			t.Fatal(v)
		}
	}
}

func TestResponsesCorrectionsRetainOtherOutputParts(t *testing.T) {
	first := rawJSON(map[string]any{"type": "message", "id": "first", "content": []any{map[string]any{"type": "output_text", "text": "甲"}}})
	last := rawJSON(map[string]any{"type": "message", "id": "last", "content": []any{map[string]any{"type": "output_text", "text": "乙"}}})
	stream := replayTextEvent("response.output_text.delta", 0, 0, "first", "旧甲")
	stream += replayTextEvent("response.output_text.delta", 1, 0, "last", "乙")
	stream += responseFrame(map[string]any{"type": "response.output_item.done", "output_index": 0, "item": rawJSON(map[string]any{"type": "message", "id": "first", "content": []any{map[string]any{"type": "output_text", "text": "旧甲"}}})})
	stream += terminalFrame("completed", first, last)
	w := &Workspace{live: map[string]WorkspaceLive{}}
	w.taskRequestStart(WorkspaceMatrix, 2, true)
	if err := readResponseStream(strings.NewReader(stream), func(e Event) error { w.taskStream(WorkspaceMatrix, 2, e); return nil }); err != nil {
		t.Fatal(err)
	}
	if v := w.live[WorkspaceMatrix]; v.Text != "甲乙" || v.Phase != "settled" {
		t.Fatal("older body correction lost newer output", v)
	}
	encoded, _ := json.Marshal(w.live[WorkspaceMatrix])
	if strings.Contains(string(encoded), "StreamBodyParts") || strings.Contains(string(encoded), "ContentIndex") {
		t.Fatal("internal parts leaked into UI protocol", string(encoded))
	}
}

func TestResponsesMergedFinalPartsAndLateDisplayDelta(t *testing.T) {
	stream := replayTextEvent("response.output_text.delta", 0, 0, "item_text", "甲")
	stream += replayTextEvent("response.output_text.done", 0, 0, "item_text", "甲")
	stream += replayTextEvent("response.output_text.delta", 0, 1, "item_text", "乙")
	stream += replayTextEvent("response.output_text.done", 0, 1, "item_text", "乙")
	stream += replayTextEvent("response.output_text.delta", 0, 1, "item_text", "迟到的显示分片")
	stream += terminalFrame("completed", responseTextItem("甲\n乙"))
	w := &Workspace{live: map[string]WorkspaceLive{}}
	w.taskRequestStart(WorkspaceMatrix, 1, true)
	if err := readResponseStream(strings.NewReader(stream), func(e Event) error { w.taskStream(WorkspaceMatrix, 1, e); return nil }); err != nil {
		t.Fatal(err)
	}
	if v := w.live[WorkspaceMatrix]; v.Text != "甲\n乙" || v.Phase != "settled" {
		t.Fatal("merged final parts duplicated stale text", v)
	}
}

func TestResponsesFinalMissingUnsentPartDoesNotBlockLaterBody(t *testing.T) {
	first := rawJSON(map[string]any{"type": "message", "id": "first", "content": []any{map[string]any{"type": "output_text", "text": "甲"}}})
	last := rawJSON(map[string]any{"type": "message", "id": "last", "content": []any{map[string]any{"type": "output_text", "text": "乙"}}})
	stream := replayTextEvent("response.output_text.delta", 0, 0, "first", "甲")
	stream += replayTextEvent("response.output_text.delta", 0, 2, "first", "最终被合并的未显示分片")
	stream += terminalFrame("completed", first, last)
	w := &Workspace{live: map[string]WorkspaceLive{}}
	w.taskRequestStart(WorkspaceMatrix, 1, true)
	if err := readResponseStream(strings.NewReader(stream), func(e Event) error { w.taskStream(WorkspaceMatrix, 1, e); return nil }); err != nil {
		t.Fatal(err)
	}
	if v := w.live[WorkspaceMatrix]; v.Text != "甲乙" || v.Phase != "settled" {
		t.Fatal("sparse final display part blocked later body", v)
	}
}

func TestResponsesConflictingArgumentsStillRejectTools(t *testing.T) {
	stream := responseFrame(map[string]any{"type": "response.function_call_arguments.delta", "output_index": 0, "item_id": "item_call", "delta": `{"action":"create"}`})
	stream += terminalFrame("completed", responseCall(`{"action":"delete"}`))
	events, err := parseResponseFixture(stream)
	if err == nil || !strings.Contains(err.Error(), "工具") || !strings.Contains(err.Error(), "已停止执行工具") {
		t.Fatal("conflicting arguments accepted", err)
	}
	for _, event := range events {
		if event.Kind == EventResponse || event.Kind == EventDone {
			t.Fatal("conflicting tool exposed")
		}
	}
}

func TestResponsesStaleCorrectionCannotRestoreInvalidatedBody(t *testing.T) {
	w := &Workspace{live: map[string]WorkspaceLive{}}
	w.taskRequestStart(WorkspaceMatrix, 3, true)
	a := codec.NewResponseDecoder(func(e Event) error { w.taskStream(WorkspaceMatrix, 3, e); return nil })
	for _, payload := range []string{
		`{"type":"response.output_text.delta","output_index":0,"item_id":"body","delta":"旧文"}`,
		`{"type":"response.reasoning_summary_text.delta","output_index":1,"item_id":"reason","delta":"当前摘要"}`,
		`{"type":"response.output_text.done","output_index":0,"item_id":"body","text":"纠正后的旧文"}`,
	} {
		if _, err := a.Feed(payload, ""); err != nil {
			t.Fatal(err)
		}
	}
	if v := w.live[WorkspaceMatrix]; v.Text != "" || v.Thought != "当前摘要" || v.Phase != "thinking" {
		t.Fatal("old correction restored invalidated body", v)
	}
	index, part := 1, 2048
	w.taskStream(WorkspaceMatrix, 2, Event{Kind: EventTextCorrection, CorrectionKind: EventReasoning, OutputIndex: &index, ContentIndex: &part, Text: "旧代"})
	if w.live[WorkspaceMatrix].Thought != "当前摘要" {
		t.Fatal("old generation correction leaked")
	}
}
