// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/codec/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: EmptyGoogleTextPart; nativeEvents; StringValue; nativeIndex; Numeric; nativeTokenCount; NativeMessage; ParseAnthropic; AnthropicUsage; ReadSSE; ReadAnthropic; googleEnvelope; GoogleUsage; ParseGoogle; ReadGoogle
// Impact: python -B scripts/code-atlas.py show API/codec/native.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package codec

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
)

func EmptyGoogleTextPart(p map[string]any) bool {
	for key, value := range p {
		switch key {
		case "text":
			if text, ok := value.(string); !ok || text != "" {
				return false
			}
		case "thought":
		case "thoughtSignature":
			if value != "" {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func nativeEvents(parts []map[string]any, google bool, send func(Event) error) error {
	if send == nil {
		return nil
	}
	for _, p := range parts {
		var e Event
		if google {
			if EmptyGoogleTextPart(p) {
				continue
			}
			if t, ok := p["text"].(string); ok {
				e = Event{Kind: EventDelta, Text: t}
				if p["thought"] == true {
					e.Kind = EventReasoning
				}
			} else if p["functionCall"] != nil {
				e.Kind = EventToolPreparing
			} else {
				continue
			}
		} else {
			switch p["type"] {
			case "text":
				e = Event{Kind: EventDelta, Text: StringValue(p["text"])}
			case "thinking":
				e = Event{Kind: EventReasoning, Text: StringValue(p["thinking"])}
			case "tool_use":
				e.Kind = EventToolPreparing
			default:
				continue
			}
		}
		if err := send(e); err != nil {
			return err
		}
	}
	return nil
}
func StringValue(v any) string { s, _ := v.(string); return s }
func nativeIndex(v any) (int, bool) {
	n, ok := v.(float64)
	return int(n), ok && n >= 0 && n < 256 && float64(int(n)) == n
}
func Numeric(v any) int { n, _ := v.(float64); return int(n) }

// Native maps come from encoding/json. A present key is only a reported token
// count when its value is a finite, nonnegative integer representable as int.
func nativeTokenCount(v any) (int, bool) {
	n, ok := v.(float64)
	if !ok || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || math.Trunc(n) != n || n >= math.Ldexp(1, strconv.IntSize-1) {
		return 0, false
	}
	return int(n), true
}

func NativeMessage(id, finish string, parts []map[string]any, google bool) (Message, error) {
	m := Message{Role: RoleAssistant, ResponseID: id, FinishReason: finish}
	truncated := finish == "max_tokens" || finish == "MAX_TOKENS"
	if google {
		replay := make([]map[string]any, 0, len(parts))
		for _, p := range parts {
			if !EmptyGoogleTextPart(p) {
				replay = append(replay, p)
			}
		}
		parts = replay
	}
	if id == "" {
		if err := ChatIdentity(&m); err != nil {
			return m, err
		}
		id = m.ResponseID
	}
	if finish == "" {
		return m, fmt.Errorf("模型响应未完整结束，工具未执行")
	}
	for i, p := range parts {
		if google {
			if text, ok := p["text"].(string); ok {
				if p["thought"] == true {
					m.ReasoningContent += text
				} else {
					m.Content += text
				}
			}
			if fn, ok := p["functionCall"].(map[string]any); ok {
				callID := StringValue(fn["id"])
				if callID == "" {
					callID = fmt.Sprintf("google_%s_%d", id, i)
				}
				if fn["args"] == nil {
					fn["args"] = map[string]any{}
				}
				if _, ok := fn["args"].(map[string]any); !ok {
					return m, fmt.Errorf("Google 工具参数必须是对象")
				}
				args, err := json.Marshal(fn["args"])
				if err != nil {
					return m, err
				}
				m.ToolCalls = append(m.ToolCalls, ToolCall{ID: callID, Type: "function", Function: FunctionCall{Name: StringValue(fn["name"]), Arguments: string(args)}})
			}
		} else {
			switch p["type"] {
			case "text":
				m.Content += StringValue(p["text"])
			case "thinking":
				m.ReasoningContent += StringValue(p["thinking"])
			case "tool_use":
				if truncated {
					args := StringValue(p["partial_json"])
					if args == "" {
						args = string(rawJSON(p["input"]))
					}
					m.IncompleteTools = append(m.IncompleteTools, ToolCall{ID: StringValue(p["id"]), Type: "function", Function: FunctionCall{Name: StringValue(p["name"]), Arguments: args}})
					continue
				}
				if _, ok := p["input"].(map[string]any); !ok {
					return m, fmt.Errorf("Messages 工具参数必须是对象")
				}
				args, err := json.Marshal(p["input"])
				if err != nil {
					return m, err
				}
				m.ToolCalls = append(m.ToolCalls, ToolCall{ID: StringValue(p["id"]), Type: "function", Function: FunctionCall{Name: StringValue(p["name"]), Arguments: string(args)}})
			}
		}
	}
	if finish == "tool_use" || google && finish == "STOP" && len(m.ToolCalls) > 0 {
		m.FinishReason = "tool_calls"
	} else if finish == "end_turn" || finish == "stop_sequence" || finish == "STOP" {
		m.FinishReason = "stop"
	} else if finish == "max_tokens" || finish == "MAX_TOKENS" {
		m.FinishReason = "length"
	} else {
		return m, fmt.Errorf("模型响应终止原因：%s，工具未执行", finish)
	}
	if err := ChatIdentity(&m); err != nil {
		return m, err
	}
	if !google && !truncated && len(m.ToolCalls) > 0 {
		callIdx := 0
		for _, p := range parts {
			if p != nil && p["type"] == "tool_use" && callIdx < len(m.ToolCalls) {
				if StringValue(p["id"]) == "" && m.ToolCalls[callIdx].ID != "" {
					p["id"] = m.ToolCalls[callIdx].ID
				}
				callIdx++
			}
		}
	}
	m.NativeContent = rawJSON(parts)
	return m, nil
}
func ParseAnthropic(data []byte, send func(Event) error) (Message, *Usage, error) {
	var env struct {
		ID      string           `json:"id"`
		Content []map[string]any `json:"content"`
		Stop    string           `json:"stop_reason"`
		Usage   map[string]any   `json:"usage"`
		Error   json.RawMessage  `json:"error"`
	}
	if err := json.Unmarshal(data, &env); err != nil {
		return Message{}, nil, err
	}
	if len(env.Error) > 0 {
		return Message{}, nil, fmt.Errorf("Messages API 返回错误")
	}
	m, err := NativeMessage(env.ID, env.Stop, env.Content, false)
	if err == nil {
		err = nativeEvents(env.Content, false, send)
	}
	return m, AnthropicUsage(env.Usage), err
}
func AnthropicUsage(u map[string]any) *Usage {
	if u == nil {
		return nil
	}
	hit, hitKnown := nativeTokenCount(u["cache_read_input_tokens"])
	miss := Numeric(u["input_tokens"]) + Numeric(u["cache_creation_input_tokens"])
	output := Numeric(u["output_tokens"])
	result := &Usage{PromptTokens: hit + miss, CompletionTokens: output, TotalTokens: hit + miss + output, PromptCacheHitTokens: hit, PromptCacheMissTokens: miss}
	result.CacheHitKnown = hitKnown
	if detail, ok := u["output_tokens_details"].(map[string]any); ok {
		value, known := nativeTokenCount(detail["thinking_tokens"])
		if !known {
			value, known = nativeTokenCount(detail["reasoning_tokens"])
		}
		if known {
			result.CompletionTokensDetails = &struct {
				ReasoningTokens int `json:"reasoning_tokens"`
			}{value}
		}
	}
	return result
}
func ReadSSE(reader io.Reader, dispatch func([]byte) error) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), 4<<20)
	var data []string
	flush := func() error {
		if len(data) == 0 {
			return nil
		}
		payload := strings.Join(data, "\n")
		data = nil
		return dispatch([]byte(payload))
	}
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if line == "" {
			if err := flush(); err != nil {
				return err
			}
		} else if strings.HasPrefix(line, "data:") {
			data = append(data, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return flush()
}
func ReadAnthropic(reader io.Reader, send func(Event) error) (Message, *Usage, error) {
	var id, finish string
	parts := []map[string]any{}
	args := map[int]string{}
	closed := map[int]bool{}
	usage := map[string]any{}
	started, ended, delta := false, false, false
	err := ReadSSE(reader, func(data []byte) error {
		var e map[string]any
		if json.Unmarshal(data, &e) != nil {
			return fmt.Errorf("Messages 流分片无效")
		}
		kind := StringValue(e["type"])
		if kind == "ping" {
			return nil
		}
		if ended {
			return fmt.Errorf("Messages 结束后仍有数据")
		}
		switch kind {
		case "message_start":
			if started {
				return fmt.Errorf("重复 message_start")
			}
			started = true
			m, ok := e["message"].(map[string]any)
			if !ok {
				return fmt.Errorf("缺少 message")
			}
			id = StringValue(m["id"])
			if u, ok := m["usage"].(map[string]any); ok {
				usage = u
			}
		case "content_block_start":
			i, validIndex := nativeIndex(e["index"])
			if !validIndex {
				return fmt.Errorf("Messages 缺少有效块索引")
			}
			p, ok := e["content_block"].(map[string]any)
			if !started || delta || i != len(parts) || !ok || len(parts) >= 256 {
				return fmt.Errorf("Messages 块顺序无效")
			}
			parts = append(parts, p)
			return nativeEvents([]map[string]any{p}, false, send)
		case "content_block_delta":
			i, validIndex := nativeIndex(e["index"])
			if !validIndex {
				return fmt.Errorf("Messages 缺少有效块索引")
			}
			d, ok := e["delta"].(map[string]any)
			if i < 0 || i >= len(parts) || closed[i] || !ok || delta {
				return fmt.Errorf("Messages 增量顺序无效")
			}
			p := parts[i]
			var event Event
			switch d["type"] {
			case "text_delta":
				if p["type"] != "text" {
					return fmt.Errorf("Messages 块类型不匹配")
				}
				t := StringValue(d["text"])
				p["text"] = StringValue(p["text"]) + t
				event = Event{Kind: EventDelta, Text: t}
			case "thinking_delta":
				if p["type"] != "thinking" {
					return fmt.Errorf("Messages 块类型不匹配")
				}
				t := StringValue(d["thinking"])
				p["thinking"] = StringValue(p["thinking"]) + t
				event = Event{Kind: EventReasoning, Text: t}
			case "signature_delta":
				if p["type"] != "thinking" {
					return fmt.Errorf("Messages 块类型不匹配")
				}
				p["signature"] = StringValue(p["signature"]) + StringValue(d["signature"])
				return nil
			case "input_json_delta":
				if p["type"] != "tool_use" {
					return fmt.Errorf("Messages 块类型不匹配")
				}
				args[i] += StringValue(d["partial_json"])
				if len(args[i]) > 2<<20 {
					return fmt.Errorf("工具参数过长")
				}
				event.Kind = EventToolPreparing
			default:
				return fmt.Errorf("不支持的 Messages 增量")
			}
			return send(event)
		case "content_block_stop":
			i, validIndex := nativeIndex(e["index"])
			if !validIndex {
				return fmt.Errorf("Messages 缺少有效块索引")
			}
			if i < 0 || i >= len(parts) || closed[i] {
				return fmt.Errorf("Messages 块结束无效")
			}
			closed[i] = true
			if args[i] != "" {
				var input map[string]any
				if json.Unmarshal([]byte(args[i]), &input) != nil {
					// The terminal reason arrives after block_stop. Retain the raw
					// argument until we know whether this was an output limit.
					parts[i]["partial_json"] = args[i]
					parts[i]["input"] = nil
				} else {
					parts[i]["input"] = input
				}
			}
			if parts[i]["type"] == "thinking" {
				return send(Event{Kind: EventReasoningDone})
			}
		case "message_delta":
			if delta || !started || len(closed) != len(parts) {
				return fmt.Errorf("Messages 尚有未结束的块")
			}
			delta = true
			d, _ := e["delta"].(map[string]any)
			finish = StringValue(d["stop_reason"])
			if u, ok := e["usage"].(map[string]any); ok {
				for k, v := range u {
					usage[k] = v
				}
			}
		case "message_stop":
			if !delta || finish == "" {
				return fmt.Errorf("Messages 缺少终止状态")
			}
			ended = true
		case "error":
			return fmt.Errorf("Messages 流返回错误，工具未执行")
		default:
			return fmt.Errorf("不支持的 Messages 流事件：%s", kind)
		}
		return nil
	})
	if err != nil {
		return Message{}, nil, err
	}
	if !ended || id == "" {
		return Message{}, nil, fmt.Errorf("Messages 流提前中断，工具未执行：%w", io.ErrUnexpectedEOF)
	}
	m, err := NativeMessage(id, finish, parts, false)
	return m, AnthropicUsage(usage), err
}

type googleEnvelope struct {
	ResponseID string `json:"responseId"`
	Candidates []struct {
		Content struct {
			Parts []map[string]any `json:"parts"`
		} `json:"content"`
		Finish string `json:"finishReason"`
		Index  int    `json:"index"`
	} `json:"candidates"`
	Usage map[string]any  `json:"usageMetadata"`
	Error json.RawMessage `json:"error"`
}

func GoogleUsage(u map[string]any) *Usage {
	if u == nil {
		return nil
	}
	input := Numeric(u["promptTokenCount"])
	thoughts, thoughtsKnown := nativeTokenCount(u["thoughtsTokenCount"])
	output := Numeric(u["candidatesTokenCount"]) + thoughts
	hit, hitKnown := nativeTokenCount(u["cachedContentTokenCount"])
	result := &Usage{PromptTokens: input, CompletionTokens: output, TotalTokens: input + output, PromptCacheHitTokens: hit, PromptCacheMissTokens: max(0, input-hit)}
	// Google 没命中缓存时常常不给 cachedContentTokenCount：缺字段是未知，不记成 0 命中。
	result.CacheHitKnown = hitKnown
	if thoughtsKnown {
		result.CompletionTokensDetails = &struct {
			ReasoningTokens int `json:"reasoning_tokens"`
		}{thoughts}
	}
	return result
}
func ParseGoogle(data []byte, send func(Event) error) (Message, *Usage, error) {
	var env googleEnvelope
	if err := json.Unmarshal(data, &env); err != nil {
		return Message{}, nil, err
	}
	if len(env.Error) > 0 || len(env.Candidates) != 1 {
		return Message{}, nil, fmt.Errorf("Google API 未返回完整候选结果")
	}
	m, err := NativeMessage(env.ResponseID, env.Candidates[0].Finish, env.Candidates[0].Content.Parts, true)
	if err == nil {
		err = nativeEvents(env.Candidates[0].Content.Parts, true, send)
	}
	return m, GoogleUsage(env.Usage), err
}
func ReadGoogle(reader io.Reader, send func(Event) error) (Message, *Usage, error) {
	var id, finish string
	parts := []map[string]any{}
	var usage map[string]any
	err := ReadSSE(reader, func(data []byte) error {
		var env googleEnvelope
		if json.Unmarshal(data, &env) != nil || len(env.Error) > 0 || len(env.Candidates) > 1 {
			return fmt.Errorf("Google 流分片无效")
		}
		if env.ResponseID != "" {
			if id != "" && id != env.ResponseID {
				return fmt.Errorf("Google 流身份变化")
			}
			id = env.ResponseID
		}
		if len(env.Candidates) > 0 {
			c := env.Candidates[0]
			if finish != "" && len(c.Content.Parts) > 0 {
				return fmt.Errorf("Google 结束后仍有数据")
			}
			if len(parts)+len(c.Content.Parts) > 4096 {
				return fmt.Errorf("Google 响应块过多")
			}
			parts = append(parts, c.Content.Parts...)
			if err := nativeEvents(c.Content.Parts, true, send); err != nil {
				return err
			}
			if c.Finish != "" {
				finish = c.Finish
			}
		}
		if env.Usage != nil {
			usage = env.Usage
		}
		return nil
	})
	if err != nil {
		return Message{}, nil, err
	}
	m, err := NativeMessage(id, finish, parts, true)
	return m, GoogleUsage(usage), err
}
