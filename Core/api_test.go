// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestChatCompatibilityOmitsStoredResponseMetadata; TestDisabledSSEReturnsCompleteReplyAndUsage; TestBuildRequestOmitsDeprecatedParams; TestBuildRequestThinkingMode; TestBuildRequestNonThinkingMode; TestBuildRequestJSONModeAndUserID; TestNewNormalizesBaseURL; TestAPIErrorHint; TestUsageString; TestStreamChunkParsing
// Impact: python -B scripts/code-atlas.py show Core/api_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestChatCompatibilityOmitsStoredResponseMetadata(t *testing.T) {
	messages := []Message{{Role: RoleAssistant, Content: "exact answer", ResponseID: "response1", ResponseItems: []json.RawMessage{json.RawMessage(`{"type":"message"}`)}}}
	req := BuildRequest(Defaults(), messages, false)
	data, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "response_items") || strings.Contains(string(data), "response_id") || req.Messages[0].Content != "exact answer" || messages[0].ResponseID != "response1" {
		t.Fatal("compatibility conversion leaked metadata or mutated session history")
	}
}

func TestDisabledSSEReturnsCompleteReplyAndUsage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req ChatRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Error(err)
		}
		if req.Stream || req.StreamOptions != nil {
			t.Error("关闭 SSE 后仍然发送了流式参数")
		}
		fmt.Fprint(w, `{"choices":[{"message":{"role":"assistant","content":"完整正文","reasoning_content":"推理"},"finish_reason":"stop"}],"usage":{"prompt_tokens":123,"completion_tokens":45}}`)
	}))
	defer srv.Close()
	s := Defaults()
	s.APIProtocol = ProtocolChat
	s.BaseURL = srv.URL
	off := false
	s.Stream = &off
	var text, finish string
	var tokens int
	for ev := range New(s).Stream(context.Background(), s, []Message{{Role: RoleUser, Content: "测试"}}) {
		switch ev.Kind {
		case EventDelta:
			text += ev.Text
		case EventUsage:
			tokens = ev.Usage.PromptTokens
		case EventFinish:
			finish = ev.Finish
		case EventError:
			t.Fatal(ev.Err)
		}
	}
	if text != "完整正文" || finish != "stop" || tokens != 123 {
		t.Fatalf("非 SSE 回复丢失内容或用量: %q %q %d", text, finish, tokens)
	}
}

// TestBuildRequestOmitsDeprecatedParams 锁住「已废弃参数永不发送」这条硬约束。
func TestBuildRequestOmitsDeprecatedParams(t *testing.T) {
	s := Defaults()
	s.APIKey = "sk-test"
	req := BuildRequest(s, []Message{{Role: RoleUser, Content: "hi"}}, true)

	raw, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	body := string(raw)
	for _, banned := range []string{"frequency_penalty", "presence_penalty", "logprobs", "top_logprobs"} {
		if strings.Contains(body, banned) {
			t.Errorf("请求体不应包含已废弃参数 %q：%s", banned, body)
		}
	}
}

// TestBuildRequestThinkingMode 验证思考模式下的参数取舍。
func TestBuildRequestThinkingMode(t *testing.T) {
	s := Defaults()
	s.APIKey = "sk-test"
	s.Model = ModelFlash
	s.ThinkingType = "enabled"
	s.ReasoningEffort = "high"
	s.Temperature = 0.3 // 思考模式下官方不生效，应被丢弃
	s.TopP = 0.5        // 旧采样配置不再发送

	req := BuildRequest(s, []Message{{Role: RoleUser, Content: "hi"}}, true)

	if req.Temperature != nil {
		t.Errorf("思考模式不应发送 temperature，实际 %v", *req.Temperature)
	}
	if req.TopP != nil {
		t.Fatal("思考模式不应发送旧 top_p")
	}
	if req.Thinking == nil || req.Thinking.Type != "enabled" {
		t.Errorf("thinking.type 应为 enabled，实际 %+v", req.Thinking)
	}
	if req.Thinking.ReasoningEffort != "high" || req.ReasoningEffort != "high" {
		t.Errorf("reasoning_effort 应为 high，实际 %q / %q", req.Thinking.ReasoningEffort, req.ReasoningEffort)
	}
	if !req.Stream || req.StreamOptions == nil || !req.StreamOptions.IncludeUsage {
		t.Errorf("流式请求应携带 stream_options.include_usage")
	}
}

// TestBuildRequestNonThinkingMode 验证非思考模式下的参数取舍。
func TestBuildRequestNonThinkingMode(t *testing.T) {
	s := Defaults()
	s.APIKey = "sk-test"
	s.ThinkingType = "disabled"
	s.Temperature = 0.7
	s.TopP = 0.2 // 非思考模式官方恒为 1.0，应被丢弃

	req := BuildRequest(s, []Message{{Role: RoleUser, Content: "hi"}}, false)

	if req.Stream {
		t.Error("非流式请求 stream 应为 false")
	}
	if req.StreamOptions != nil {
		t.Error("非流式请求不应携带 stream_options（官方会返回 400）")
	}
	if req.Temperature != nil {
		t.Errorf("非思考模式不应发送旧 temperature，实际 %v", req.Temperature)
	}
	if req.TopP != nil {
		t.Errorf("非思考模式不应发送 top_p，实际 %v", *req.TopP)
	}
	if req.Thinking != nil && req.Thinking.ReasoningEffort != "" {
		t.Errorf("非思考模式不应发送 reasoning_effort")
	}
}

// TestBuildRequestJSONModeAndUserID 验证输出格式与用户标识映射。
func TestBuildRequestJSONModeAndUserID(t *testing.T) {
	s := Defaults()
	s.APIKey = "sk-test"
	s.ResponseFormat = "json_object"
	s.UserID = "user-42"

	req := BuildRequest(s, []Message{{Role: RoleUser, Content: "hi"}}, true)
	if req.ResponseFormat == nil || req.ResponseFormat.Type != "json_object" {
		t.Errorf("response_format 应为 json_object")
	}
	if req.UserID != "user-42" {
		t.Errorf("user_id 应为 user-42，实际 %q", req.UserID)
	}
}

// TestNewNormalizesBaseURL 验证 Base URL 容错：用户常把完整路径粘进来。
func TestNewNormalizesBaseURL(t *testing.T) {
	cases := map[string]string{
		"https://api.deepseek.com":                       "https://api.deepseek.com/responses",
		"https://api.deepseek.com/":                      "https://api.deepseek.com/responses",
		"https://api.deepseek.com/v1":                    "https://api.deepseek.com/responses",
		"https://api.deepseek.com/chat/completions":      "https://api.deepseek.com/responses",
		" https://api.deepseek.com/v1/chat/completions ": "https://api.deepseek.com/responses",
	}
	for in, want := range cases {
		s := Defaults()
		s.APIKey = "sk-test"
		s.BaseURL = in
		if got := New(s).Endpoint(); got != want {
			t.Errorf("BaseURL %q → %q，期望 %q", in, got, want)
		}
	}
}

// TestAPIErrorHint 保证常见错误码能给出可操作的提示。
func TestAPIErrorHint(t *testing.T) {
	cases := []struct {
		err  *APIError
		want string
	}{
		{&APIError{StatusCode: 401}, "API配置"},
		{&APIError{StatusCode: 402}, "充值"},
		{&APIError{StatusCode: 429}, "限速"},
		{&APIError{StatusCode: 400, Message: "reasoning_content is required"}, "reasoning_content"},
		{&APIError{StatusCode: 400, Message: "Model Not Exist"}, "供应商目录"},
		{&APIError{StatusCode: 400, Message: "Model is unavailable"}, "当前可用性"},
		{&APIError{StatusCode: 404}, "当前供应商"},
	}
	for _, c := range cases {
		if hint := c.err.Hint(); !strings.Contains(hint, c.want) {
			t.Errorf("HTTP %d (%s) 的提示应包含 %q，实际 %q", c.err.StatusCode, c.err.Message, c.want, hint)
		}
	}
}

// TestUsageString 验证用量摘要不会 panic。
func TestUsageString(t *testing.T) {
	u := Usage{PromptTokens: 10, CompletionTokens: 5, TotalTokens: 15, PromptCacheHitTokens: 4}
	if got := u.String(); !strings.Contains(got, "15") {
		t.Errorf("用量摘要应包含总数，实际 %q", got)
	}
	if (Usage{}).String() != "" {
		t.Error("零值用量应渲染为空串")
	}
}

// TestStreamChunkParsing 验证 SSE 分片解析能同时拿到思考链与正文。
func TestStreamChunkParsing(t *testing.T) {
	payload := `{"choices":[{"delta":{"reasoning_content":"思考中","content":"你好"},"finish_reason":null}]}`
	var chunk streamChunk
	if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(chunk.Choices) != 1 {
		t.Fatalf("choices 数量应为 1")
	}
	if chunk.Choices[0].Delta.ReasoningContent != "思考中" {
		t.Errorf("reasoning_content 解析失败：%q", chunk.Choices[0].Delta.ReasoningContent)
	}
	if chunk.Choices[0].Delta.Content != "你好" {
		t.Errorf("content 解析失败：%q", chunk.Choices[0].Delta.Content)
	}
}
