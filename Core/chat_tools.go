// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ChatToolDefinition; InvalidToolResponseError; StreamChatTools
// Impact: python -B scripts/code-atlas.py show Core/chat_tools.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"
	"github.com/aieyra/aieyra-os/api/codec"
)

type ChatToolDefinition = codec.ChatToolDefinition
type InvalidToolResponseError = codec.InvalidToolResponseError

func (c *Client) StreamChatTools(ctx context.Context, s *Settings, messages []Message, tools []ToolDefinition) <-chan Event {
	if err := c.validateRequestSettings(s); err != nil {
		return rejectedModelStream(err)
	}
	req := BuildRequest(s, messages, s.StreamEnabled())
	if req.TextOnly() {
		tools = nil
	}
	for _, t := range tools {
		req.Tools = append(req.Tools, ChatToolDefinition{Type: "function", Function: t})
	}
	if len(tools) > 0 {
		req.ToolChoice = "auto"
	}
	out := make(chan Event, 64)
	go func() {
		defer close(out)
		send := func(e Event) error {
			if req.TextOnly() {
				if e.Kind == EventUsage {
					e.Usage = nil
				}
				if e.Kind == EventToolPreparing || e.Kind == EventResponse && e.Message != nil && len(e.Message.ToolCalls) > 0 {
					return fmt.Errorf("当前纯文本型号返回了未授权的工具调用")
				}
			}
			select {
			case out <- e:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		run := func(ctx context.Context, send func(Event) error) error {
			if !req.Stream {
				m, u, err := c.doComplete(ctx, req)
				if err != nil {
					return err
				}
				if err = chatIdentity(&m); err != nil {
					// Billing and observed finish metadata remain valid even when
					// the tool payload fails validation. Emit no usable response.
					for _, ev := range []Event{{Kind: EventUsage, Usage: u}, {Kind: EventFinish, Finish: m.FinishReason}} {
						if sendErr := send(ev); sendErr != nil {
							return sendErr
						}
					}
					return err
				}
				for _, ev := range []Event{{Kind: EventReasoning, Text: m.ReasoningContent}, {Kind: EventDelta, Text: m.Content}, {Kind: EventUsage, Usage: u}, {Kind: EventResponse, Message: &m}, {Kind: EventFinish, Finish: m.FinishReason}, {Kind: EventDone}} {
					if err = send(ev); err != nil {
						return err
					}
				}
				return nil
			}
			request, err := c.newRequest(ctx, req)
			if err != nil {
				return err
			}
			request.Header.Set("Accept", "text/event-stream")
			client := *c.http
			client.Timeout = 0
			resp, err := client.Do(request)
			if err != nil {
				return fmt.Errorf("模型连接失败: %w", err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != 200 {
				return markGeminiTransient(s, parseAPIError(resp))
			}
			return readChatTools(resp.Body, send)
		}
		if err := c.retryStream(ctx, send, run); err != nil {
			_ = send(Event{Kind: EventError, Err: err})
		}
	}()
	return out
}

// 只在完整结束、调用身份及参数校验通过后发布可执行响应；分片只触发显示状态。
