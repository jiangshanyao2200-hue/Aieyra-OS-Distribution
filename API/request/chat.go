// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/request/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Thinking; ResponseFormat; StreamOptions; ChatRequest; BuildChat; TextOnly; withoutExtraContent; runtimeSystemAsUser; mergeLeadingSystem
// Impact: python -B scripts/code-atlas.py show API/request/chat.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package request

import "strings"

// Thinking 对应官方的 thinking 对象。
type Thinking struct {
	Type string `json:"type"`
	// ReasoningEffort 控制思考强度。官方映射：minimal→low，medium/xhigh→high，ultra→max。
	ReasoningEffort string `json:"reasoning_effort,omitempty"`
}

// ResponseFormat 控制输出格式。
type ResponseFormat struct {
	Type string `json:"type"`
}

// StreamOptions 仅在 stream=true 时允许出现。
type StreamOptions struct {
	IncludeUsage bool `json:"include_usage"`
}

// ChatRequest 是一次 /chat/completions 请求体。
//
// 采样参数默认交给供应商；旧配置可读，但当前构造器不发送这些字段。
type ChatRequest struct {
	textOnly bool
	extra    map[string]any
	// 构造请求时读取快照，序列化/重试不再触碰图片文件或活动设置。
	imageMessages []any
	// Some thinking endpoints require this key even when a prior assistant
	// turn returned no reasoning. Keep the wire requirement out of archives.
	requireReasoningContent bool
	Model                   string    `json:"model"`
	Messages                []Message `json:"messages"`

	Thinking *Thinking `json:"thinking,omitempty"`
	// ReasoningEffort 同时放在顶层，兼容只识别顶层字段的旧版 SDK 形态。
	ReasoningEffort string `json:"reasoning_effort,omitempty"`

	MaxTokens int  `json:"max_tokens,omitempty"`
	Stream    bool `json:"stream,omitempty"`

	ResponseFormat *ResponseFormat `json:"response_format,omitempty"`

	// Legacy serialized shape; BuildRequest leaves sampling fields unset.
	Temperature *float64 `json:"temperature,omitempty"`
	TopP        *float64 `json:"top_p,omitempty"`

	Stop []string `json:"stop,omitempty"`

	StreamOptions *StreamOptions `json:"stream_options,omitempty"`

	Provider *struct {
		RequireParameters bool `json:"require_parameters"`
	} `json:"provider,omitempty"`
	UserID     string               `json:"user_id,omitempty"`
	Tools      []ChatToolDefinition `json:"tools,omitempty"`
	ToolChoice string               `json:"tool_choice,omitempty"`
}

// BuildRequest 把配置翻译成请求体。
//
// 旧采样值不会发送；思考控制仍遵循当前协议的官方字段。
func BuildChat(s Profile, messages []Message, stream bool, resolve ResolveImages) *ChatRequest {
	messages = labelRuntimeObservations(messages)
	if s.TextOnly {
		s.SupportsImages = false
	}
	messages = mergeLeadingSystem(messages)
	var imageMessages []any
	if s.SupportsImages && s.Protocol == ProtocolChat {
		imageMessages = chatImages(messages, resolve)
	}
	// 会话保存的 Responses 元数据不属于 Chat Completions 消息字段。
	if messages != nil {
		messages = append([]Message(nil), messages...)
		for i := range messages {
			// OpenCode Chat上游不接受内部消息标签；仅移除传输副本中的name。
			if s.OpenCode {
				messages[i].Name = ""
			}
			if len(messages[i].Images) > 0 {
				if !s.SupportsImages {
					messages[i].Content += s.UnsupportedImageText
				}
				messages[i].Images = nil
			}
			messages[i].ResponseItems = nil
			messages[i].IncompleteTools = nil
			messages[i].ResponseID = ""
			sameProvider := messages[i].Provider == s.Provider
			messages[i].NativeContent = nil
			messages[i].RouterReasoning = ""
			if !sameProvider || !s.OpenRouter {
				messages[i].ReasoningDetails = nil
			}
			if messages[i].Provider != "" && !sameProvider || s.Generic && (!sameProvider || s.ReasoningField != "reasoning_content") {
				messages[i].ReasoningContent = ""
			}
			if !sameProvider {
				messages[i].ToolCalls = withoutExtraContent(messages[i].ToolCalls)
			}
			messages[i].Provider = ""
		}
	}
	if s.Generic {
		messages = runtimeSystemAsUser(messages)
	}
	req := &ChatRequest{
		textOnly:                s.TextOnly,
		extra:                   cloneOptions(s.Extra),
		Model:                   s.Model,
		Messages:                messages,
		imageMessages:           imageMessages,
		Stream:                  stream,
		requireReasoningContent: !s.Generic && s.ThinkingEnabled || s.Generic && s.ReasoningField == "reasoning_content",
	}

	if s.Generic {
		if s.OpenRouter {
			req.Provider = &struct {
				RequireParameters bool `json:"require_parameters"`
			}{true}
		}
		if s.MaxTokens > 0 {
			req.MaxTokens = s.MaxTokens
		}
		if s.ResponseFormat == "json_object" {
			req.ResponseFormat = &ResponseFormat{Type: "json_object"}
		}
		if stream && s.IncludeUsage {
			req.StreamOptions = &StreamOptions{IncludeUsage: true}
		}
		return req
	}
	thinking := &Thinking{Type: s.ThinkingType}
	if s.ThinkingEnabled {
		effort := s.ReasoningEffort
		thinking.ReasoningEffort = effort
		req.ReasoningEffort = effort
	}
	req.Thinking = thinking

	if s.MaxTokens > 0 {
		req.MaxTokens = s.MaxTokens
	}
	if s.ResponseFormat == "json_object" {
		req.ResponseFormat = &ResponseFormat{Type: "json_object"}
	}
	if strings.TrimSpace(s.UserID) != "" {
		req.UserID = strings.TrimSpace(s.UserID)
	}
	if stream && s.IncludeUsage {
		req.StreamOptions = &StreamOptions{IncludeUsage: true}
	}

	return req
}

func (r *ChatRequest) TextOnly() bool { return r != nil && r.textOnly }

// 换了供应商，上一家的签名没有意义，发过去还可能被拒。
func withoutExtraContent(calls []ToolCall) []ToolCall {
	out := calls
	for i := range calls {
		if len(calls[i].ExtraContent) == 0 {
			continue
		}
		if &out[0] == &calls[0] {
			out = append([]ToolCall(nil), calls...)
		}
		out[i].ExtraContent = nil
	}
	return out
}

// 对话之后插入的 system（时钟、工具箱说明、运行提示）改成带标记的 user，位置和内容不变，与原生协议一致。
// 中转把 Chat 里所有 system 并进 Gemini 的系统指令，每分钟一变的时钟让整个前缀失效
// （2026-11-04 真实用量：gemini-4-argon-high 跨分钟的请求 0 命中，同一分钟内命中 96–98%）。
func runtimeSystemAsUser(messages []Message) []Message {
	var out []Message
	started := false
	for i, m := range messages {
		if m.Role != RoleSystem {
			started = true
			continue
		}
		if !started {
			continue
		}
		if out == nil {
			out = append([]Message(nil), messages...)
		}
		out[i].Role = RoleUser
		if !m.ContextObservation || m.Name == "" {
			out[i].Content = "[Aieyra runtime context]\n" + m.Content
		}
	}
	if out == nil {
		return messages
	}
	return out
}

// 开头连续的多条 system 合成一条（2026-10-10 多模型实验台：百炼 qwen3.8-flash 把第 2 条起的 system
// 当成用户这一轮的话，回答“链路通了”而不去做任务）。语义和顺序不变，只改传输副本；后面插入的 system 不动。
func mergeLeadingSystem(messages []Message) []Message {
	n := 0
	for n < len(messages) && messages[n].Role == RoleSystem && len(messages[n].Images) == 0 {
		n++
	}
	if n < 2 {
		return messages
	}
	parts := make([]string, 0, n)
	for _, m := range messages[:n] {
		if strings.TrimSpace(m.Content) != "" {
			parts = append(parts, m.Content)
		}
	}
	merged := messages[0]
	merged.Content = strings.Join(parts, "\n\n")
	return append([]Message{merged}, messages[n:]...)
}
