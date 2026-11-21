// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: liveSettings; TestLiveStreamBasic; TestLiveReasoning; TestLiveThinkingModeIgnoresTemperature; TestLiveMultiTurn; TestLiveUnknownModelIsRejected; TestLiveLegacyModelNameStillServed; TestLiveBadKeyIsRejected; TestLiveJSONMode
// Impact: python -B scripts/code-atlas.py show Core/api_live_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build live

// 真实 API 集成测试。默认不参与 go test ./...，需要显式开启：
//
//	go test -tags live ./Core/ -run TestLive -v
//
// 凭据来源优先级：环境变量 DEEPSEEK_API_KEY，其次用户配置目录中的 config.json。
// 该测试会计费（极少），请勿放进 CI 的默认流程。
package CORE

import (
	"context"
	"strings"
	"testing"
	"time"
)

func liveSettings(t *testing.T, model string) *Settings {
	t.Helper()
	s, err := Load(ResolvePath(""))
	if err != nil {
		t.Fatalf("加载配置失败：%v", err)
	}
	if strings.TrimSpace(s.APIKey) == "" {
		t.Skip("未找到 API Key（DEEPSEEK_API_KEY 或 json），跳过实测")
	}
	s.Model = model
	s.RequestTimeout = 120
	return s
}

// TestLiveStreamBasic 验证流式链路：正文能收到、[DONE] 能正常收尾。
func TestLiveStreamBasic(t *testing.T) {
	s := liveSettings(t, ModelFlash)
	s.ThinkingType = "disabled"

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	client := New(s)
	var sb strings.Builder
	sawDone := false
	var usage *Usage
	for ev := range client.Stream(ctx, s, []Message{{Role: RoleUser, Content: "只回答两个字：你好"}}) {
		switch ev.Kind {
		case EventDelta:
			sb.WriteString(ev.Text)
		case EventUsage:
			usage = ev.Usage
		case EventDone:
			sawDone = true
		case EventError:
			t.Fatalf("流式出错：%v", ev.Err)
		}
	}
	if !sawDone {
		t.Error("未收到 [DONE]")
	}
	if strings.TrimSpace(sb.String()) == "" {
		t.Error("正文为空")
	}
	if usage == nil {
		t.Error("未收到 usage（stream_options.include_usage 应已开启）")
	} else {
		t.Logf("用量：%s", usage.String())
	}
	t.Logf("回复：%s", sb.String())
}

// TestLiveReasoning 验证思考模式能返回 reasoning_content。
func TestLiveReasoning(t *testing.T) {
	s := liveSettings(t, ModelV4Pro)
	s.ThinkingType = "enabled"
	s.ReasoningEffort = "low"

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	client := New(s)
	var reason, content strings.Builder
	for ev := range client.Stream(ctx, s, []Message{{Role: RoleUser, Content: "1+1 等于几？"}}) {
		switch ev.Kind {
		case EventReasoning:
			reason.WriteString(ev.Text)
		case EventDelta:
			content.WriteString(ev.Text)
		case EventError:
			t.Fatalf("流式出错：%v", ev.Err)
		}
	}
	if strings.TrimSpace(reason.String()) == "" {
		t.Error("思考模式下应返回 reasoning_content")
	}
	if strings.TrimSpace(content.String()) == "" {
		t.Error("正文为空")
	}
	t.Logf("思考 %d 字，正文 %d 字", len([]rune(reason.String())), len([]rune(content.String())))
}

// TestLiveThinkingModeIgnoresTemperature 验证官方语义：
// 思考模式下传入 temperature 不报错，但通过「同一问题多次采样是否高度一致」难以断言，
// 因此这里只验证请求被接受且能正常返回，确保我们发送的参数组合合法。
func TestLiveThinkingModeIgnoresTemperature(t *testing.T) {
	s := liveSettings(t, ModelV4Pro)
	s.ThinkingType = "enabled"
	s.ReasoningEffort = "low"
	s.Temperature = 0.1
	s.TopP = 0.5 // 旧采样配置不再发送

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	client := New(s)
	req := BuildRequest(s, []Message{{Role: RoleUser, Content: "说“收到”"}}, true)
	if req.Temperature != nil {
		t.Fatal("思考模式不应把 temperature 放进请求体")
	}
	if req.TopP != nil {
		t.Fatalf("旧 top_p 不应发送，实际 %v", req.TopP)
	}

	var got string
	for ev := range client.Stream(ctx, s, []Message{{Role: RoleUser, Content: "说“收到”"}}) {
		switch ev.Kind {
		case EventDelta:
			got += ev.Text
		case EventError:
			t.Fatalf("请求被拒绝：%v", ev.Err)
		}
	}
	if strings.TrimSpace(got) == "" {
		t.Error("正文为空")
	}
}

// TestLiveMultiTurn 验证多轮对话拼接：第二轮能记住第一轮的内容。
func TestLiveMultiTurn(t *testing.T) {
	s := liveSettings(t, ModelFlash)
	s.ThinkingType = "disabled"

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	client := New(s)

	msgs := []Message{
		{Role: RoleSystem, Content: "你是一个简洁的助手，回答不超过 10 个字。"},
		{Role: RoleUser, Content: "记住这个数字：4271"},
	}
	first, _, err := client.Complete(ctx, s, msgs)
	if err != nil {
		t.Fatalf("第一轮失败：%v", err)
	}
	t.Logf("第一轮：%s", first.Content)

	msgs = append(msgs, Message{Role: RoleAssistant, Content: first.Content})
	msgs = append(msgs, Message{Role: RoleUser, Content: "我刚让你记的数字是多少？只回答数字。"})

	second, _, err := client.Complete(ctx, s, msgs)
	if err != nil {
		t.Fatalf("第二轮失败：%v", err)
	}
	if !strings.Contains(second.Content, "4271") {
		t.Errorf("多轮上下文似乎丢失，第二轮回复：%q", second.Content)
	}
	t.Logf("第二轮：%s", second.Content)
}

// TestLiveUnknownModelIsRejected 验证真正的非法模型名会得到可读错误与提示。
func TestLiveUnknownModelIsRejected(t *testing.T) {
	s := liveSettings(t, ModelFlash)
	s.Model = "definitely-not-a-deepseek-model"

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	_, err := New(s).Ping(ctx, s.Model)
	if err == nil {
		t.Fatal("非法模型名应返回错误")
	}
	if _, ok := err.(*APIError); !ok {
		t.Fatalf("应为 *APIError，实际 %T：%v", err, err)
	}
	t.Logf("错误：%v", err)
}

// TestLiveLegacyModelNameStillServed 记录一个实测结论：
// 旧模型名 deepseek-chat 目前仍可调用（官方保持向后兼容，由在售模型接管），
// 因此本地配置校验才把它拦下，避免用户在界面上选到一个文档里已不存在的名字。
func TestLiveLegacyModelNameStillServed(t *testing.T) {
	s := liveSettings(t, "deepseek-chat")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	client := New(s)
	if _, err := client.Ping(ctx, "deepseek-chat"); err != nil {
		t.Skipf("旧模型名已被拒绝（%v）——说明官方已彻底下线，可考虑移除本用例", err)
	}
	t.Log("实测：deepseek-chat 仍可调用（向后兼容），但已不在官方文档在售清单中")

	// 同一把 Key 也能调用新模型名，确认是模型别名而非特例。
	if _, err := client.Ping(ctx, ModelFlash); err != nil {
		t.Errorf("新模型名 deepseek-flash 应可用：%v", err)
	}
}

// TestLiveBadKeyIsRejected 验证鉴权失败路径能拿到 401 与提示。
func TestLiveBadKeyIsRejected(t *testing.T) {
	s := liveSettings(t, ModelFlash)
	s.APIKey = "sk-invalid-key-for-testing-000000000000"

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	_, err := New(s).Ping(ctx, s.Model)
	if err == nil {
		t.Fatal("非法 Key 应返回错误")
	}
	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("应为 *APIError，实际 %T：%v", err, err)
	}
	if apiErr.StatusCode != 401 {
		t.Errorf("期望 401，实际 %d", apiErr.StatusCode)
	}
	if !strings.Contains(apiErr.Hint(), "API配置") {
		t.Errorf("401 应提示检查配置，实际 %q", apiErr.Hint())
	}
}

// TestLiveJSONMode 验证 response_format=json_object 能拿到可解析的 JSON。
func TestLiveJSONMode(t *testing.T) {
	s := liveSettings(t, ModelFlash)
	s.ThinkingType = "disabled"
	s.ResponseFormat = "json_object"

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	msgs := []Message{
		{Role: RoleSystem, Content: "你必须只输出 JSON，格式为 {\"city\": string, \"population\": number}。"},
		{Role: RoleUser, Content: "给出杭州的信息。"},
	}
	msg, _, err := New(s).Complete(ctx, s, msgs)
	if err != nil {
		t.Fatalf("JSON 模式失败：%v", err)
	}
	trimmed := strings.TrimSpace(msg.Content)
	if !strings.HasPrefix(trimmed, "{") || !strings.HasSuffix(trimmed, "}") {
		t.Errorf("JSON 模式应返回 JSON 对象，实际：%q", trimmed)
	}
	t.Logf("JSON：%s", trimmed)
}
