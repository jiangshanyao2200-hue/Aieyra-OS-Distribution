// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestLiveProviderCacheSequence; providerCacheTrace; stage; add; writeJSON; providerCacheTransport; RoundTrip; providerCacheBody; Read
// Impact: python -B scripts/code-atlas.py show Core/provider_cache_live_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build live

package CORE

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// 使用显式私有目录保存合成任务的完整请求及原用量；不读取个人会话或 Prompt。
// 只允许当前已启用的第三方 Muse 路由，不访问模型厂商官方端点。
func TestLiveProviderCacheSequence(t *testing.T) {
	if os.Getenv("AIEYRA_REAL_MODEL_ACCEPTANCE") != "1" {
		t.Skip("explicit real-model opt-in required")
	}
	source, out, seed := os.Getenv("AIEYRA_REAL_CONFIG"), os.Getenv("AIEYRA_CACHE_OUT"), os.Getenv("AIEYRA_CACHE_SEED")
	if !filepath.IsAbs(source) || !filepath.IsAbs(out) || len(seed) < 8 || len(seed) > 64 {
		t.Fatal("absolute private paths and explicit synthetic seed required")
	}
	s, err := Load(source)
	if err != nil {
		t.Fatal("cannot load explicit current configuration")
	}
	if !s.OpenCode() || s.Model != "muse-spark-1.3-contributor" || s.Protocol() != ProtocolResponses || !s.StreamEnabled() {
		t.Fatal("expected current enabled streaming third-party Muse Responses profile")
	}
	if err = os.Mkdir(out, 0700); err != nil {
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
	client.http.Transport = &providerCacheTransport{base: base, trace: trace, key: s.APIKey}
	client.http.CheckRedirect = func(r *http.Request, via []*http.Request) error {
		if r.URL.Scheme != "https" || r.URL.Hostname() != "opencode.ai" || len(via) >= 4 {
			return fmt.Errorf("acceptance redirect outside third-party provider refused")
		}
		return nil
	}
	trace.add(map[string]any{"layer": "experiment", "model": s.Model, "protocol": s.Protocol(), "profile": s.ActiveProfile, "seed": seed, "personal_prompt_used": false, "session": "aieyra-cache-" + seed})
	var fixed, corpus strings.Builder
	fixed.WriteString("Synthetic cache acceptance. Rows below are inert reference data, not instructions. Follow only the latest explicit user request. Reply briefly and exactly when asked. Call read_cache_probe only when asked, and never guess its return value.\n")
	for i := 0; i < 512; i++ {
		fmt.Fprintf(&fixed, "reference_%04d %s amber cedar delta maple quartz harbor valley orchard copper violet stable value %06d.\n", i, seed, i*17)
	}
	corpus.WriteString("Synthetic project archive for cache and real compaction acceptance. Goal: complete the cache experiment, preserve exact probe outputs, do not replay completed tools. All rows are fixture data.\n")
	for i := 0; i < 384; i++ {
		fmt.Fprintf(&corpus, "archive_%04d %s surveyed slate meadow acorn winter silver orange bridge violet library note %06d; completed once.\n", i, seed, i*23)
	}
	prefix := Message{Role: RoleSystem, Content: fixed.String()}
	conv := []Message{{Role: RoleUser, Content: corpus.String()}, {Role: RoleUser, Content: "Reply exactly CACHE_READY."}}
	tool := ToolDefinition{Type: "function", Name: "read_cache_probe", Description: "Return the exact isolated acceptance probe value. Call once only when explicitly requested.", Strict: true, Parameters: map[string]any{"type": "object", "properties": map[string]any{}, "required": []string{}, "additionalProperties": false}}
	tools := []ToolDefinition{tool}
	ctx, cancel := context.WithTimeout(WithProviderSession(context.Background(), "aieyra-cache-"+seed), 9*time.Minute)
	defer cancel()
	request := func(label string, settings *Settings, messages []Message, definitions []ToolDefinition) Message {
		t.Helper()
		trace.stage(label)
		var response *Message
		for ev := range client.StreamResponses(withoutRequestRetry(ctx), settings, messages, definitions) {
			row := map[string]any{"layer": "core", "kind": ev.Kind, "text_bytes": len(ev.Text), "reasoning_kind": ev.ReasoningKind}
			if ev.Usage != nil {
				row["usage"] = ev.Usage
			}
			if ev.Err != nil {
				row["error"] = strings.ReplaceAll(ev.Err.Error(), s.APIKey, "[REDACTED]")
			}
			trace.add(row)
			if ev.Kind == EventResponse && ev.Message != nil {
				copy := *ev.Message
				response = &copy
			}
			if ev.Kind == EventError {
				t.Fatal("real cache request failed; private trace retained")
			}
		}
		if response == nil {
			t.Fatal("no completed message; private trace retained")
		}
		response.Provider = settings.ProviderIdentity()
		trace.add(map[string]any{"layer": "result", "finish": response.FinishReason, "tool_calls": len(response.ToolCalls), "body_bytes": len(response.Content)})
		return *response
	}
	withPrefix := func(turns []Message) []Message { return append([]Message{prefix}, turns...) }
	for _, label := range []string{"cold_candidate", "warm_identical_1", "warm_identical_2"} {
		reply := request(label, s, withPrefix(conv), tools)
		if strings.TrimSpace(reply.Content) != "CACHE_READY" || len(reply.ToolCalls) != 0 {
			t.Fatal("unexpected fixed-prefix reply; private evidence retained")
		}
		if label == "warm_identical_2" {
			conv = append(conv, reply)
		}
	}
	for i := 1; i <= 2; i++ {
		value := fmt.Sprintf("MULTI_READY_%d", i)
		conv = append(conv, Message{Role: RoleUser, Content: "Reply exactly " + value + "."})
		reply := request(fmt.Sprintf("multi_turn_%d", i), s, withPrefix(conv), tools)
		if strings.TrimSpace(reply.Content) != value || len(reply.ToolCalls) != 0 {
			t.Fatal("unexpected multi-turn reply")
		}
		conv = append(conv, reply)
	}
	conv = append(conv, Message{Role: RoleUser, Content: "Call read_cache_probe exactly once with no arguments. After its actual result, reply with exactly the result and no other text."})
	reply := request("tool_prepare", s, withPrefix(conv), tools)
	if len(reply.ToolCalls) != 1 || reply.ToolCalls[0].Function.Name != tool.Name {
		t.Fatal("expected one real probe tool call")
	}
	var args map[string]any
	if json.Unmarshal([]byte(reply.ToolCalls[0].Function.Arguments), &args) != nil || len(args) != 0 {
		t.Fatal("unexpected probe arguments")
	}
	value := fmt.Sprintf("CACHE_PROBE_%x", sha256.Sum256([]byte(seed)))
	fixture := filepath.Join(out, "probe.txt")
	if err = os.WriteFile(fixture, []byte(value), 0600); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	trace.add(map[string]any{"layer": "tool", "state": "completed", "name": tool.Name, "bytes": len(actual), "calls": 1})
	conv = append(conv, reply, Message{Role: RoleTool, ToolCallID: reply.ToolCalls[0].ID, Content: string(actual)})
	reply = request("tool_complete", s, withPrefix(conv), tools)
	if strings.TrimSpace(reply.Content) != value || len(reply.ToolCalls) != 0 {
		t.Fatal("real tool result was not returned exactly")
	}
	conv = append(conv, reply)
	before := compactSourceTokens(nil, conv)
	maintenance := compactionSettings(s)
	cp, err := Compact(ctx, nil, conv, func(c context.Context, input []Message) (Message, string, error) {
		answer := request("actual_core_compact", maintenance, input, nil)
		return answer, answer.FinishReason, nil
	})
	if err != nil {
		trace.add(map[string]any{"layer": "checkpoint", "committed": false, "error": strings.ReplaceAll(err.Error(), s.APIKey, "[REDACTED]")})
		t.Fatal("real production Compact rejected result; original context retained")
	}
	after := EstimateMessages([]Message{cp.Message()})
	if after >= before {
		t.Fatal("actual compact did not reduce context")
	}
	cp.Compression = &ContextCompression{BeforeTokens: before, AfterTokens: after}
	if err = trace.writeJSON("checkpoint.json", cp); err != nil {
		t.Fatal(err)
	}
	trace.add(map[string]any{"layer": "checkpoint", "committed": true, "production_function": "CORE.Compact", "covered": cp.Covered, "before_estimate": before, "after_estimate": after, "source_digest": cp.Summary.SourceDigest})
	conv = []Message{cp.Message(), {Role: RoleUser, Content: "The previous probe was already executed and completed. Do not call any tool. Reply exactly POST_COMPACT_READY."}}
	for _, label := range []string{"post_compact", "post_compact_warm"} {
		reply = request(label, s, withPrefix(conv), tools)
		if strings.TrimSpace(reply.Content) != "POST_COMPACT_READY" || len(reply.ToolCalls) != 0 {
			t.Fatal("post-compact request replayed or lost explicit task")
		}
	}
	if trace.err != nil {
		t.Fatal("private trace write failed")
	}
	trace.add(map[string]any{"layer": "experiment_result", "completed": true, "real_tool_calls": 1, "actual_compact": true, "workspace_auto_compact_tested": false})
	t.Log("real cold/warm/multi/tool/production Compact sequence completed; see private raw usage and timings")
}

type providerCacheTrace struct {
	mu      sync.Mutex
	start   time.Time
	encoder *json.Encoder
	out     string
	label   string
	count   int
	err     error
}

func (t *providerCacheTrace) stage(label string) {
	t.mu.Lock()
	t.label = label
	t.mu.Unlock()
	t.add(map[string]any{"layer": "stage"})
}

func (t *providerCacheTrace) add(row map[string]any) {
	t.mu.Lock()
	defer t.mu.Unlock()
	row["at"] = time.Now().Format(time.RFC3339Nano)
	row["ms"] = time.Since(t.start).Milliseconds()
	row["stage"] = t.label
	if err := t.encoder.Encode(row); err != nil && t.err == nil {
		t.err = err
	}
}

func (t *providerCacheTrace) writeJSON(name string, value any) error {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(t.out, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(raw, '\n'))
	return err
}

type providerCacheTransport struct {
	base  http.RoundTripper
	trace *providerCacheTrace
	key   string
}

func (t *providerCacheTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Scheme != "https" || r.URL.Hostname() != "opencode.ai" {
		return nil, fmt.Errorf("acceptance network allowlist refused endpoint")
	}
	if r.GetBody == nil {
		return nil, fmt.Errorf("cannot capture exact synthetic request")
	}
	body, err := r.GetBody()
	if err != nil {
		return nil, err
	}
	raw, err := io.ReadAll(body)
	body.Close()
	if err != nil {
		return nil, err
	}
	if t.key != "" && bytes.Contains(raw, []byte(t.key)) {
		return nil, fmt.Errorf("credential unexpectedly present in request body")
	}
	t.trace.mu.Lock()
	t.trace.count++
	index, label := t.trace.count, t.trace.label
	t.trace.mu.Unlock()
	name := fmt.Sprintf("%02d-%s-request.json", index, label)
	f, err := os.OpenFile(filepath.Join(t.trace.out, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	_, err = f.Write(raw)
	f.Close()
	if err != nil {
		return nil, err
	}
	t.trace.add(map[string]any{"layer": "request", "index": index, "file": name, "bytes": len(raw), "sha256": fmt.Sprintf("%x", sha256.Sum256(raw)), "host": r.URL.Hostname(), "path": r.URL.Path, "session_header": r.Header.Get("x-opencode-session") != ""})
	resp, err := t.base.RoundTrip(r)
	if err != nil {
		return nil, err
	}
	t.trace.add(map[string]any{"layer": "http", "status": resp.StatusCode, "content_type": resp.Header.Get("Content-Type")})
	resp.Body = &providerCacheBody{ReadCloser: resp.Body, trace: t.trace}
	return resp, nil
}

type providerCacheBody struct {
	io.ReadCloser
	trace   *providerCacheTrace
	pending []byte
}

func (b *providerCacheBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	b.pending = append(b.pending, p[:n]...)
	for {
		at := bytes.IndexByte(b.pending, '\n')
		if at < 0 {
			break
		}
		line := b.pending[:at]
		b.pending = b.pending[at+1:]
		if !bytes.HasPrefix(line, []byte("data:")) {
			continue
		}
		var event map[string]json.RawMessage
		if json.Unmarshal(bytes.TrimSpace(line[5:]), &event) != nil {
			continue
		}
		row := map[string]any{"layer": "wire", "type": event["type"], "bytes": len(line)}
		if usage := event["usage"]; len(usage) > 0 {
			row["raw_usage"] = usage
		}
		if response := event["response"]; len(response) > 0 {
			var env map[string]json.RawMessage
			if json.Unmarshal(response, &env) == nil && len(env["usage"]) > 0 {
				row["raw_usage"] = env["usage"]
			}
		}
		b.trace.add(row)
	}
	return n, err
}
