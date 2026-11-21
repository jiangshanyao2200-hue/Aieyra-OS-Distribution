// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: WorkspaceAskOption; WorkspaceAskRequest; cloneWorkspaceAsks; AskUserToolDefinition; askUserAvailable; askUser; askUserReceipt; pendingAsksLocked; askAnswerDisplay; replyAsk
// Impact: python -B scripts/code-atlas.py show Core/workspace_ask.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

type WorkspaceAskOption struct {
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
}

// Pending questions outlive run goroutines. Closed receipts remain private
// so uncertain tool or answer acknowledgements cannot create duplicates.
type WorkspaceAskRequest struct {
	ID          string               `json:"id"`
	Question    string               `json:"question"`
	Options     []WorkspaceAskOption `json:"options,omitempty"`
	Recommended int                  `json:"recommended,omitempty"`
	Assumption  string               `json:"assumption"`
	Generation  int                  `json:"generation"`
	State       string               `json:"state"`
	At          string               `json:"at"`
	CallKey     string               `json:"call_key,omitempty"`
	CallHash    string               `json:"call_hash,omitempty"`
	ReplyID     string               `json:"reply_id,omitempty"`
	ReplyHash   string               `json:"reply_hash,omitempty"`
}

func cloneWorkspaceAsks(rows []WorkspaceAskRequest) []WorkspaceAskRequest {
	copy := append([]WorkspaceAskRequest(nil), rows...)
	for i := range copy {
		copy[i].Options = append([]WorkspaceAskOption(nil), rows[i].Options...)
	}
	return copy
}

func AskUserToolDefinition() ToolDefinition {
	text := func(limit int) any { return map[string]any{"type": "string", "minLength": 1, "maxLength": limit} }
	return ToolDefinition{Type: "function", Name: "ask_user", Description: runtimePrompt("Matrix/工具说明/询问用户.txt"), Parameters: schemaObject(map[string]any{
		"question": text(200), "recommendation": text(1000),
	}, "question", "recommendation")}
}

func (w *Workspace) askUserAvailable(role string) bool {
	return w != nil && w.Mode() == HostOS && !w.isTerminal() && w.split == nil && role == WorkspaceMatrix
}

func (w *Workspace) askUser(ctx context.Context, role string, raw json.RawMessage) (any, error) {
	if !w.askUserAvailable(role) {
		return nil, fmt.Errorf("ask_user is only available to the primary desktop Eyra")
	}
	var p struct {
		Question       string               `json:"question"`
		Options        []WorkspaceAskOption `json:"options"`
		Recommended    int                  `json:"recommended"`
		Assumption     string               `json:"assumption"`
		Recommendation string               `json:"recommendation"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, fmt.Errorf("invalid ask_user arguments")
	}
	if p.Recommendation != "" {
		p.Assumption = p.Recommendation
	}
	p.Question, p.Assumption = strings.TrimSpace(p.Question), strings.TrimSpace(p.Assumption)
	if p.Question == "" || utf8.RuneCountInString(p.Question) > 200 || p.Assumption == "" || utf8.RuneCountInString(p.Assumption) > 1000 || len(p.Options) > 4 || p.Recommended < 0 || p.Recommended > len(p.Options) {
		return nil, fmt.Errorf("问题最多 200 字，须提供 1000 字以内的推荐做法；旧选项序号须有效")
	}
	for i := range p.Options {
		p.Options[i].Label = strings.TrimSpace(p.Options[i].Label)
		if p.Options[i].Label == "" || utf8.RuneCountInString(p.Options[i].Label) > 80 || utf8.RuneCountInString(p.Options[i].Description) > 200 {
			return nil, fmt.Errorf("选项需要 80 字以内的名称和 200 字以内的一句说明")
		}
	}
	key, _ := ctx.Value(toolInvocationKey{}).(string)
	if key == "" {
		return nil, fmt.Errorf("ask_user requires a tool invocation receipt")
	}
	hash := workspaceTextHash(string(rawJSON(p)))
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed || w.updateFrozen {
		return nil, fmt.Errorf("工作区正在交接")
	}
	pending := 0
	for _, q := range w.state.AskRequests {
		if q.CallKey == key {
			if q.CallHash != hash {
				return nil, fmt.Errorf("提问调用标识冲突")
			}
			return askUserReceipt(q), nil
		}
		if q.State == "pending" {
			pending++
		}
	}
	if pending >= 3 {
		return nil, fmt.Errorf("已有 3 个问题等待回答，暂不能新增问题；尚未收到这些问题的答复")
	}
	q := WorkspaceAskRequest{ID: "ask-" + workspaceID(), Question: w.manager.redact(p.Question), Options: p.Options, Recommended: p.Recommended, Assumption: w.manager.redact(p.Assumption), State: "pending", At: time.Now().UTC().Format(time.RFC3339Nano), CallKey: key, CallHash: hash}
	for i := range q.Options {
		q.Options[i].Label = w.manager.redact(q.Options[i].Label)
		q.Options[i].Description = w.manager.redact(q.Options[i].Description)
	}
	if id := w.state.Roles[WorkspaceMatrix]; id != "" {
		if record, err := w.manager.Status(w.state.ID, id); err == nil {
			q.Generation = record.Generation
		}
	}
	if err := w.beginContextBookLocked(); err != nil {
		return nil, err
	}
	w.state.AskRequests = append(w.state.AskRequests, q)
	if err := w.saveLocked(); err != nil {
		w.state.AskRequests = w.state.AskRequests[:len(w.state.AskRequests)-1]
		return nil, err
	}
	w.feed.publish(WorkspaceMatrix, "ask_user", map[string]string{"id": q.ID})
	return askUserReceipt(q), nil
}

func askUserReceipt(q WorkspaceAskRequest) any {
	return map[string]any{"ok": true, "id": q.ID, "state": q.State, "message": runtimePrompt("Matrix/辅助指令/提问回执.txt")}
}

func (w *Workspace) pendingAsksLocked() []WorkspaceAskRequest {
	rows := []WorkspaceAskRequest{}
	for _, q := range w.state.AskRequests {
		if q.State != "pending" {
			continue
		}
		q.Options = append([]WorkspaceAskOption(nil), q.Options...)
		q.CallKey, q.CallHash, q.ReplyID, q.ReplyHash = "", "", "", ""
		rows = append(rows, q)
	}
	return rows
}

const (
	askAnswerPrefix    = "【用户回答你的提问】问："
	askAnswerSeparator = " 答："
	askAnswerSkipped   = "用户跳过了这个问题，按你的假设继续。"
	askAnswerAccepted  = "用户主动接受推荐。推荐："
)

// askAnswerDisplay recovers the short chat text replyAsk shows for its own
// model-facing wrapper, for history read back from the durable original. Any
// text that does not match the exact host format is returned unchanged.
func askAnswerDisplay(text string) (string, bool) {
	rest, ok := strings.CutPrefix(text, askAnswerPrefix)
	if !ok {
		return text, false
	}
	_, body, ok := strings.Cut(rest, askAnswerSeparator)
	if !ok {
		return text, false
	}
	if strings.HasPrefix(body, askAnswerSkipped) {
		return "回答：已跳过这个问题，按你的假设继续", true
	}
	if recommendation, accepted := strings.CutPrefix(body, askAnswerAccepted); accepted {
		return "回答：采用推荐 — " + recommendation, true
	}
	if !strings.HasSuffix(body, "）") {
		return text, false
	}
	if i := strings.LastIndex(body, "（选了 "); i > 0 {
		return "回答：" + body[:i], true
	}
	// Free text only: "<text>（写了 <text>）".
	const open, end = "（写了 ", "）"
	if n := len(body) - len(open) - len(end); n > 0 && n%2 == 0 {
		answer := body[:n/2]
		if body == answer+open+answer+end {
			return "回答：" + answer, true
		}
	}
	return text, false
}

func (w *Workspace) replyAsk(raw json.RawMessage) (any, error) {
	if !w.askUserAvailable(WorkspaceMatrix) {
		return nil, fmt.Errorf("桌面 Eyra 提问不可用")
	}
	var p struct {
		ID        string `json:"id"`
		RequestID string `json:"request_id"`
		Action    string `json:"action"`
		Option    int    `json:"option"`
		Text      string `json:"text"`
	}
	if json.Unmarshal(raw, &p) != nil {
		return nil, fmt.Errorf("无效答复")
	}
	p.Text = strings.TrimSpace(p.Text)
	if p.Action != "answer" && p.Action != "skip" && p.Action != "later" {
		return nil, fmt.Errorf("无效答复动作")
	}
	if p.Action != "later" && (p.RequestID == "" || len(p.RequestID) > 128 || len(p.Text) > 60<<10) {
		return nil, fmt.Errorf("答复或请求标识无效")
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed || w.updateFrozen {
		return nil, fmt.Errorf("工作区正在交接")
	}
	for i := range w.state.AskRequests {
		q := &w.state.AskRequests[i]
		if q.ID != p.ID {
			continue
		}
		if p.Option < 0 || p.Option > len(q.Options) {
			return nil, fmt.Errorf("请选择有效选项，或只写下你的想法")
		}
		if p.Action == "later" {
			return map[string]any{"ok": true, "id": q.ID, "state": q.State}, nil
		}
		hash := workspaceTextHash(string(rawJSON([]any{p.Action, p.Option, p.Text})))
		if q.State != "pending" {
			if q.ReplyHash != hash {
				return nil, fmt.Errorf("这个问题已经回答或跳过")
			}
			return map[string]any{"ok": true, "id": q.ID, "request_id": q.ReplyID, "state": q.State}, nil
		}
		text, display := askAnswerPrefix+q.Question+askAnswerSeparator, "回答："
		if p.Action == "skip" {
			text += askAnswerSkipped + "假设：" + q.Assumption
			display += "已跳过这个问题，按你的假设继续"
		} else if p.Option == 0 && p.Text == "" {
			text += askAnswerAccepted + q.Assumption
			display += "采用推荐 — " + q.Assumption
		} else {
			var answer, details []string
			if p.Option > 0 {
				label := q.Options[p.Option-1].Label
				answer = append(answer, label)
				details = append(details, fmt.Sprintf("选了 %c", 'A'+p.Option-1))
			}
			if p.Text != "" {
				answer = append(answer, w.manager.redact(p.Text))
				details = append(details, "写了 "+w.manager.redact(p.Text))
			}
			text += strings.Join(answer, " · ") + "（" + strings.Join(details, " / ") + "）"
			display += strings.Join(answer, " · ")
		}
		old := *q
		q.State, q.ReplyID, q.ReplyHash = p.Action, p.RequestID, hash
		_, err := w.enqueueAttachmentsLocked("user", WorkspaceMatrix, p.RequestID, text, "queued", workspaceTextHash(text), nil, display)
		if err != nil {
			*q = old
			return nil, err
		}
		return map[string]any{"ok": true, "id": q.ID, "request_id": p.RequestID, "state": p.Action}, nil
	}
	return nil, fmt.Errorf("这个问题不存在，请刷新后重试")
}
