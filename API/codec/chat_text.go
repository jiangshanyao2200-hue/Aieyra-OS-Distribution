// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/codec/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ChatChunk; ReadChat
// Impact: python -B scripts/code-atlas.py show API/codec/chat_text.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package codec

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

type ChatChunk struct {
	Choices []struct {
		Delta struct {
			Content          string     `json:"content"`
			ReasoningContent string     `json:"reasoning_content"`
			ToolCalls        []ToolCall `json:"tool_calls"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage *Usage `json:"usage"`
}

// doStream 解析 SSE。用 bufio.Reader 逐行读取（不设单行上限），
// 同一事件的多行 data: 按 SSE 规范用 \n 拼接后统一解析，空行分发。
// ReadChat preserves the text-only stream behavior; tool streams use ReadChatTools.
func ReadChat(input io.Reader, send func(Event) bool) error {
	// badFrames 只做警告不做致命错误：正文已打印却 exit 1，
	// 脚本会误判整轮失败；阈值化（>5 或 >5%）才升级为错误。
	// toolCalls 记录被丢弃的工具调用数，收尾时如实告知用户。
	badFrames, totalFrames, toolCalls := 0, 0, 0
	finish := func() {
		if toolCalls > 0 {
			send(Event{Kind: EventWarn, Err: fmt.Errorf(
				"模型发起了 %d 个工具调用，本客户端未执行、已丢弃（工具循环尚未实现）", toolCalls)})
		}
		if badFrames > 0 {
			if badFrames > 5 || (totalFrames > 0 && badFrames*20 > totalFrames) {
				send(Event{Kind: EventError, Err: fmt.Errorf(
					"流里有 %d/%d 个分片无法解析，回答可能不完整；请重试或检查网络", badFrames, totalFrames)})
			} else {
				send(Event{Kind: EventWarn, Err: fmt.Errorf(
					"流里有 %d 个分片无法解析，已跳过，内容可能有缺失", badFrames)})
			}
		}
		send(Event{Kind: EventDone})
	}
	dispatch := func(payload string) bool {
		if payload == "[DONE]" {
			finish()
			return false
		}
		totalFrames++
		var chunk ChatChunk
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
			badFrames++
			return true
		}
		for _, ch := range chunk.Choices {
			if len(ch.Delta.ToolCalls) > 0 {
				toolCalls += len(ch.Delta.ToolCalls)
			}
			if ch.Delta.ReasoningContent != "" && !send(Event{Kind: EventReasoning, Text: ch.Delta.ReasoningContent}) {
				return false
			}
			if ch.Delta.Content != "" && !send(Event{Kind: EventDelta, Text: ch.Delta.Content}) {
				return false
			}
			if ch.FinishReason != "" && !send(Event{Kind: EventFinish, Finish: ch.FinishReason}) {
				return false
			}
		}
		if chunk.Usage != nil && !send(Event{Kind: EventUsage, Usage: chunk.Usage}) {
			return false
		}
		return true
	}

	reader := bufio.NewReader(input)
	var dataBuf []string
	flushData := func() bool {
		if len(dataBuf) == 0 {
			return true
		}
		payload := strings.TrimSpace(strings.Join(dataBuf, "\n"))
		dataBuf = dataBuf[:0]
		if payload == "" {
			return true
		}
		return dispatch(payload)
	}

	for {
		line, err := reader.ReadString('\n')
		if err != nil && err != io.EOF {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return err
			}
			return fmt.Errorf("读取流失败: %w", err)
		}
		trimmed := strings.TrimRight(line, "\r\n")
		// 空行 = 事件分隔符，分发累积的 data。
		if strings.TrimSpace(trimmed) == "" {
			if !flushData() {
				return nil
			}
			if err == io.EOF {
				break
			}
			continue
		}
		// 以 ':' 开头的是 SSE 注释心跳，忽略但不打断累积。
		if strings.HasPrefix(strings.TrimSpace(trimmed), ":") {
			if err == io.EOF {
				break
			}
			continue
		}
		if strings.HasPrefix(trimmed, "data:") {
			payload := strings.TrimSpace(strings.TrimPrefix(trimmed, "data:"))
			// [DONE] 必须立即分发（它前面可能没有空行）。
			if payload == "[DONE]" {
				if !flushData() {
					return nil
				}
				finish()
				return nil
			}
			dataBuf = append(dataBuf, payload)
			// 防御性上限：单个事件累积超过 16M 视为异常，直接丢弃并计数。
			if len(dataBuf) > 4096 {
				badFrames++
				dataBuf = dataBuf[:0]
			}
		}
		if err == io.EOF {
			break
		}
	}
	// 连接被正常关闭时也视为结束（官方一般会发 [DONE]）。
	if !flushData() {
		return nil
	}
	// 正常收尾：官方一般会发 [DONE]，但连接被正常关闭时也视为结束。
	finish()
	return nil
}
