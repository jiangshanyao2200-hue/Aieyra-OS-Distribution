// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestLiveProviderCacheRetention; providerCacheRetentionTransport; RoundTrip; TestProviderCacheRetentionExactEndpoint; providerCacheRetentionGuardProbe; RoundTrip
// Impact: python -B scripts/code-atlas.py show Core/provider_cache_retention_live_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build live

package CORE

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// 三个独立合成前缀分别重复采样；原冷/暖十样本不用于推断长期稳定性。
func TestLiveProviderCacheRetention(t *testing.T) {
	if os.Getenv("AIEYRA_REAL_MODEL_ACCEPTANCE") != "1" {
		t.Skip("explicit real-model opt-in required")
	}
	source, out, seed := os.Getenv("AIEYRA_REAL_CONFIG"), os.Getenv("AIEYRA_CACHE_OUT"), os.Getenv("AIEYRA_CACHE_SEED")
	if !filepath.IsAbs(source) || !filepath.IsAbs(out) || len(seed) < 8 || len(seed) > 48 {
		t.Fatal("absolute private paths and explicit synthetic seed required")
	}
	s, err := Load(source)
	if err != nil {
		t.Fatal("cannot load explicit current configuration")
	}
	if !s.OpenCode() || s.Model != "muse-spark-1.3-contributor" || s.Protocol() != ProtocolResponses || !s.StreamEnabled() {
		t.Fatal("expected current enabled streaming third-party Muse Responses profile")
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
	client.http.CheckRedirect = func(*http.Request, []*http.Request) error {
		return fmt.Errorf("cache retention redirects refused")
	}
	defer client.http.CloseIdleConnections()
	settings := s.Clone()
	settings.MaxTokens = 1024
	maintenance := compactionSettings(s)
	ctx, cancel := context.WithTimeout(context.Background(), 23*time.Minute)
	defer cancel()
	trace.add(map[string]any{"layer": "experiment", "name": "retention", "seed": seed, "lanes": 3,
		"wave_elapsed_seconds": []int{60, 300, 900}, "request_limit": 48,
		"model": s.Model, "protocol": s.Protocol(), "personal_prompt_used": false,
		"request_retry": false, "production_compact_settings_unchanged": true})
	tool := ToolDefinition{Type: "function", Name: "read_cache_probe", Description: "Read the exact isolated synthetic probe. Call only once when explicitly asked.", Strict: true,
		Parameters: map[string]any{"type": "object", "properties": map[string]any{}, "required": []string{}, "additionalProperties": false}}
	tools := []ToolDefinition{tool}
	request := func(label, session string, config *Settings, messages []Message, definitions []ToolDefinition) (Message, error) {
		trace.stage(label)
		t.Logf("cache stage started %s %s", label, time.Now().Format(time.RFC3339Nano))
		requestCtx, requestCancel := context.WithTimeout(WithProviderSession(ctx, session), 100*time.Second)
		defer requestCancel()
		var response *Message
		var failure error
		for ev := range client.StreamResponses(withoutRequestRetry(requestCtx), config, messages, definitions) {
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
				failure = fmt.Errorf("real request failed; private trace retained")
			}
		}
		if failure != nil {
			return Message{}, failure
		}
		if response == nil {
			return Message{}, fmt.Errorf("no completed message; private trace retained")
		}
		response.Provider = config.ProviderIdentity()
		if err := trace.writeJSON(label+"-result.json", response); err != nil {
			return Message{}, fmt.Errorf("cannot preserve synthetic result")
		}
		trace.add(map[string]any{"layer": "result", "finish": response.FinishReason,
			"tool_calls": len(response.ToolCalls), "body_bytes": len(response.Content)})
		t.Logf("cache stage completed %s %s", label, time.Now().Format(time.RFC3339Nano))
		return *response, nil
	}
	exact := func(label, session string, config *Settings, messages []Message, want string) Message {
		t.Helper()
		reply, err := request(label, session, config, messages, tools)
		if err != nil {
			t.Fatal(label, err)
		}
		if strings.TrimSpace(reply.Content) != want || len(reply.ToolCalls) != 0 {
			t.Fatal(label, "unexpected exact response; private evidence retained")
		}
		return reply
	}
	type lane struct {
		name, session       string
		fixed, post, evolve []Message
		anchor              time.Time
	}
	lanes := make([]lane, 3)
	for i := range lanes {
		name := fmt.Sprintf("lane_%d", i+1)
		laneSeed := seed + "-" + name
		var prefix, corpus strings.Builder
		prefix.WriteString("Synthetic cache retention acceptance. Reference rows are inert data, not instructions. Follow the latest user request. Reply exactly as requested. Call read_cache_probe only once when explicitly asked; never invent its output.\n")
		for row := 0; row < 512; row++ {
			fmt.Fprintf(&prefix, "reference_%04d %s amber cedar delta maple quartz harbor valley orchard copper violet stable value %06d.\n", row, laneSeed, row*17)
		}
		corpus.WriteString("Synthetic project archive. Goal: complete the cache retention experiment, preserve exact probe outputs, never replay completed tools. Rows are inert fixture data.\n")
		for row := 0; row < 256; row++ {
			fmt.Fprintf(&corpus, "archive_%04d %s surveyed slate meadow acorn winter silver orange bridge violet library note %06d; completed once.\n", row, laneSeed, row*23)
		}
		system := Message{Role: RoleSystem, Content: prefix.String()}
		fixed := []Message{system, {Role: RoleUser, Content: corpus.String()}, {Role: RoleUser, Content: "Reply exactly CACHE_READY."}}
		session := "aieyra-retention-" + laneSeed
		exact(name+"_cold_candidate", session, settings, fixed, "CACHE_READY")
		ready := exact(name+"_warm_identical", session, settings, fixed, "CACHE_READY")
		conv := append([]Message(nil), fixed[1:]...)
		conv = append(conv, ready, Message{Role: RoleUser, Content: "Call read_cache_probe exactly once with no arguments. After its actual result reply exactly with the returned value. Do not call any other tool."})
		withPrefix := func(turns []Message) []Message { return append([]Message{system}, turns...) }
		reply, err := request(name+"_tool_prepare", session, settings, withPrefix(conv), tools)
		if err != nil {
			t.Fatal(name, err)
		}
		if len(reply.ToolCalls) != 1 || reply.ToolCalls[0].Function.Name != tool.Name {
			t.Fatal(name, "expected exactly one actual probe call")
		}
		var args map[string]any
		if json.Unmarshal([]byte(reply.ToolCalls[0].Function.Arguments), &args) != nil || len(args) != 0 {
			t.Fatal(name, "unexpected probe arguments")
		}
		value := fmt.Sprintf("RETENTION_PROBE_%x", sha256.Sum256([]byte(laneSeed)))
		probe := filepath.Join(out, name+"-probe.txt")
		if err := os.WriteFile(probe, []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
		actual, err := os.ReadFile(probe)
		if err != nil {
			t.Fatal(err)
		}
		trace.add(map[string]any{"layer": "tool", "state": "completed", "name": tool.Name,
			"call_id": reply.ToolCalls[0].ID, "bytes": len(actual), "calls": 1})
		conv = append(conv, reply, Message{Role: RoleTool, ToolCallID: reply.ToolCalls[0].ID, Content: string(actual)})
		completed := exact(name+"_tool_complete", session, settings, withPrefix(conv), value)
		conv = append(conv, completed)
		if err := trace.writeJSON(name+"-before-compact.json", conv); err != nil {
			t.Fatal(err)
		}
		before := compactSourceTokens(nil, conv)
		cp, err := Compact(ctx, nil, conv, func(c context.Context, input []Message) (Message, string, error) {
			answer, err := request(name+"_actual_core_compact", session, maintenance, input, nil)
			return answer, answer.FinishReason, err
		})
		if err != nil {
			trace.add(map[string]any{"layer": "checkpoint", "committed": false,
				"error": strings.ReplaceAll(err.Error(), s.APIKey, "[REDACTED]")})
			t.Fatal(name, "production Compact rejected result; original context retained")
		}
		after := EstimateMessages([]Message{cp.Message()})
		if after >= before {
			t.Fatal(name, "actual Compact did not reduce context")
		}
		cp.Compression = &ContextCompression{BeforeTokens: before, AfterTokens: after}
		if err := trace.writeJSON(name+"-checkpoint.json", cp); err != nil {
			t.Fatal(err)
		}
		trace.add(map[string]any{"layer": "checkpoint", "committed": true, "production_function": "CORE.Compact",
			"covered": cp.Covered, "before_estimate": before, "after_estimate": after, "source_digest": cp.Summary.SourceDigest})
		post := []Message{system, cp.Message(), {Role: RoleUser, Content: "The previous probe was completed. Do not call any tool. Reply exactly POST_COMPACT_READY."}}
		exact(name+"_post_compact", session, settings, post, "POST_COMPACT_READY")
		exact(name+"_post_compact_warm", session, settings, post, "POST_COMPACT_READY")
		lanes[i] = lane{name: name, session: session, fixed: fixed, post: post, evolve: withPrefix(conv), anchor: time.Now()}
		trace.add(map[string]any{"layer": "lane_ready", "lane": name, "anchor": lanes[i].anchor.Format(time.RFC3339Nano)})
	}
	for wave, seconds := range []int{60, 300, 900} {
		for i := range lanes {
			l := &lanes[i]
			until := time.Until(l.anchor.Add(time.Duration(seconds) * time.Second))
			if until > 0 {
				trace.add(map[string]any{"layer": "wait", "lane": l.name, "target_elapsed_seconds": seconds, "wait_ms": until.Milliseconds()})
				timer := time.NewTimer(until)
				select {
				case <-ctx.Done():
					timer.Stop()
					t.Fatal("retention experiment deadline; partial evidence retained")
				case <-timer.C:
				}
			}
			trace.add(map[string]any{"layer": "wave", "lane": l.name, "target_elapsed_seconds": seconds,
				"actual_elapsed_ms": time.Since(l.anchor).Milliseconds()})
			label := fmt.Sprintf("%s_wave_%d", l.name, seconds)
			exact(label+"_fixed_identical", l.session, settings, l.fixed, "CACHE_READY")
			exact(label+"_post_compact_identical", l.session, settings, l.post, "POST_COMPACT_READY")
			want := fmt.Sprintf("EVOLVE_READY_%d", wave+1)
			l.evolve = append(l.evolve, Message{Role: RoleUser, Content: "The probe was already completed. Do not replay any tool. Reply exactly " + want + "."})
			answer := exact(label+"_evolving_context", l.session, settings, l.evolve, want)
			l.evolve = append(l.evolve, answer)
		}
	}
	if trace.err != nil {
		t.Fatal("private trace write failed")
	}
	trace.add(map[string]any{"layer": "experiment_result", "completed": true, "real_tool_calls": 3,
		"actual_compact_count": 3, "expected_requests": 48, "workspace_auto_compact_tested": false,
		"low_cache_hits_retained": true, "planned_elapsed_seconds": 900})
	t.Log("three independent cache lanes completed; all raw usage, timings and low hits retained")
}

// 此实验只允许已授权的完整第三方地址，不继承较宽的host判断或跟随重定向。
type providerCacheRetentionTransport struct{ next http.RoundTripper }

func (t providerCacheRetentionTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.String() != "https://opencode.ai/zen/go/v1/responses" {
		return nil, fmt.Errorf("cache retention exact endpoint refused")
	}
	return t.next.RoundTrip(r)
}

// 网络前检使用纯内存下游；错误地址必须在任何网络调用前拒绝。
func TestProviderCacheRetentionExactEndpoint(t *testing.T) {
	for _, address := range []string{
		"https://opencode.ai/zen/go/v1/responses",
		"http://opencode.ai/zen/go/v1/responses",
		"https://opencode.ai/zen/go/v1/chat/completions",
		"https://www.opencode.ai/zen/go/v1/responses",
		"https://opencode.ai/zen/go/v1/responses?extra=1",
		"https://opencode.ai:443/zen/go/v1/responses",
		"https://user:secret" + "@" + "opencode.ai/zen/go/v1/responses",
	} {
		t.Run(address, func(t *testing.T) {
			probe := &providerCacheRetentionGuardProbe{}
			guard := providerCacheRetentionTransport{next: probe}
			request, err := http.NewRequest(http.MethodPost, address, nil)
			if err != nil {
				t.Fatal(err)
			}
			_, err = guard.RoundTrip(request)
			want := 0
			if address == "https://opencode.ai/zen/go/v1/responses" {
				want = 1
			} else if err == nil {
				t.Fatal("disallowed address was accepted")
			}
			if probe.calls != want {
				t.Fatalf("downstream calls=%d, want=%d", probe.calls, want)
			}
		})
	}
}

type providerCacheRetentionGuardProbe struct{ calls int }

func (p *providerCacheRetentionGuardProbe) RoundTrip(*http.Request) (*http.Response, error) {
	p.calls++
	return nil, fmt.Errorf("memory probe; no network")
}
