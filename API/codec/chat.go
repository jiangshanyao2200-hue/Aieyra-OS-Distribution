// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/codec/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ChatToolDefinition; InvalidToolResponseError; Error; MarshalJSON; ChatIdentity; ReadChatTools; streamProviderError; utf8Prefix
// Impact: python -B scripts/code-atlas.py show API/codec/chat.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package codec

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/aieyra/aieyra-os/api/transport"
	"io"
	"sort"
	"strings"
	"unicode/utf8"
)

type ChatToolDefinition struct {
	Type     string         `json:"type"`
	Function ToolDefinition `json:"function"`
}

// A parsed provider reply can still contain an unusable tool invocation. Keep
// this distinct from transport failure; no rejected call may be dispatched.
type InvalidToolResponseError struct {
	Message string `json:"message"`
}

func (e *InvalidToolResponseError) Error() string { return e.Message }

// Chat 的 function 内层不携带 Responses 的 type 字段。
func (t ChatToolDefinition) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]any{"type": "function", "function": map[string]any{"name": t.Function.Name, "description": t.Function.Description, "parameters": t.Function.Parameters, "strict": false}})
}

func ChatIdentity(m *Message) error {
	m.Role = RoleAssistant
	if m.ResponseID == "" {
		var id [16]byte
		if _, err := rand.Read(id[:]); err != nil {
			return err
		}
		m.ResponseID = "chat_" + hex.EncodeToString(id[:])
	}
	if len(m.ToolCalls) > 32 {
		return &InvalidToolResponseError{Message: "模型返回的工具调用过多，未执行"}
	}
	if m.FinishReason == "length" {
		m.IncompleteTools, m.ToolCalls = append(m.IncompleteTools, m.ToolCalls...), nil
		return nil
	}
	seen := map[string]bool{}
	for i := range m.ToolCalls {
		c := &m.ToolCalls[i]
		if c.Function.Name == "" {
			return &InvalidToolResponseError{Message: "模型返回的工具调用没有名字，未执行"}
		}
		// Gemini 经网关时 id 可能为空或重复，无参数的调用 arguments 是空串：补上，不算坏响应。
		if c.ID == "" || seen[c.ID] {
			var id [12]byte
			if _, err := rand.Read(id[:]); err != nil {
				return err
			}
			c.ID = "call_" + hex.EncodeToString(id[:])
		}
		if strings.TrimSpace(c.Function.Arguments) == "" {
			c.Function.Arguments = "{}"
		}
		if !json.Valid([]byte(c.Function.Arguments)) {
			return &InvalidToolResponseError{Message: "模型返回的工具参数不是完整 JSON，工具未执行"}
		}
		seen[c.ID] = true
		c.Index = nil
		c.Type = "function"
	}
	if len(m.ToolCalls) > 0 && m.FinishReason != "tool_calls" {
		// 网关常把 Gemini 的工具调用标成 stop。参数都完整就算数；被过滤、截断的不算。
		switch strings.ToLower(m.FinishReason) {
		case "stop", "function_call", "tool_use":
			m.FinishReason = "tool_calls"
		default:
			return &InvalidToolResponseError{Message: "模型返回的工具调用缺少完整终止状态，未执行"}
		}
	}
	return nil
}

func ReadChatTools(reader io.Reader, send func(Event) error) error {
	m := Message{Role: RoleAssistant}
	calls := map[int]*ToolCall{}
	// 网关写的 index → 实际位置。Gemini 的并行调用可能都写 0、或不写 index。
	slots := map[int]int{}
	var content, reasoning strings.Builder
	details := map[int]map[string]any{}
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), 4<<20)
	var data []string
	done := false
	ended := false
	var handle func(string) error
	// Some gateways separate events with a single newline. SSE then joins the
	// data lines into one event; when that is not JSON but every line is, each
	// line is its own chunk. Anything else is still rejected before execution.
	dispatch := func() error {
		if len(data) == 0 {
			return nil
		}
		lines := data
		payload := strings.Join(lines, "\n")
		data = nil
		if len(lines) > 1 && !json.Valid([]byte(payload)) {
			for _, line := range lines {
				if line != "[DONE]" && !json.Valid([]byte(line)) {
					return fmt.Errorf("工具流包含无效分片（不是完整 JSON），未执行")
				}
			}
			for _, line := range lines {
				if err := handle(line); err != nil {
					return err
				}
			}
			return nil
		}
		return handle(payload)
	}
	handle = func(payload string) error {
		if payload == "[DONE]" {
			done = true
			return nil
		}
		var chunk struct {
			ID      string `json:"id"`
			Choices []struct {
				Index int `json:"index"`
				Delta struct {
					Content         string           `json:"content"`
					Reasoning       string           `json:"reasoning_content"`
					RouterReasoning string           `json:"reasoning"`
					Details         []map[string]any `json:"reasoning_details"`
					Tools           []ToolCall       `json:"tool_calls"`
				} `json:"delta"`
				Finish string `json:"finish_reason"`
			} `json:"choices"`
			Usage *Usage          `json:"usage"`
			Error json.RawMessage `json:"error"`
		}
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
			var typed *json.UnmarshalTypeError
			switch {
			case errors.As(err, &typed) && strings.HasPrefix(typed.Field, "usage"):
				// Usage is accounting only; an unexpected shape never decides execution.
				chunk.Usage = nil
			case errors.As(err, &typed) && typed.Field != "":
				return fmt.Errorf("工具流包含无效分片（%s 字段类型不符），未执行", typed.Field)
			default:
				return fmt.Errorf("工具流包含无效分片（不是完整 JSON），未执行")
			}
		}
		if e := strings.TrimSpace(string(chunk.Error)); e != "" && e != "null" {
			// A provider error inside the stream: show its own message, not a parse failure.
			var problem struct {
				Code    any    `json:"code"`
				Status  string `json:"status"`
				Message string `json:"message"`
			}
			if json.Unmarshal(chunk.Error, &problem) != nil || problem.Message == "" {
				_ = json.Unmarshal(chunk.Error, &problem.Message)
			}
			if problem.Message == "" {
				problem.Message = "未给出说明"
			}
			var code string
			if problem.Code != nil {
				code = strings.TrimSpace(fmt.Sprint(problem.Code))
			}
			return streamProviderError(code, problem.Status, problem.Message)
		}
		if chunk.ID != "" {
			// 不把两次响应拼在一起执行；但这不是模型的错，算断流，重发一次。
			// 兼容网关尾部的空 delta 收尾帧或 usage 统计帧可能携带不同 ID，无实质增量时不误杀。
			if m.ResponseID != "" && m.ResponseID != chunk.ID {
				hasDelta := false
				for _, ch := range chunk.Choices {
					if ch.Index == 0 && (ch.Delta.Content != "" || ch.Delta.Reasoning != "" || ch.Delta.RouterReasoning != "" || len(ch.Delta.Details) > 0 || len(ch.Delta.Tools) > 0) {
						hasDelta = true
						break
					}
				}
				if hasDelta {
					return fmt.Errorf("工具流响应身份变化，未执行：%w", io.ErrUnexpectedEOF)
				}
			} else {
				m.ResponseID = chunk.ID
			}
		}
		for _, ch := range chunk.Choices {
			if ch.Index != 0 {
				continue
			}
			if ch.Delta.Reasoning == "" {
				ch.Delta.Reasoning = ch.Delta.RouterReasoning
			}
			for _, detail := range ch.Delta.Details {
				index := Numeric(detail["index"])
				if index < 0 || index > 1024 {
					return fmt.Errorf("推理块索引无效")
				}
				old := details[index]
				if old == nil {
					old = map[string]any{}
					details[index] = old
				}
				for k, v := range detail {
					if k == "text" || k == "data" || k == "summary" {
						old[k] = StringValue(old[k]) + StringValue(v)
						if len(StringValue(old[k])) > 4<<20 {
							return fmt.Errorf("推理块过长")
						}
					} else {
						if previous, ok := old[k]; ok && fmt.Sprint(previous) != fmt.Sprint(v) {
							return fmt.Errorf("推理块身份发生变化")
						}
						old[k] = v
					}
				}
			}
			// 网关转出的 Gemini 并行工具调用会在中途就给 finish_reason，后面还有工具分片
			// （2026-11-04 实测）。同一响应身份下继续收；真正的结束以 [DONE] 为准。
			if ch.Delta.Reasoning != "" {
				reasoning.WriteString(ch.Delta.Reasoning)
				if err := send(Event{Kind: EventReasoning, Text: ch.Delta.Reasoning}); err != nil {
					return err
				}
			}
			if ch.Delta.Content != "" {
				content.WriteString(ch.Delta.Content)
				if err := send(Event{Kind: EventDelta, Text: ch.Delta.Content}); err != nil {
					return err
				}
			}
			for _, delta := range ch.Delta.Tools {
				key := -1
				if delta.Index != nil {
					if *delta.Index < 0 || *delta.Index >= 32 {
						return fmt.Errorf("工具流索引无效")
					}
					key = *delta.Index
				}
				i, known := slots[key]
				var call *ToolCall
				if known {
					call = calls[i]
				}
				// 同一个位置来了新身份，或上一个调用已经完整又来了新名字，就是下一个并行调用。
				if call == nil || delta.ID != "" && call.ID != "" && call.ID != delta.ID || delta.ID == "" && delta.Function.Name != "" && call.Function.Name != "" && json.Valid([]byte(call.Function.Arguments)) {
					i = len(calls)
					if i >= 32 {
						return fmt.Errorf("工具调用过多")
					}
					call = &ToolCall{Type: "function"}
					calls[i], slots[key] = call, i
				}
				if delta.ID != "" {
					call.ID = delta.ID
				}
				if len(delta.ExtraContent) > 0 {
					call.ExtraContent = delta.ExtraContent
				}
				call.Function.Name += delta.Function.Name
				call.Function.Arguments += delta.Function.Arguments
				if len(call.Function.Arguments) > 2<<20 {
					return fmt.Errorf("工具参数过长")
				}
				if err := send(Event{Kind: EventToolPreparing}); err != nil {
					return err
				}
			}
			if ch.Finish != "" && ch.Finish != m.FinishReason {
				m.FinishReason = ch.Finish
				ended = true
				if err := send(Event{Kind: EventFinish, Finish: ch.Finish}); err != nil {
					return err
				}
			}
		}
		if chunk.Usage != nil {
			return send(Event{Kind: EventUsage, Usage: chunk.Usage})
		}
		return nil
	}
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if line == "" {
			if err := dispatch(); err != nil {
				return err
			}
			if done {
				break
			}
		} else if strings.HasPrefix(line, "data:") {
			s := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			// A complete JSON line is already an independent gateway chunk.
			// Release it before waiting for another line, while an unfinished
			// multi-line SSE payload still waits for its normal event boundary.
			if len(data) == 0 && (s == "[DONE]" || json.Valid([]byte(s))) {
				if err := handle(s); err != nil {
					return err
				}
				if done {
					break
				}
				continue
			}
			if s == "[DONE]" && len(data) > 0 {
				if err := dispatch(); err != nil {
					return err
				}
			}
			data = append(data, s)
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	if err := dispatch(); err != nil {
		return err
	}
	if !done || !ended && len(calls) > 0 {
		return fmt.Errorf("响应流提前中断，工具未执行：%w", io.ErrUnexpectedEOF)
	}
	// Gemini 生成的函数调用格式不对时什么都不给：换一次通常就好，走断流同样的重试。
	if finish := strings.ToLower(m.FinishReason); len(calls) == 0 && (strings.Contains(finish, "malformed") || strings.Contains(finish, "unexpected_tool")) {
		return fmt.Errorf("模型生成的工具调用格式不对（%s），工具未执行：%w", m.FinishReason, io.ErrUnexpectedEOF)
	}
	for i := 0; i < len(calls); i++ {
		m.ToolCalls = append(m.ToolCalls, *calls[i])
	}
	m.Content = content.String()
	m.ReasoningContent = reasoning.String()
	if len(details) > 0 {
		keys := make([]int, 0, len(details))
		for index := range details {
			keys = append(keys, index)
		}
		sort.Ints(keys)
		items := make([]map[string]any, 0, len(keys))
		for _, index := range keys {
			items = append(items, details[index])
		}
		m.ReasoningDetails = rawJSON(items)
	}
	if err := ChatIdentity(&m); err != nil {
		return err
	}
	if err := send(Event{Kind: EventResponse, Message: &m}); err != nil {
		return err
	}
	return send(Event{Kind: EventDone})
}

// 响应流里报的错：过载、限流、内部错误这类换一次就可能过，归成 503 走同一套重试。
func streamProviderError(code, status, message string) error {
	detail := strings.TrimSpace(code + " " + status + " " + message)
	text := "供应商在响应流中报错，工具未执行：" + utf8Prefix(detail, 300)
	if strings.EqualFold(code, "empty_response") {
		return &transport.APIError{StatusCode: 502, Code: "empty_response", Message: text}
	}
	if strings.EqualFold(code, "upstream_stream_read_error") || strings.EqualFold(strings.TrimSpace(status), "upstream_stream_read_error") {
		return &transport.APIError{StatusCode: 502, Code: "upstream_stream_read_error", Message: text}
	}
	detail = strings.ToLower(detail)
	for _, marker := range []string{"503", "500", "502", "504", "429", "overload", "unavailable", "high demand", "internal", "deadline", "timeout", "timed out", "resource_exhausted", "rate limit", "try again"} {
		if strings.Contains(detail, marker) {
			return &transport.APIError{StatusCode: 503, Code: "stream_error", Message: text}
		}
	}
	return errors.New(text)
}

func utf8Prefix(s string, n int) string {
	if n >= len(s) {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}
