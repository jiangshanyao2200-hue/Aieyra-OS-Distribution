// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Thinking; ResponseFormat; StreamOptions; ChatRequest; BuildRequest; APIError; EventKind; Event; Client; New; NormalizeBaseURL; Endpoint; newRequest; Stream; Complete; doComplete; completeEvents; Ping; parseAPIError; isContextErr; streamChunk; doStream
// Impact: python -B scripts/code-atlas.py show Core/api.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/aieyra/aieyra-os/api/adapter"
	"github.com/aieyra/aieyra-os/api/codec"
	"github.com/aieyra/aieyra-os/api/request"
	"github.com/aieyra/aieyra-os/api/transport"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"net/http"
	"strings"
	"time"
)

type Thinking = request.Thinking
type ResponseFormat = request.ResponseFormat
type StreamOptions = request.StreamOptions
type ChatRequest = request.ChatRequest

func BuildRequest(s *Settings, messages []Message, stream bool) *ChatRequest {
	profile := requestProfile(s, stream)
	return request.BuildChat(profile, messages, stream, requestImages(profile.SupportsImages, s.Path()))
}

// APIError 保留公共调用兼容，定义与诊断由 API 传输层维护。
type APIError = transport.APIError

type EventKind = protocol.EventKind
type Event = protocol.Event

const (
	EventDelta          = protocol.EventDelta
	EventReasoning      = protocol.EventReasoning
	EventUsage          = protocol.EventUsage
	EventFinish         = protocol.EventFinish
	EventDone           = protocol.EventDone
	EventError          = protocol.EventError
	EventWarn           = protocol.EventWarn
	EventResponse       = protocol.EventResponse
	EventToolPreparing  = protocol.EventToolPreparing
	EventReasoningDone  = protocol.EventReasoningDone
	EventBodyPreparing  = protocol.EventBodyPreparing
	EventRetry          = protocol.EventRetry
	EventTextCorrection = protocol.EventTextCorrection
	EventReasoningStart = protocol.EventReasoningStart
)

// Client 是 DeepSeek API 客户端，零值不可用，请用 New 构造。
type Client struct {
	configPath       string
	adapterSelection *adapter.Selection
	adapterSnapshot  *adapter.Definition
	poolError        error
	poolModel        string
	http             *http.Client
	baseURL          string
	apiKey           string
	endpoint         string
	protocol         string
}

// New 依据配置构造客户端。
func New(s *Settings) *Client {
	timeout := time.Duration(s.RequestTimeout) * time.Second
	if timeout <= 0 {
		timeout = 300 * time.Second
	}
	base := NormalizeBaseURL(s.BaseURL)

	return &Client{
		configPath: s.Path(), adapterSelection: s.apiAdapterSelection(),
		poolError: s.ValidatePoolRequest(),
		poolModel: func() string {
			if s.ModelPoolVersion == 1 {
				return s.Model
			}
			return ""
		}(),
		http:     transport.NewClient(timeout),
		baseURL:  base,
		apiKey:   strings.TrimSpace(s.APIKey),
		endpoint: transport.Endpoint(base, s.Protocol(), s.Model, false),
		protocol: s.Protocol(),
	}
}

// NormalizeBaseURL 容错：用户常把完整路径或 /v1 粘进 Base URL。
func NormalizeBaseURL(raw string) string {
	base := strings.TrimRight(strings.TrimSpace(raw), "/")
	base = strings.TrimSuffix(base, "/chat/completions")
	base = strings.TrimSuffix(base, "/responses")
	if base == DefaultBaseURL+"/v1" {
		base = strings.TrimSuffix(base, "/v1")
	}
	return strings.TrimRight(base, "/")
}

// Endpoint 返回实际请求地址，便于在界面上展示。
func (c *Client) Endpoint() string { return c.endpoint }

func (c *Client) newRequest(ctx context.Context, req *ChatRequest) (*http.Request, error) {
	if c.poolError != nil {
		return nil, c.poolError
	}
	if c.poolModel != "" && req.Model != c.poolModel {
		return nil, fmt.Errorf("请求模型不在当前启用的模型池配置中")
	}
	return c.modelRequest(ctx, ProtocolChat, req.Model, req, req.Stream)
}

// Stream 按 SSE 开关发起请求，统一以事件向界面送达；关闭 SSE 时正文一次送达。
// channel 一定会在结束时关闭，调用方只需 range。
func (c *Client) Stream(ctx context.Context, s *Settings, messages []Message) <-chan Event {
	if err := c.validateRequestSettings(s); err != nil {
		return rejectedModelStream(err)
	}
	if s.Protocol() == ProtocolMessages || s.Protocol() == ProtocolGoogle {
		return c.StreamNative(ctx, s, messages, nil)
	}
	if c.protocol == ProtocolResponses {
		return c.StreamResponses(ctx, s, messages, nil)
	}
	out := make(chan Event, 64)
	req := BuildRequest(s, messages, s.StreamEnabled())
	go func() {
		defer close(out)
		var err error
		if req.Stream {
			err = c.doStream(ctx, req, out)
		} else {
			err = c.completeEvents(ctx, req, out)
		}
		if err != nil {
			select {
			case out <- Event{Kind: EventError, Err: err}:
			case <-ctx.Done():
			}
		}
	}()
	return inlineThinkingStream(ctx, out)
}

// Complete 发起非流式请求，一次性返回完整消息。用于自检与多轮对话。
func (c *Client) Complete(ctx context.Context, s *Settings, messages []Message) (Message, *Usage, error) {
	if err := c.validateRequestSettings(s); err != nil {
		return Message{}, nil, err
	}
	if s.Protocol() == ProtocolMessages || s.Protocol() == ProtocolGoogle {
		return c.CompleteNative(ctx, s, messages)
	}
	if c.protocol == ProtocolResponses {
		return c.CompleteResponses(ctx, s, messages)
	}
	return c.doComplete(ctx, BuildRequest(s, messages, false))
}

func (c *Client) doComplete(ctx context.Context, req *ChatRequest) (Message, *Usage, error) {
	httpReq, err := c.newRequest(ctx, req)
	if err != nil {
		return Message{}, nil, err
	}
	resp, err := c.http.Do(httpReq)
	if err != nil {
		return Message{}, nil, fmt.Errorf("网络请求失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Message{}, nil, parseAPIError(resp)
	}

	var parsed struct {
		Choices []struct {
			Message      Message `json:"message"`
			FinishReason string  `json:"finish_reason"`
		} `json:"choices"`
		Usage *Usage `json:"usage"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return Message{}, nil, fmt.Errorf("解析响应失败: %w", err)
	}
	if len(parsed.Choices) == 0 {
		return Message{}, nil, fmt.Errorf("响应中没有 choices")
	}
	message := parsed.Choices[0].Message
	if req.TextOnly() {
		// This relay reports zero or estimated usage, not verified vendor
		// counters. The caller's existing unknown/estimated path accounts it.
		parsed.Usage = nil
		if len(message.ToolCalls) > 0 {
			return Message{}, nil, fmt.Errorf("当前纯文本型号返回了未授权的工具调用")
		}
	}
	if message.ReasoningContent == "" {
		message.ReasoningContent = message.RouterReasoning
	}
	message.RouterReasoning = ""
	message.FinishReason = parsed.Choices[0].FinishReason
	return *normalizeInlineThinking(&message), parsed.Usage, nil
}

func (c *Client) completeEvents(ctx context.Context, req *ChatRequest, out chan<- Event) error {
	m, usage, err := c.doComplete(ctx, req)
	if err != nil {
		return err
	}
	events := []Event{{Kind: EventReasoning, Text: m.ReasoningContent}, {Kind: EventDelta, Text: m.Content}, {Kind: EventUsage, Usage: usage}, {Kind: EventFinish, Finish: m.FinishReason}}
	if len(m.ToolCalls) > 0 {
		events = append(events, Event{Kind: EventWarn, Err: fmt.Errorf("模型发起了 %d 个工具调用，本客户端未执行（工具循环尚未实现）", len(m.ToolCalls))})
	}
	events = append(events, Event{Kind: EventDone})
	for _, ev := range events {
		select {
		case out <- ev:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

// Ping 是最轻量的连通性与鉴权检查。
//
// 用 max_tokens=1 的非流式请求验证 Key、Base URL、模型名三者是否都正确，
// 比单纯 GET /models 更能反映真实调用链路。
// 请求体复用 BuildRequest（再覆盖 MaxTokens=1），避免与真实路径分叉
// （“Ping 通≠调用通”就是这么来的）。
func (c *Client) Ping(ctx context.Context, model string) (string, error) {
	s := Defaults()
	s.Model = model
	s.APIKey = c.apiKey
	s.BaseURL = c.baseURL
	s.ThinkingType = "disabled"
	s.Temperature = 0
	if c.protocol == ProtocolResponses {
		return c.pingResponses(ctx, s)
	}
	req := BuildRequest(s, []Message{{Role: RoleUser, Content: "hi"}}, false)
	req.MaxTokens = 1
	httpReq, err := c.newRequest(ctx, req)
	if err != nil {
		return "", err
	}
	resp, err := c.http.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("网络请求失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", parseAPIError(resp)
	}
	return "连通正常", nil
}

func parseAPIError(resp *http.Response) error { return transport.ParseAPIError(resp) }

// isContextErr 判断是否为调用方主动取消。
func isContextErr(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

// —— SSE 流式解析 ——

// streamChunk 是流式响应的单个分片。
type streamChunk = codec.ChatChunk

func (c *Client) doStream(ctx context.Context, req *ChatRequest, out chan<- Event) error {
	send := func(ev Event) bool {
		if req.TextOnly() && ev.Kind == EventUsage {
			ev.Usage = nil
		}
		select {
		case out <- ev:
			return true
		case <-ctx.Done():
			return false
		}
	}

	httpReq, err := c.newRequest(ctx, req)
	if err != nil {
		return err
	}
	httpReq.Header.Set("Accept", "text/event-stream")

	// 流式不能用 http.Client.Timeout 掐整流：它覆盖整个 body，
	// 深度思考 + 慢网超过 300s 会被误杀。用无超时的 clone，
	// 超时只靠调用方的 ctx（Complete/RunOnce 侧已包 WithTimeout）。
	streamHTTP := *c.http
	streamHTTP.Timeout = 0
	resp, err := streamHTTP.Do(httpReq)
	if err != nil {
		if isContextErr(err) {
			return err
		}
		return fmt.Errorf("网络请求失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return parseAPIError(resp)
	}

	return codec.ReadChat(resp.Body, send)
}
