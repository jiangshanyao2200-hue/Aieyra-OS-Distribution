// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: displayBoundary; pendingSend; beginDisplay; planSignature; visiblePlan; clearCompletedTools; sendMessage; resumeSend; visibleMessage; visibleLive; recordRound
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/display.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"encoding/json"
	"strings"

	"github.com/aieyra/aieyra-os/contracts/protocol"
	tea "github.com/charmbracelet/bubbletea"
)

// 显示边界独立于核心 generation；工作中补充仍属于同一执行任务。
type displayBoundary struct {
	live       map[string]protocol.WorkspaceLive
	messages   map[string]bool
	tools      map[string]bool
	plan       string
	generation int
}

type pendingSend struct {
	id, text string
	draft    draft
}

func (c *model) beginDisplay(text string, requests ...string) {
	id := ""
	if len(requests) > 0 {
		id = requests[0]
	}
	c.beginFlow(text, id)
	d := displayBoundary{live: map[string]protocol.WorkspaceLive{}, messages: map[string]bool{}, tools: map[string]bool{}}
	d.plan = c.planSignature()
	d.generation = c.taskGeneration
	for k, v := range c.snapshot.Live {
		d.live[k] = v
	}
	for _, m := range c.snapshot.Messages {
		d.messages[m.ID] = true
	}
	for _, r := range c.snapshot.Roles {
		for _, a := range r.Activity.Items {
			a.AgentID = r.ID
			d.tools[activityKey(a)] = true
		}
	}
	c.display = d
	c.clearLive()
	c.resetReceipt()
	c.pinned, c.pinnedPlan = nil, nil
	c.planExpanded = false
	c.userText = boundedText(text)
	c.userVisible, c.userVisibleFor = false, 0
	c.workRounds = map[string]bool{}
	c.taskStarted = true
	c.notice = ""
	c.rebuild()
}

func (c *model) planSignature() string {
	if c.snapshot.Plan == nil {
		return ""
	}
	v, _ := json.Marshal(struct {
		Plan       *livePlan
		Generation int
	}{c.snapshot.Plan, c.snapshot.PlanScope.Generation})
	return string(v)
}

func (c *model) visiblePlan() bool {
	p := c.snapshot.Plan
	return c.taskStarted && c.snapshot.Busy && p != nil && c.snapshot.PlanScope.Generation >= c.taskGeneration &&
		p.Status != "complete" && p.Status != "completed" && p.Status != "cancelled" && c.planSignature() != c.display.plan
}

func (c *model) clearCompletedTools() {
	if c.flow.inspect != "" {
		return
	}
	if len(c.activities) == 0 && c.pinned == nil && c.pinnedPlan == nil && !c.planExpanded && c.receipt == nil && !c.receiptPending {
		return
	}
	// Keep each preview's reading/folding clock across idle snapshots. Clearing
	// it here replayed completed tools every time the core was polled.
	c.pinned, c.pinnedPlan = nil, nil
	c.planExpanded = false
	c.resetReceipt()
}

func (c *model) sendMessage(p pendingSend) tea.Cmd {
	// 按请求身份去重；相同文字也可能是用户有意追加，不能吞掉新消息。
	for _, queued := range c.queuedSends {
		if queued.id == p.id {
			return nil
		}
	}
	c.beginDisplay(p.text, p.id)
	c.input.Reset()
	c.pastes = nil
	c.clearPasteState()
	c.growInput()
	c.inputEpoch++
	c.retryID, c.retryText = "", ""
	if c.failedSend != nil {
		if p.id != c.failedSend.id {
			c.queuedSends = append(c.queuedSends, p)
		}
		return c.resumeSend()
	}
	if c.sending != nil {
		c.queuedSends = append(c.queuedSends, p)
		return nil
	}
	c.sending = &p
	return c.action("send", "matrix.send", map[string]any{"request_id": p.id, "message": p.text}, p.draft.value)
}

func (c *model) resumeSend() tea.Cmd {
	if c.failedSend == nil || c.sending != nil {
		return nil
	}
	c.sending, c.failedSend = c.failedSend, nil
	p := c.sending
	return c.action("send", "matrix.send", map[string]any{"request_id": p.id, "message": p.text}, p.draft.value)
}

func (c *model) visibleMessage(id, text string) string {
	for _, old := range c.display.live {
		if old.BodyID == id && strings.HasPrefix(text, old.Text) {
			return strings.TrimPrefix(text, old.Text)
		}
	}
	return text
}

func (c *model) visibleLive(key string, v protocol.WorkspaceLive) protocol.WorkspaceLive {
	if old, ok := c.display.live[key]; ok && old.BodyID == v.BodyID {
		// 同一流继续生成时只展示补充之后的增量，旧前缀不会再冒出来。
		if strings.HasPrefix(v.Text, old.Text) {
			v.Text = strings.TrimPrefix(v.Text, old.Text)
		}
		if strings.HasPrefix(v.Thought, old.Thought) {
			v.Thought = strings.TrimPrefix(v.Thought, old.Thought)
		}
		if v.Revision <= old.Revision {
			v.Text, v.Thought = "", ""
		}
	}
	return v
}

func (c *model) recordRound(key string) {
	if c.workRounds == nil {
		c.workRounds = map[string]bool{}
	}
	c.workRounds[key] = true
}
