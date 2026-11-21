// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestUsagePresenceSurvivesWorkerJSONRoundtrip; TestUsageUnknownCacheNeverEntersHitRateDenominator; TestUsageCacheWirePreservesEachFieldIndependently; TestResponsesAndNativeUsagePresence
// Impact: python -B scripts/code-atlas.py show Core/usage_presence_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"testing"
	"time"
)

// 缓存 / 思考用量：显式 0 是“报告了 0”，缺字段或 details={} 是未知；
// 经 worker JSON 往返（Marshal 再 Unmarshal）后两者都不能互相冒充。
func TestUsagePresenceSurvivesWorkerJSONRoundtrip(t *testing.T) {
	cases := []struct {
		name        string
		body        string
		cached      int
		cacheKnown  bool
		reasonKnown bool
	}{
		{"deepseek explicit zero hit", `{"prompt_tokens":100,"completion_tokens":5,"total_tokens":105,"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":100}`, 0, true, false},
		{"deepseek hit", `{"prompt_tokens":100,"completion_tokens":5,"prompt_cache_hit_tokens":64,"prompt_cache_miss_tokens":36}`, 64, true, false},
		{"deepseek miss only is not a hit report", `{"prompt_tokens":100,"completion_tokens":5,"prompt_cache_miss_tokens":100}`, 0, false, false},
		{"qwen details empty", `{"prompt_tokens":100,"completion_tokens":5,"prompt_tokens_details":{},"completion_tokens_details":{}}`, 0, false, false},
		{"qwen details explicit zero", `{"prompt_tokens":100,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":0}}`, 0, true, true},
		{"no cache fields", `{"prompt_tokens":100,"completion_tokens":5}`, 0, false, false},
	}
	for _, c := range cases {
		var first Usage
		if err := json.Unmarshal([]byte(c.body), &first); err != nil {
			t.Fatal(c.name, err)
		}
		wire, err := json.Marshal(struct {
			Usage *Usage `json:"usage,omitempty"`
		}{&first})
		if err != nil {
			t.Fatal(c.name, err)
		}
		var back struct {
			Usage *Usage `json:"usage"`
		}
		if err := json.Unmarshal(wire, &back); err != nil {
			t.Fatal(c.name, err)
		}
		for i, u := range []*Usage{&first, back.Usage} {
			got, known := u.CachedTokens()
			if known != c.cacheKnown || got != c.cached || (u.CompletionTokensDetails != nil) != c.reasonKnown {
				t.Fatalf("%s pass %d: cached=%d known=%v reasoning=%v wire=%s", c.name, i, got, known, u.CompletionTokensDetails != nil, wire)
			}
			if u.PromptTokens != 100 || u.CompletionTokens != 5 {
				t.Fatalf("%s pass %d lost counters: %+v", c.name, i, *u)
			}
			row := agentUsage(1, "model", time.Second, u)
			if (row.Cached != nil) != c.cacheKnown || (row.Reasoning != nil) != c.reasonKnown {
				t.Fatalf("%s pass %d agent usage: %+v", c.name, i, row)
			}
		}
	}
}

func TestUsageUnknownCacheNeverEntersHitRateDenominator(t *testing.T) {
	var known, unknown Usage
	_ = json.Unmarshal([]byte(`{"prompt_tokens":100,"completion_tokens":5,"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":100}`), &known)
	_ = json.Unmarshal([]byte(`{"prompt_tokens":300,"completion_tokens":5,"prompt_tokens_details":{}}`), &unknown)
	report := workspaceUsage([]AgentUsage{agentUsage(1, "model", time.Second, &known), agentUsage(2, "model", time.Second, &unknown)})
	if report["cache_reported"] != 1 || report["cache_input_tokens"] != 100 || report["cached_known"] != false || report["input_tokens"] != 400 {
		t.Fatal(report)
	}
}

func TestUsageCacheWirePreservesEachFieldIndependently(t *testing.T) {
	for _, body := range []string{
		`{"prompt_cache_hit_tokens":0}`,
		`{"prompt_cache_miss_tokens":0}`,
		`{"prompt_cache_hit_tokens":8}`,
		`{"prompt_cache_hit_tokens":null,"prompt_cache_miss_tokens":null}`,
	} {
		var usage Usage
		if err := json.Unmarshal([]byte(body), &usage); err != nil {
			t.Fatal(err)
		}
		wire, err := json.Marshal(usage)
		if err != nil {
			t.Fatal(err)
		}
		var before, after map[string]any
		_ = json.Unmarshal([]byte(body), &before)
		_ = json.Unmarshal(wire, &after)
		for _, key := range []string{"prompt_cache_hit_tokens", "prompt_cache_miss_tokens"} {
			if after[key] != before[key] {
				t.Fatalf("%s changed %s: %s", body, key, wire)
			}
		}
	}
	legacy := Usage{PromptCacheHitTokens: 9}
	wire, _ := json.Marshal(legacy)
	var back Usage
	_ = json.Unmarshal(wire, &back)
	if v, ok := back.CachedTokens(); !ok || v != 9 {
		t.Fatalf("lost legacy literal: %s", wire)
	}
}

func TestResponsesAndNativeUsagePresence(t *testing.T) {
	var env responseEnvelope
	_ = json.Unmarshal([]byte(`{"usage":{"input_tokens":50,"output_tokens":4,"input_tokens_details":{},"output_tokens_details":{}}}`), &env)
	if u := env.usage(); u.PromptTokensDetails != nil || u.CacheHitKnown || u.CompletionTokensDetails != nil {
		t.Fatalf("responses empty details claimed a report: %+v", *u)
	}
	_ = json.Unmarshal([]byte(`{"usage":{"input_tokens":50,"output_tokens":4,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":2}}}`), &env)
	if u := env.usage(); u.PromptTokensDetails == nil || !u.CacheHitKnown || u.CompletionTokensDetails == nil || u.CompletionTokensDetails.ReasoningTokens != 2 {
		t.Fatalf("responses explicit zero cache lost: %+v", *u)
	}
	if u := anthropicUsage(map[string]any{"input_tokens": 10.0, "output_tokens": 2.0}); u.CacheHitKnown {
		t.Fatal("anthropic without cache_read_input_tokens claimed a cache report")
	}
	if u := anthropicUsage(map[string]any{"input_tokens": 10.0, "output_tokens": 2.0, "cache_read_input_tokens": 0.0}); !u.CacheHitKnown || u.PromptCacheMissTokens != 10 {
		t.Fatalf("anthropic explicit zero cache lost: %+v", *u)
	}
	if u := googleUsage(map[string]any{"promptTokenCount": 10.0, "candidatesTokenCount": 2.0}); u.CacheHitKnown {
		t.Fatal("google without cachedContentTokenCount claimed a cache report")
	}
	if u := googleUsage(map[string]any{"promptTokenCount": 10.0, "candidatesTokenCount": 2.0, "cachedContentTokenCount": 6.0}); !u.CacheHitKnown || u.PromptCacheHitTokens != 6 {
		t.Fatalf("google cache lost: %+v", *u)
	}
	// 原生协议换算出的 Usage 经 worker 往返后同样保持。
	native := anthropicUsage(map[string]any{"input_tokens": 10.0, "output_tokens": 2.0, "cache_read_input_tokens": 0.0})
	wire, _ := json.Marshal(native)
	var back Usage
	_ = json.Unmarshal(wire, &back)
	if v, ok := back.CachedTokens(); !ok || v != 0 {
		t.Fatalf("native explicit zero lost in worker JSON: %s", wire)
	}
}
