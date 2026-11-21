// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestLiveProviderCacheRetentionContinuation
// Impact: python -B scripts/code-atlas.py show Core/provider_cache_retention_continuation_live_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build live

package CORE

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// 继续未取得的保留间隔样本，复用原请求字节；不重做工具与 Compact。
func TestLiveProviderCacheRetentionContinuation(t *testing.T) {
	if os.Getenv("AIEYRA_REAL_MODEL_ACCEPTANCE") != "1" {
		t.Skip("explicit real-model opt-in required")
	}
	source, original, out := os.Getenv("AIEYRA_REAL_CONFIG"), os.Getenv("AIEYRA_CACHE_ORIGINAL"), os.Getenv("AIEYRA_CACHE_OUT")
	if !filepath.IsAbs(source) || !filepath.IsAbs(original) || !filepath.IsAbs(out) {
		t.Fatal("absolute explicit private paths required")
	}
	s, err := Load(source)
	if err != nil || !s.OpenCode() || s.Model != "muse-spark-1.3-contributor" || s.Protocol() != ProtocolResponses || !s.StreamEnabled() {
		t.Fatal("expected current enabled third-party Muse streaming Responses configuration")
	}
	if err := os.Mkdir(out, 0700); err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(filepath.Join(out, "trace.jsonl"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	trace := &providerCacheTrace{start: time.Now(), encoder: json.NewEncoder(f), out: out}
	client := New(s)
	base := client.http.Transport
	if base == nil {
		base = http.DefaultTransport
	}
	client.http.Transport = providerCacheRetentionTransport{next: &providerCacheTransport{base: base, trace: trace, key: s.APIKey}}
	client.http.CheckRedirect = func(*http.Request, []*http.Request) error { return fmt.Errorf("cache continuation redirects refused") }
	client.http.Timeout = 0
	defer client.http.CloseIdleConnections()
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
	defer cancel()
	var experiment struct {
		Seed string `json:"seed"`
	}
	input, err := os.ReadFile(filepath.Join(original, "trace.jsonl"))
	if err != nil {
		t.Fatal("cannot read original private trace")
	}
	first := bytes.SplitN(input, []byte("\n"), 2)[0]
	if json.Unmarshal(first, &experiment) != nil || !strings.HasPrefix(experiment.Seed, "retention-") {
		t.Fatal("invalid original synthetic experiment")
	}
	trace.add(map[string]any{"layer": "experiment", "name": "retention_continuation", "seed": experiment.Seed,
		"maximum_requests": 15, "source_request_bytes_preserved": true, "request_retry": false,
		"real_tool_calls": 0, "actual_compact_count": 0, "idle_target_seconds": 300,
		"scope": "original fixed, post-compact and retained-context bytes after a long gap; fixed/post again after at least 300 seconds idle"})
	request := func(label, lane, pattern, want string) {
		t.Helper()
		matches, err := filepath.Glob(filepath.Join(original, pattern))
		if err != nil || len(matches) != 1 {
			t.Fatal("original request must have exactly one evidence file")
		}
		raw, err := os.ReadFile(matches[0])
		if err != nil || bytes.Contains(raw, []byte(s.APIKey)) {
			t.Fatal("invalid original synthetic request body")
		}
		var body map[string]any
		if json.Unmarshal(raw, &body) != nil || body["model"] != s.Model || body["stream"] != true {
			t.Fatal("original request model/stream mismatch")
		}
		trace.stage(label)
		trace.add(map[string]any{"layer": "source_request", "file": filepath.Base(matches[0]), "lane": lane})
		t.Logf("cache continuation started %s %s", label, time.Now().Format(time.RFC3339Nano))
		requestCtx, requestCancel := context.WithTimeout(WithProviderSession(ctx, "aieyra-retention-"+experiment.Seed+"-"+lane), 100*time.Second)
		defer requestCancel()
		req, err := http.NewRequestWithContext(requestCtx, http.MethodPost, client.baseURL+"/responses", bytes.NewReader(raw))
		if err != nil {
			t.Fatal("cannot construct exact captured request")
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "text/event-stream")
		client.providerHeaders(req)
		response, err := client.http.Do(req)
		if err != nil {
			trace.add(map[string]any{"layer": "core", "kind": EventError, "error": strings.ReplaceAll(err.Error(), s.APIKey, "[REDACTED]")})
			t.Fatal(label, "captured request failed; evidence retained")
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			trace.add(map[string]any{"layer": "core", "kind": EventError, "error": "HTTP request failed", "status": response.StatusCode})
			t.Fatal(label, "HTTP failure; evidence retained")
		}
		var message *Message
		err = readResponseStream(response.Body, func(ev Event) error {
			row := map[string]any{"layer": "core", "kind": ev.Kind, "text_bytes": len(ev.Text), "reasoning_kind": ev.ReasoningKind}
			if ev.Usage != nil {
				row["usage"] = ev.Usage
			}
			if ev.Kind == EventResponse && ev.Message != nil {
				copy := *ev.Message
				message = &copy
			}
			trace.add(row)
			return requestCtx.Err()
		})
		if err != nil || message == nil {
			trace.add(map[string]any{"layer": "core", "kind": EventError, "error": "response did not complete"})
			t.Fatal(label, "response did not complete; evidence retained")
		}
		if len(message.ToolCalls) != 0 || strings.TrimSpace(message.Content) != want {
			t.Fatal(label, "unexpected response; tools were not executed")
		}
		message.Provider = s.ProviderIdentity()
		if err := trace.writeJSON(label+"-result.json", message); err != nil {
			t.Fatal("cannot preserve completed synthetic message")
		}
		trace.add(map[string]any{"layer": "result", "finish": message.FinishReason,
			"tool_calls": len(message.ToolCalls), "body_bytes": len(message.Content)})
		t.Logf("cache continuation completed %s %s", label, time.Now().Format(time.RFC3339Nano))
	}
	for i := 1; i <= 3; i++ {
		lane := fmt.Sprintf("lane_%d", i)
		request(lane+"_continuation_long_gap_fixed", lane, "*-"+lane+"_cold_candidate-request.json", "CACHE_READY")
		request(lane+"_continuation_long_gap_post", lane, "*-"+lane+"_post_compact-request.json", "POST_COMPACT_READY")
		request(lane+"_continuation_long_gap_retained_context", lane, "*-"+lane+"_wave_60_evolving_context-request.json", "EVOLVE_READY_1")
	}
	// 所有种子的再次固定采样在末次完整响应后至少空闲五分钟；记录真实间隔。
	anchor := time.Now()
	trace.add(map[string]any{"layer": "idle_anchor", "anchor": anchor.Format(time.RFC3339Nano)})
	timer := time.NewTimer(300 * time.Second)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		t.Fatal("continuation deadline; partial evidence retained")
	case <-timer.C:
	}
	for i := 1; i <= 3; i++ {
		lane := fmt.Sprintf("lane_%d", i)
		request(lane+"_continuation_idle_300_fixed", lane, "*-"+lane+"_cold_candidate-request.json", "CACHE_READY")
		request(lane+"_continuation_idle_300_post", lane, "*-"+lane+"_post_compact-request.json", "POST_COMPACT_READY")
	}
	if trace.err != nil {
		t.Fatal("private trace write failed")
	}
	trace.add(map[string]any{"layer": "experiment_result", "completed": true, "expected_requests": 15,
		"real_tool_calls": 0, "actual_compact_count": 0, "low_cache_hits_retained": true})
}
