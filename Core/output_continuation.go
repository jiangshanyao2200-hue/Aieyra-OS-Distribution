// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: OutputLimitError; Error; outputContinuation; explicitOutput; apply; next; completedText
// Impact: python -B scripts/code-atlas.py show Core/output_continuation.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"strings"
)

// A terminal provider response is distinct from a broken stream. Only this
// typed outcome can initiate a continuation, and only in the main agent loop.
type OutputLimitError struct {
	Limit         int  `json:"limit"`
	ReasoningOnly bool `json:"reasoning_only"`
	Tools         int  `json:"incomplete_tools"`
}

func (e *OutputLimitError) Error() string {
	limit := ""
	if e.Limit > 0 {
		limit = fmt.Sprintf("（本次上限 %d tokens）", e.Limit)
	}
	if e.Tools > 0 {
		return "模型输出达到长度上限" + limit + "，工具参数未完整返回，未执行本次调用；可继续任务或调整最大输出。"
	}
	if e.ReasoningOnly {
		return "模型在给出正文前用完输出额度" + limit + "；可增加最大输出或降低思考预算后继续。"
	}
	return "模型输出达到长度上限" + limit + "，已收到文字保留；可继续任务或调整最大输出。"
}

type outputContinuation struct {
	attempts    int
	limit       int
	provider    string
	notice      string
	lastContent string
	partialText string
}

func explicitOutput(s *Settings, parameters json.RawMessage) bool {
	var selection struct {
		MaxTokens int `json:"max_tokens"`
	}
	if json.Unmarshal(parameters, &selection) == nil && selection.MaxTokens > 0 {
		return true
	}
	if p := s.activePoolProfile(); p != nil {
		selection.MaxTokens = 0
		if json.Unmarshal(p.Parameters, &selection) != nil {
			return true
		}
		return selection.MaxTokens > 0
	}
	return s.MaxTokens > 0
}

func (c *outputContinuation) apply(s *Settings, parameters json.RawMessage) {
	if c.provider != s.ProviderIdentity() {
		c.limit, c.notice = 0, ""
		return
	}
	if c.limit > s.MaxTokens && !explicitOutput(s, parameters) {
		s.MaxTokens = c.limit
	}
}

func (c *outputContinuation) next(s *Settings, parameters json.RawMessage, answer Message, input int) bool {
	if c.attempts >= 2 {
		return false
	}
	text := strings.TrimSpace(answer.Content)
	if text != "" && text == c.lastContent {
		return false
	}
	limit := s.MaxTokens
	if limit > 0 && !explicitOutput(s, parameters) {
		if p := s.activePoolProfile(); p != nil && p.OutputLimit > 0 {
			// Leave room for the retained partial text and continuation notice.
			room := s.ContextBudget().Window - input - EstimateMessages([]Message{{Role: RoleAssistant, Content: answer.Content}}) - 4096
			limit = max(s.MaxTokens, min(max(8192, s.MaxTokens*2), p.OutputLimit, room))
		}
	}
	// Repeating pure reasoning with the same exhausted budget makes no progress.
	if text == "" && len(answer.IncompleteTools) == 0 && (s.MaxTokens == 0 || limit <= s.MaxTokens) {
		return false
	}
	notice := runtimePrompt("Matrix/辅助指令/输出截断续作.txt")
	if strings.TrimSpace(notice) == "" {
		return false
	}
	c.attempts++
	c.limit, c.provider, c.notice, c.lastContent = limit, s.ProviderIdentity(), notice, text
	if len(answer.IncompleteTools) == 0 {
		c.partialText = c.completedText(answer.Content)
	} else {
		c.partialText = ""
	}
	return true
}

// The final UI must contain the prefix too; archived/model messages retain
// their original separate parts so the prefix is not duplicated in context.
func (c *outputContinuation) completedText(tail string) string {
	if c.partialText == "" || strings.HasPrefix(tail, c.partialText) {
		return tail
	}
	return c.partialText + tail
}
