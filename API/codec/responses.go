// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/codec/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: NewResponseDecoder; responsePart; responseItem; ResponseEnvelope; UsageValue; Message; responseSSE; ReasoningEvents; responseTextBuffer; responseSlot; ResponseDecoder; slot; drain; emitText; bodyActivity; reasoningActivity; textKind; toolArgumentsAgree; settleText; Item; Feed; ReadResponseStream
// Impact: python -B scripts/code-atlas.py show API/codec/responses.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package codec

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"

	"github.com/aieyra/aieyra-os/api/transport"
)

// NewResponseDecoder keeps one ordered, validated response assembly per request.
func NewResponseDecoder(send func(Event) error) *ResponseDecoder {
	return &ResponseDecoder{slots: map[int]*responseSlot{}, seen: map[int64][32]byte{}, send: send}
}

type responsePart struct {
	Type string `json:"type"`
	Text string `json:"text"`
}
type responseItem struct {
	Type      string         `json:"type"`
	ID        string         `json:"id"`
	Status    string         `json:"status"`
	Role      string         `json:"role"`
	Content   []responsePart `json:"content"`
	Summary   []responsePart `json:"summary"`
	CallID    string         `json:"call_id"`
	Name      string         `json:"name"`
	Arguments string         `json:"arguments"`
}
type ResponseEnvelope struct {
	ID     string            `json:"id"`
	Status string            `json:"status"`
	Output []json.RawMessage `json:"output"`
	Usage  *struct {
		Input        int `json:"input_tokens"`
		Output       int `json:"output_tokens"`
		Total        int `json:"total_tokens"`
		InputDetails *struct {
			Cached *int `json:"cached_tokens"`
		} `json:"input_tokens_details"`
		OutputDetails *struct {
			Reasoning *int `json:"reasoning_tokens"`
		} `json:"output_tokens_details"`
	} `json:"usage"`
	Error *struct {
		Code    string `json:"code"`
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"error"`
	Incomplete *struct {
		Reason string `json:"reason"`
	} `json:"incomplete_details"`
}

func (r ResponseEnvelope) UsageValue() *Usage {
	if r.Usage == nil {
		return nil
	}
	u := &Usage{PromptTokens: r.Usage.Input, CompletionTokens: r.Usage.Output, TotalTokens: r.Usage.Total}
	if u.TotalTokens == 0 {
		u.TotalTokens = u.PromptTokens + u.CompletionTokens
	}
	// input_tokens_details 为 {} 时缓存仍是未知，不记成 0 命中。
	if d := r.Usage.InputDetails; d != nil && d.Cached != nil {
		u.PromptCacheHitTokens, u.CacheHitKnown = *d.Cached, true
		u.PromptCacheMissTokens = max(0, u.PromptTokens-*d.Cached)
		u.PromptTokensDetails = &struct {
			CachedTokens int `json:"cached_tokens"`
		}{*d.Cached}
	}
	if d := r.Usage.OutputDetails; d != nil && d.Reasoning != nil {
		u.CompletionTokensDetails = &struct {
			ReasoningTokens int `json:"reasoning_tokens"`
		}{*d.Reasoning}
	}
	return u
}
func (r ResponseEnvelope) Message() (Message, error) {
	m := Message{Role: RoleAssistant, ResponseID: r.ID, FinishReason: "stop"}
	if r.Status == "failed" {
		// A failed terminal is never an executable result, even if its output
		// contains malformed items. The HTTP caller supplies the real status.
		if r.Error != nil {
			return m, &transport.APIError{Code: r.Error.Code, Type: r.Error.Type, Message: r.Error.Message}
		}
		return m, fmt.Errorf("Responses 未正常完成：failed")
	}
	ids := map[string]bool{}
	itemIDs := map[string]bool{}
	for _, raw := range r.Output {
		var item responseItem
		if err := json.Unmarshal(raw, &item); err != nil {
			return m, fmt.Errorf("Responses 输出项不完整：%w", err)
		}
		if item.ID != "" {
			if itemIDs[item.ID] {
				return m, fmt.Errorf("Responses 输出项 ID 重复")
			}
			itemIDs[item.ID] = true
		}
		if r.Status == "completed" && item.Status != "" && item.Status != "completed" {
			return m, fmt.Errorf("Responses 输出项尚未完成")
		}
		switch item.Type {
		case "message", "reasoning":
			for _, part := range item.Content {
				switch part.Type {
				case "output_text":
					m.Content += part.Text
				case "reasoning_text":
					m.ReasoningContent += part.Text
				case "refusal":
					return m, fmt.Errorf("模型拒绝生成该内容")
				}
			}
			if item.Type == "reasoning" {
				for _, part := range item.Summary {
					if part.Type == "summary_text" {
						m.ReasoningContent += part.Text
					}
				}
			}
		case "function_call":
			if r.Status == "incomplete" {
				m.IncompleteTools = append(m.IncompleteTools, ToolCall{ID: item.CallID, Type: "function", Function: FunctionCall{Name: item.Name, Arguments: item.Arguments}})
			}
			if r.Status == "completed" {
				if item.CallID == "" || item.Name == "" || ids[item.CallID] || !json.Valid([]byte(item.Arguments)) {
					return m, fmt.Errorf("Responses 工具调用参数或身份无效")
				}
				ids[item.CallID] = true
				m.ToolCalls = append(m.ToolCalls, ToolCall{ID: item.CallID, Type: "function", Function: FunctionCall{Name: item.Name, Arguments: item.Arguments}})
			}
		case "custom_tool_call":
			return m, fmt.Errorf("仅支持已注册的普通 function 工具；当前供应商不支持 custom_tool_call")
		}
	}
	if r.Status == "completed" {
		if r.ID == "" {
			return m, fmt.Errorf("Responses 缺少响应 ID")
		}
		m.ResponseItems = append([]json.RawMessage(nil), r.Output...)
		if len(m.ToolCalls) > 0 {
			m.FinishReason = "tool_calls"
		}
	} else if r.Status == "incomplete" {
		m.FinishReason = "length"
		if r.Incomplete != nil && r.Incomplete.Reason != "" && r.Incomplete.Reason != "max_output_tokens" {
			return m, fmt.Errorf("Responses 输出中断：%s", r.Incomplete.Reason)
		}
	} else {
		detail := r.Status
		if r.Error != nil {
			detail = r.Error.Message
		}
		return m, fmt.Errorf("Responses 未正常完成：%s", detail)
	}
	return m, nil
}

type responseSSE struct {
	Type         string            `json:"type"`
	Code         string            `json:"code"`
	Message      string            `json:"message"`
	Sequence     *int64            `json:"sequence_number"`
	OutputIndex  int               `json:"output_index"`
	ContentIndex int               `json:"content_index"`
	SummaryIndex int               `json:"summary_index"`
	ItemID       string            `json:"item_id"`
	Delta        string            `json:"delta"`
	Text         string            `json:"text"`
	Arguments    string            `json:"arguments"`
	Item         json.RawMessage   `json:"item"`
	Part         *responsePart     `json:"part"`
	Response     *ResponseEnvelope `json:"response"`
}

// 非流式响应也按供应商原通道标注；摘要不能被显示成完整公开思考。
func (r ResponseEnvelope) ReasoningEvents() []Event {
	var events []Event
	for _, raw := range r.Output {
		var item struct {
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
			Summary []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"summary"`
		}
		if json.Unmarshal(raw, &item) != nil {
			continue
		}
		for _, part := range item.Content {
			if part.Type == "reasoning_text" && part.Text != "" {
				events = append(events, Event{Kind: EventReasoning, Text: part.Text, ReasoningKind: "text"})
			}
		}
		for _, part := range item.Summary {
			if part.Type == "summary_text" && part.Text != "" {
				events = append(events, Event{Kind: EventReasoning, Text: part.Text, ReasoningKind: "summary"})
			}
		}
	}
	if len(events) == 0 {
		events = append(events, Event{Kind: EventReasoning})
	}
	return events
}

type responseTextBuffer struct {
	text          strings.Builder
	kind          EventKind
	reasoningKind string
	outputIndex   *int
	contentIndex  int
	correction    bool
	sent          int
	done          bool
	endSent       bool
}
type responseSlot struct {
	id               string
	kind             string
	callID, name     string
	parts            map[int]*responseTextBuffer
	arguments        string
	argsDone         bool
	done             bool
	reasoningStarted bool
	reasoningEnded   bool
}
type ResponseDecoder struct {
	slots       map[int]*responseSlot
	seen        map[int64][32]byte
	lastSeq     int64
	haveSeq     bool
	id          string
	send        func(Event) error
	bodyStarted bool
	bodyIndex   int
}

func (a *ResponseDecoder) slot(index int, id string) (*responseSlot, error) {
	if index < 0 || index > 1024 {
		return nil, fmt.Errorf("Responses 输出索引异常")
	}
	s := a.slots[index]
	if s == nil {
		s = &responseSlot{parts: map[int]*responseTextBuffer{}, id: id}
		a.slots[index] = s
	}
	if s.id != "" && id != "" && s.id != id {
		return nil, fmt.Errorf("Responses 输出项身份发生变化")
	}
	if id != "" {
		s.id = id
	}
	return s, nil
}

// 思考是到达时的活动，不是正文前面的播放队列。独立传递思考及其结束，
// 正文只等待更早的正文；未知输出项仍保留顺序屏障，不能猜测其内容。
func (a *ResponseDecoder) drain() error {
	indices := make([]int, 0, len(a.slots))
	for i := range a.slots {
		indices = append(indices, i)
	}
	sort.Ints(indices)
	for _, i := range indices {
		s := a.slots[i]
		parts := make([]int, 0, len(s.parts))
		for j := range s.parts {
			parts = append(parts, j)
		}
		sort.Ints(parts)
		for _, j := range parts {
			p := s.parts[j]
			if p.kind == EventReasoning {
				if err := a.emitText(p); err != nil {
					return err
				}
			}
		}
	}
	for i := 0; i < len(a.slots); i++ {
		s := a.slots[i]
		if s == nil {
			return nil
		}
		if s.kind == "reasoning" || s.kind == "function_call" {
			continue
		}
		parts := make([]int, 0, len(s.parts))
		for j := range s.parts {
			parts = append(parts, j)
		}
		sort.Ints(parts)
		for next, j := range parts {
			if !s.done && j != next {
				return nil
			}
			p := s.parts[j]
			if p == nil {
				return nil
			}
			if p.kind == EventReasoning {
				continue
			}
			if err := a.emitText(p); err != nil {
				return err
			}
			if !p.done {
				return nil
			}
		}
		if !s.done {
			return nil
		}
	}
	return nil
}

func (a *ResponseDecoder) emitText(p *responseTextBuffer) error {
	if p.correction {
		if err := a.send(Event{Kind: EventTextCorrection, CorrectionKind: p.kind, Text: p.text.String(), ReasoningKind: p.reasoningKind, OutputIndex: p.outputIndex, ContentIndex: &p.contentIndex}); err != nil {
			return err
		}
		p.sent = p.text.Len()
		p.correction = false
	}
	if p.sent < p.text.Len() {
		if err := a.send(Event{Kind: p.kind, Text: p.text.String()[p.sent:], ReasoningKind: p.reasoningKind, OutputIndex: p.outputIndex, ContentIndex: &p.contentIndex}); err != nil {
			return err
		}
		p.sent = p.text.Len()
	}
	if p.done && p.kind == EventReasoning && !p.endSent {
		if err := a.send(Event{Kind: EventReasoningDone, OutputIndex: p.outputIndex}); err != nil {
			return err
		}
		p.endSent = true
	}
	return nil
}

func (a *ResponseDecoder) bodyActivity(index int, text string) error {
	if text == "" || a.bodyStarted && index <= a.bodyIndex {
		return nil
	}
	a.bodyStarted = true
	a.bodyIndex = index
	return a.send(Event{Kind: EventBodyPreparing, Text: text, OutputIndex: &index})
}

func (a *ResponseDecoder) reasoningActivity(s *responseSlot, index int) error {
	if s.reasoningStarted || s.done {
		return nil
	}
	s.reasoningStarted = true
	return a.send(Event{Kind: EventReasoningStart, OutputIndex: &index})
}

func (s *responseSlot) textKind(kind EventKind) error {
	want := "message"
	if kind == EventReasoning {
		want = "reasoning"
	}
	if s.kind != "" && s.kind != want && !((s.kind == "message" || s.kind == "reasoning") && (want == "message" || want == "reasoning")) {
		return fmt.Errorf("Responses 输出项内容类型不一致")
	}
	s.kind = want
	return nil
}

// Full public text is authoritative, even after a previous done event. Tool
// arguments deliberately use a separate strict validation path below.
// Some gateways (Gemini via OpenAI-compatible Responses) re-serialize the final
// arguments: same JSON value, different whitespace or key order. Only a real
// semantic difference may stop tool execution.
func toolArgumentsAgree(streamed, full string, done bool) bool {
	if !done && strings.HasPrefix(full, streamed) || done && full == streamed {
		return true
	}
	if streamed == "" {
		return !done
	}
	var a, b any
	if json.Unmarshal([]byte(streamed), &a) != nil || json.Unmarshal([]byte(full), &b) != nil {
		return false
	}
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return bytes.Equal(x, y)
}

func (a *ResponseDecoder) settleText(p *responseTextBuffer, full string) error {
	old := p.text.String()
	if p.done && full != old || !strings.HasPrefix(full, old) {
		first := 0
		for first < len(old) && first < len(full) && old[first] == full[first] {
			first++
		}
		kind := "output_text"
		if p.kind == EventReasoning {
			kind = "reasoning_" + p.reasoningKind
		}
		// No text, arguments, credentials or provider payload in this diagnostic.
		if err := a.send(Event{Kind: EventWarn, Err: fmt.Errorf("Responses 文本纠正：type=%s old_bytes=%d full_bytes=%d first_diff_byte=%d", kind, len(old), len(full), first)}); err != nil {
			return err
		}
	}
	if p.sent > 0 && (len(full) < p.sent || full[:p.sent] != old[:p.sent]) {
		p.correction = true
	}
	p.text.Reset()
	p.text.WriteString(full)
	p.done = true
	return nil
}
func (a *ResponseDecoder) Item(index int, raw json.RawMessage, done bool) error {
	var item responseItem
	if err := json.Unmarshal(raw, &item); err != nil {
		return err
	}
	s, err := a.slot(index, item.ID)
	if err != nil {
		return err
	}
	if s.kind != "" && s.kind != item.Type && !((s.kind == "message" || s.kind == "reasoning") && (item.Type == "message" || item.Type == "reasoning")) {
		return fmt.Errorf("Responses 输出项类型发生变化")
	}
	s.kind = item.Type
	if item.Type == "reasoning" && !done {
		if err := a.reasoningActivity(s, index); err != nil {
			return err
		}
	}
	if done {
		for index := range s.parts {
			if index < 2048 && index >= len(item.Content) || index >= 2048 && index-2048 >= len(item.Summary) {
				if err := a.settleText(s.parts[index], ""); err != nil {
					return err
				}
			}
		}
	}
	allParts := map[int]responsePart{}
	for i, part := range item.Content {
		allParts[i] = part
	}
	for i, part := range item.Summary {
		allParts[2048+i] = part
	}
	for i, part := range allParts {
		if part.Type != "output_text" && part.Type != "reasoning_text" && part.Type != "summary_text" {
			continue
		}
		kind := EventDelta
		if part.Type == "reasoning_text" || part.Type == "summary_text" {
			kind = EventReasoning
		}
		if err := s.textKind(kind); err != nil {
			return err
		}
		p := s.parts[i]
		if p == nil {
			p = &responseTextBuffer{kind: kind, outputIndex: &index, contentIndex: i}
			s.parts[i] = p
		}
		if part.Type == "summary_text" {
			p.reasoningKind = "summary"
		} else if kind == EventReasoning {
			p.reasoningKind = "text"
		}
		if p.kind != kind {
			if err := a.settleText(p, ""); err != nil {
				return err
			}
			if err := a.emitText(p); err != nil {
				return err
			}
			p = &responseTextBuffer{kind: kind, outputIndex: p.outputIndex, contentIndex: p.contentIndex, reasoningKind: p.reasoningKind}
			s.parts[p.contentIndex] = p
		}
		if done {
			if err := a.settleText(p, part.Text); err != nil {
				return err
			}
		} else if p.text.Len() == 0 {
			p.text.WriteString(part.Text)
		}
		if kind == EventDelta {
			if err := a.bodyActivity(index, part.Text); err != nil {
				return err
			}
		}
	}
	if item.Type == "function_call" {
		if s.callID != "" && item.CallID != s.callID || s.name != "" && item.Name != s.name {
			return fmt.Errorf("工具调用身份发生变化")
		}
		s.callID, s.name = item.CallID, item.Name
		if done {
			if !toolArgumentsAgree(s.arguments, item.Arguments, s.argsDone) {
				return fmt.Errorf("工具完整参数与分片不一致，已停止执行工具")
			}
			s.arguments = item.Arguments
			s.argsDone = true
		} else if s.arguments == "" {
			s.arguments = item.Arguments
		}
		if err := a.send(Event{Kind: EventToolPreparing, OutputIndex: &index}); err != nil {
			return err
		}
	}
	if done {
		s.done = true
	}
	if err := a.drain(); err != nil {
		return err
	}
	if done && s.reasoningStarted && !s.reasoningEnded {
		s.reasoningEnded = true
		// Public parts already emit their own end; an opaque item has no
		// text buffer, but its real completion must still end activity.
		for _, p := range s.parts {
			if p.kind == EventReasoning && p.endSent {
				return nil
			}
		}
		return a.send(Event{Kind: EventReasoningDone, OutputIndex: &index})
	}
	return nil
}
func (a *ResponseDecoder) Feed(payload, eventType string) (bool, error) {
	var e responseSSE
	if err := json.Unmarshal([]byte(payload), &e); err != nil {
		return false, fmt.Errorf("Responses SSE 无效，已停止：%w", err)
	}
	if e.Type == "" {
		e.Type = eventType
	}
	if eventType != "" && eventType != e.Type {
		return false, fmt.Errorf("SSE 事件名不一致")
	}
	if e.Sequence != nil {
		hash := sha256.Sum256([]byte(payload))
		if old, ok := a.seen[*e.Sequence]; ok {
			if old != hash {
				return false, fmt.Errorf("重复序号内容冲突")
			}
			return false, nil
		}
		if a.haveSeq && *e.Sequence < a.lastSeq {
			return false, fmt.Errorf("SSE 序号逆序")
		}
		a.lastSeq = *e.Sequence
		a.haveSeq = true
		a.seen[*e.Sequence] = hash
	}
	if e.Response != nil && e.Response.ID != "" {
		if a.id != "" && a.id != e.Response.ID {
			return false, fmt.Errorf("Responses 响应身份不一致")
		}
		a.id = e.Response.ID
	}
	switch e.Type {
	case "response.output_item.added", "response.output_item.done":
		return false, a.Item(e.OutputIndex, e.Item, e.Type == "response.output_item.done")
	case "response.output_text.delta", "response.reasoning_text.delta", "response.output_text.done", "response.reasoning_text.done", "response.content_part.added", "response.content_part.done", "response.reasoning_summary_text.delta", "response.reasoning_summary_text.done", "response.reasoning_summary_part.added", "response.reasoning_summary_part.done":
		summary := strings.Contains(e.Type, "reasoning_summary")
		if summary {
			if e.SummaryIndex < 0 || e.SummaryIndex > 1024 {
				return false, fmt.Errorf("思考摘要索引异常")
			}
		}
		if e.ContentIndex < 0 || e.ContentIndex > 1024 {
			return false, fmt.Errorf("内容索引异常")
		}
		s, err := a.slot(e.OutputIndex, e.ItemID)
		if err != nil {
			return false, err
		}
		kind := EventDelta
		if summary || strings.Contains(e.Type, "reasoning_text") || e.Part != nil && e.Part.Type == "reasoning_text" {
			kind = EventReasoning
		}
		if err := s.textKind(kind); err != nil {
			return false, err
		}
		if kind == EventReasoning && !strings.HasSuffix(e.Type, ".done") {
			if e.Delta != "" || e.Part != nil && e.Part.Text != "" {
				// The following text event already carries actual activity.
				s.reasoningStarted = true
			} else if err := a.reasoningActivity(s, e.OutputIndex); err != nil {
				return false, err
			}
		}
		index := e.ContentIndex
		if summary {
			index = 2048 + e.SummaryIndex
		}
		p := s.parts[index]
		if p == nil {
			p = &responseTextBuffer{kind: kind, outputIndex: &e.OutputIndex, contentIndex: index}
			s.parts[index] = p
		}
		if summary {
			p.reasoningKind = "summary"
		} else if kind == EventReasoning {
			p.reasoningKind = "text"
		}
		if p.kind != kind {
			if err := a.settleText(p, ""); err != nil {
				return false, err
			}
			if err := a.emitText(p); err != nil {
				return false, err
			}
			p = &responseTextBuffer{kind: kind, outputIndex: p.outputIndex, contentIndex: p.contentIndex, reasoningKind: p.reasoningKind}
			s.parts[p.contentIndex] = p
		}
		if strings.HasSuffix(e.Type, ".delta") {
			if p.done {
				// The complete public text already won. Ignore a late display delta;
				// late function arguments remain a fatal validation error below.
				return false, a.send(Event{Kind: EventWarn, Err: fmt.Errorf("Responses 完成后忽略文本增量：type=%s delta_bytes=%d", e.Type, len(e.Delta))})
			}
			p.text.WriteString(e.Delta)
		} else if strings.HasSuffix(e.Type, ".done") {
			text := e.Text
			if e.Part != nil {
				text = e.Part.Text
			}
			if err = a.settleText(p, text); err != nil {
				return false, err
			}
		} else if e.Part != nil && p.text.Len() == 0 {
			p.text.WriteString(e.Part.Text)
		}
		if kind == EventDelta {
			if err := a.bodyActivity(e.OutputIndex, p.text.String()); err != nil {
				return false, err
			}
		}
		return false, a.drain()
	case "response.function_call_arguments.delta", "response.function_call_arguments.done":
		s, err := a.slot(e.OutputIndex, e.ItemID)
		if err != nil {
			return false, err
		}
		if s.kind != "" && s.kind != "function_call" {
			return false, fmt.Errorf("Responses 工具内容类型不一致")
		}
		s.kind = "function_call"
		if strings.HasSuffix(e.Type, ".delta") {
			if s.argsDone {
				return false, fmt.Errorf("完成后的工具参数又收到增量")
			}
			s.arguments += e.Delta
			if len(s.arguments) > 256<<10 {
				return false, fmt.Errorf("工具参数超过 256 KiB")
			}
		} else {
			// An empty done frame can end the deltas without repeating their
			// payload. The final output item must still match the kept bytes.
			if e.Arguments != "" {
				if !toolArgumentsAgree(s.arguments, e.Arguments, s.argsDone) {
					return false, fmt.Errorf("工具参数不一致，已停止执行工具")
				}
				s.arguments = e.Arguments
			}
			s.argsDone = true
		}
		return false, a.send(Event{Kind: EventToolPreparing, OutputIndex: &e.OutputIndex})
	case "response.completed", "response.incomplete", "response.failed":
		if e.Response == nil {
			return false, fmt.Errorf("缺少最终 Responses 对象")
		}
		env := *e.Response
		expected := strings.TrimPrefix(e.Type, "response.")
		if env.Status != expected {
			return false, fmt.Errorf("Responses 终止状态不一致")
		}
		reject := func(err error) (bool, error) {
			// Output/tool validation and usage accounting are independent.
			// Keep the failure, but do not replace an actual receipt with an estimate.
			if env.Usage != nil {
				if usageErr := a.send(Event{Kind: EventUsage, Usage: env.UsageValue()}); usageErr != nil {
					return true, usageErr
				}
			}
			return true, err
		}
		if env.Status == "failed" {
			_, err := env.Message()
			return reject(err)
		}
		for i, raw := range env.Output {
			if err := a.Item(i, raw, true); err != nil {
				return reject(err)
			}
		}
		if len(a.slots) > len(env.Output) {
			return reject(fmt.Errorf("最终响应缺少已接收的输出项"))
		}
		for index := range a.slots {
			if index >= len(env.Output) {
				return reject(fmt.Errorf("最终响应缺少已接收的输出项"))
			}
		}
		m, err := env.Message()
		if err != nil {
			return reject(err)
		}
		if err = a.drain(); err != nil {
			return reject(err)
		}
		for _, ev := range []Event{{Kind: EventUsage, Usage: env.UsageValue()}, {Kind: EventResponse, Message: &m}, {Kind: EventFinish, Finish: m.FinishReason}, {Kind: EventDone}} {
			if err = a.send(ev); err != nil {
				return true, err
			}
		}
		return true, nil
	case "error":
		if strings.EqualFold(e.Code, "empty_response") {
			return true, streamProviderError(e.Code, "", e.Message)
		}
		return true, fmt.Errorf("Responses 返回 error 事件")
	}
	return false, nil
}
func ReadResponseStream(reader io.Reader, send func(Event) error) error {
	a := &ResponseDecoder{slots: map[int]*responseSlot{}, seen: map[int64][32]byte{}, send: send}
	r := bufio.NewReader(reader)
	var lines []string
	eventType := ""
	bytesRead := 0
	dispatch := func() (bool, error) {
		if len(lines) == 0 {
			eventType = ""
			return false, nil
		}
		payload := strings.Join(lines, "\n")
		lines = nil
		bytesRead = 0
		t := eventType
		eventType = ""
		return a.Feed(payload, t)
	}
	for {
		line, err := r.ReadString('\n')
		if err != nil && err != io.EOF {
			return fmt.Errorf("读取 Responses 中断：%w", err)
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			done, dispatchErr := dispatch()
			if dispatchErr != nil {
				return dispatchErr
			}
			if done {
				return nil
			}
		} else if strings.HasPrefix(line, "event:") {
			eventType = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		} else if strings.HasPrefix(line, "data:") {
			v := strings.TrimPrefix(line, "data:")
			v = strings.TrimPrefix(v, " ")
			bytesRead += len(v)
			if bytesRead > 16<<20 {
				return fmt.Errorf("SSE 事件超过 16 MiB")
			}
			lines = append(lines, v)
		}
		if err == io.EOF {
			done, dispatchErr := dispatch()
			if dispatchErr != nil {
				return dispatchErr
			}
			if done {
				return nil
			}
			return fmt.Errorf("Responses 连接在终止事件之前关闭，未执行工具：%w", io.ErrUnexpectedEOF)
		}
	}
}
