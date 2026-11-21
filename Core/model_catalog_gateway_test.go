// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestGatewayThinkingFollowsMeasuredContract; TestGatewayGeminiParallelToolsAfterEarlyFinish
// Impact: python -B scripts/code-atlas.py show Core/model_catalog_gateway_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"strings"
	"testing"
)

// 2026-11-04 对 fast.aieyra.cn 的实测：Gemini 只认 Google 的 thinking_level，
// GLM/Qwen 认 reasoning_effort，Claude 别名固定高档、任何思考字段都不起作用。
func TestGatewayThinkingFollowsMeasuredContract(t *testing.T) {
	cases := []struct {
		model, protocol string
		options         map[string]any
		check           func(map[string]any) bool
	}{
		{"gemini-4-argon-high", ProtocolChat, map[string]any{"reasoning_effort": "low"}, func(b map[string]any) bool {
			return b["reasoning_effort"] == nil && string(rawJSON(b["extra_body"])) == `{"google":{"thinking_config":{"thinking_level":"low"}}}`
		}},
		{"gemini-4-argon-high", ProtocolChat, nil, func(b map[string]any) bool {
			return string(rawJSON(b["extra_body"])) == `{"google":{"thinking_config":{"thinking_level":"high"}}}`
		}},
		{"glm-5.3", ProtocolChat, map[string]any{"reasoning_effort": "max"}, func(b map[string]any) bool { return b["reasoning_effort"] == "max" }},
		{"Qwen3.8-Flash-Next", ProtocolChat, nil, func(b map[string]any) bool { return b["reasoning_effort"] == "high" }},
		{"claude-opus-5-5-high", ProtocolChat, nil, func(b map[string]any) bool {
			return b["reasoning_effort"] == nil && b["thinking"] == nil && b["extra_body"] == nil
		}},
	}
	for _, c := range cases {
		s := catalogGeminiFixture()
		s.APIProfiles[0].Model, s.APIProfiles[0].Protocol = c.model, c.protocol
		s.ModelOptions = c.options
		s.applyPoolProfile()
		if c.options != nil {
			s.ModelOptions = c.options
		}
		raw, _ := json.Marshal(BuildRequest(s, nil, true))
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		if !c.check(body) {
			t.Fatalf("%s %v wire = %s", c.model, c.options, raw)
		}
	}
	p := catalogGeminiFixture().APIProfiles[0]
	p.Model, p.Protocol, p.ContextWindowSource = "claude-opus-5-5-high", ProtocolChat, "conservative_client_budget"
	upgradeCatalogProfile(&p)
	if p.ContextWindow != 200000 {
		t.Fatal("gateway Claude placeholder window not upgraded", p.ContextWindow)
	}
}

// 网关转出的 Gemini 并行工具调用：finish_reason 夹在第二、第三个调用之间（2026-11-04 实测原样）。
func TestGatewayGeminiParallelToolsAfterEarlyFinish(t *testing.T) {
	chunk := func(body string) string { return "data: " + body + "\n\n" }
	stream := chunk(`{"id":"g1","choices":[{"index":0,"delta":{"content":"","role":"assistant","tool_calls":[{"index":0,"id":"c0","type":"function","function":{"name":"read_file","arguments":"{\"path\":\"C:/example/a.txt\"}"}}]},"finish_reason":null}]}`) +
		chunk(`{"id":"g1","choices":[{"index":0,"delta":{"content":"","tool_calls":[{"index":1,"id":"c1","type":"function","function":{"name":"read_file","arguments":"{\"path\":\"C:/example/b.txt\"}"}}]},"finish_reason":"tool_calls"}]}`) +
		chunk(`{"id":"g1","choices":[{"index":0,"delta":{"content":"","tool_calls":[{"index":2,"id":"c2","type":"function","function":{"name":"list_dir","arguments":"{\"path\":\"C:/example/\"}"}}]},"finish_reason":null}]}`) +
		chunk(`{"id":"g1","choices":[{"index":0,"delta":{"content":""},"finish_reason":"tool_calls"}]}`) +
		"data: [DONE]\n\n"
	var m Message
	finishes := 0
	if err := readChatTools(strings.NewReader(stream), func(e Event) error {
		if e.Message != nil {
			m = *e.Message
		}
		if e.Kind == EventFinish {
			finishes++
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if len(m.ToolCalls) != 3 || m.ToolCalls[2].Function.Name != "list_dir" || m.FinishReason != "tool_calls" || finishes != 1 {
		t.Fatalf("calls=%d finish=%q events=%d", len(m.ToolCalls), m.FinishReason, finishes)
	}
	// 响应身份变化仍然拒绝。
	mixed := chunk(`{"id":"g1","choices":[{"index":0,"delta":{"content":"a"},"finish_reason":"stop"}]}`) + chunk(`{"id":"g2","choices":[{"index":0,"delta":{"content":"b"}}]}`) + "data: [DONE]\n\n"
	if err := readChatTools(strings.NewReader(mixed), func(Event) error { return nil }); err == nil {
		t.Fatal("a second response was merged")
	}
	// 网关尾部无实质增量的 finish/usage 收尾帧若漂移了 chunk.ID，不应误杀已生成的工具调用。
	qwenTailDrift := chunk(`{"id":"q1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"project","arguments":"{\"action\":\"map_read\"}"}}]},"finish_reason":null}]}`) +
		chunk(`{"id":"q2","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`) +
		chunk(`{"id":"q3","choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}}`) +
		"data: [DONE]\n\n"
	var qm Message
	if err := readChatTools(strings.NewReader(qwenTailDrift), func(e Event) error {
		if e.Message != nil {
			qm = *e.Message
		}
		return nil
	}); err != nil {
		t.Fatalf("tail id drift falsely rejected: %v", err)
	}
	if qm.ResponseID != "q1" || len(qm.ToolCalls) != 1 || qm.ToolCalls[0].Function.Name != "project" {
		t.Fatalf("unexpected qwen message: %+v", qm)
	}
}
