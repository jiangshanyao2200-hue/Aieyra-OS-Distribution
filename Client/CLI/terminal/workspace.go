// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: message; usage; human; role; activity; livePlan; taskView; snapshot; pollMsg; toolInputPreview; previewInput; actionMsg; poll; applySnapshot; pendingHuman; rebuild; action; reply; cancelTask; cancelPendingNotice; open; completeAction
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/workspace.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"context"
	"encoding/json"
	plancontract "github.com/aieyra/aieyra-os/tool/base/official/update_plan/contract"
	"sort"
	"strings"
	"time"

	"github.com/aieyra/aieyra-os/contracts/protocol"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/rivo/uniseg"
)

// These are read projections of the existing workspace JSON protocol. They have
// no transition methods: the core remains authoritative for task/human state.
type message struct {
	ID, From, State, Text, Error string
	Generation                   int
	DocumentID                   string `json:"document_id"`
}
type usage struct {
	Input                        int  `json:"input_tokens"`
	Output                       int  `json:"output_tokens"`
	Cached                       int  `json:"cached_tokens"`
	CacheInput                   int  `json:"cache_input_tokens"`
	CacheKnown                   bool `json:"cached_known"`
	Reported, Estimated, Samples int
	Complete                     bool
}
type human struct {
	ID, State, Question, Recommendation, Facts, Impact string
	Version, Generation                                int
	SessionID                                          string `json:"session_id"`
	AgentID                                            string `json:"agent_id"`
	Token                                              string `json:"request_token_sha256"`
	Options                                            []struct{ ID, Label, Impact string }
}
type role struct {
	Role, ID, State, Error string
	Generation             int
	Usage                  usage
	Context                *struct {
		Tokens, Window int
		ModelWindow    int `json:"model_window"`
	}
	Humans   []human `json:"human_requests"`
	Activity struct {
		Items []activity
	}
}
type activity struct {
	ID, Tool, State, Title, Detail, Command, Input string
	AgentID                                        string `json:"-"`
	Generation                                     int
	Sequence, Revision                             int64
	StartedAt                                      int64 `json:"started_at"`
	Preview                                        json.RawMessage
	Hidden                                         bool
}
type livePlan = plancontract.PlanState
type taskView struct {
	ID, Title, State string
	Primary          bool
	Generation       int
}

type snapshot struct {
	Tasks     []taskView
	Greeting  struct{ State, Text, Error, Detail, Phase string }
	SessionID string `json:"session_id"`
	Model     string `json:"model_name"`
	Workdir   string
	Total     int `json:"message_total"`
	Messages  []message
	Roles     []role
	Live      map[string]protocol.WorkspaceLive
	Busy      bool
	Plan      *livePlan
	PlanScope struct{ Generation int } `json:"plan_scope"`
	Requests  []struct {
		ID         string `json:"request_id"`
		State      string
		Generation int
	}
}
type pollMsg struct {
	epoch   int
	version int
	data    snapshot
	docs    map[string]string
	inputs  map[string]toolInputPreview
	err     error
}

type toolInputPreview struct {
	text    string
	running bool
}

func previewInput(text string) string {
	var values map[string]json.RawMessage
	if json.Unmarshal([]byte(text), &values) == nil {
		// The human description already owns the brief. Keep it out of the
		// operational input preview; the original receipt retains every field.
		delete(values, "description")
		for _, key := range []string{"patch", "cmd", "chars"} {
			var value string
			if json.Unmarshal(values[key], &value) == nil && value != "" {
				delete(values, key)
				text = key + "\n" + value
				if len(values) > 0 {
					rest, _ := json.MarshalIndent(values, "", "  ")
					text += "\n" + string(rest)
				}
				break
			}
		}
		if rest, err := json.MarshalIndent(values, "", "  "); err == nil && !strings.HasPrefix(text, "patch\n") && !strings.HasPrefix(text, "cmd\n") && !strings.HasPrefix(text, "chars\n") {
			text = string(rest)
		}
	}
	text = safeText(text)
	const limit = 2048
	if len(text) <= limit {
		return text
	}
	g, end := uniseg.NewGraphemes(text), 0
	for g.Next() {
		_, right := g.Positions()
		if right > limit {
			break
		}
		end = right
	}
	return text[:end] + "…"
}

type actionMsg struct {
	epoch       int
	inputEpoch  int
	kind, draft string
	data        protocol.TerminalSession
	err         error
}

func (c *model) poll(delay time.Duration) tea.Cmd {
	if c.session.Call == nil {
		return nil
	}
	session, epoch, version, ctx := c.session, c.epoch, c.actionVersion, c.ctx
	known := make(map[string]string, len(c.documents))
	for k, v := range c.documents {
		known[k] = v
	}
	inputs := make(map[string]toolInputPreview, len(c.inputPreviews))
	for k, v := range c.inputPreviews {
		inputs[k] = v
	}
	return func() tea.Msg {
		if delay > 0 {
			select {
			case <-time.After(delay):
			case <-ctx.Done():
				return pollMsg{epoch: epoch, version: version, err: ctx.Err()}
			}
		}
		callCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		result := pollMsg{epoch: epoch, version: version, docs: map[string]string{}}
		result.err = session.Call(callCtx, "workspace.snapshot", nil, &result.data)
		if result.err != nil {
			return result
		}
		var state struct {
			Busy     bool
			Requests []struct {
				ID         string `json:"request_id"`
				State      string
				Generation int
			}
		}
		result.err = session.Call(callCtx, "matrix.status", nil, &state)
		if result.err != nil {
			return result
		}
		result.data.Busy, result.data.Requests = state.Busy, state.Requests
		// Snapshot previews omit inputs for some tools (notably apply_patch).
		// Read only the first receipt page for the latest three missing inputs,
		// once while running and once on completion. Animations and idle polls
		// reuse the bounded preview; full receipt pagination stays user-driven.
		result.inputs = make(map[string]toolInputPreview)
		var missing []activity
		for _, r := range result.data.Roles {
			for _, a := range r.Activity.Items {
				if !a.Hidden && a.Generation == r.Generation && a.Input == "" && a.Command == "" {
					a.AgentID = r.ID
					missing = append(missing, a)
				}
			}
		}
		sort.SliceStable(missing, func(i, j int) bool {
			if missing[i].StartedAt != missing[j].StartedAt {
				return missing[i].StartedAt < missing[j].StartedAt
			}
			return missing[i].Sequence < missing[j].Sequence
		})
		for _, a := range missing[max(0, len(missing)-3):] {
			key, running := activityKey(a), activityRunning(a.State)
			old, ok := inputs[key]
			if !ok || old.running != running {
				readCtx, stop := context.WithTimeout(callCtx, 750*time.Millisecond)
				var receipt toolReceipt
				err := session.Call(readCtx, "workspace.receipt", map[string]any{"agent_id": a.AgentID, "id": a.ID, "input_offset": 0, "output_offset": 0}, &receipt)
				stop()
				old.running = running
				if err == nil && receipt.Input != "" {
					old.text = previewInput(receipt.Input)
				}
			}
			result.inputs[key] = old
		}
		// 当前正文最多读取一份；旧消息与旧文档不进入呈现缓存。
		for i := len(result.data.Messages) - 1; i >= 0; i-- {
			m := result.data.Messages[i]
			if m.From != "matrix" {
				continue
			}
			if m.DocumentID == "" {
				break
			}
			if _, ok := known[m.DocumentID]; ok {
				result.docs[m.DocumentID] = known[m.DocumentID]
				break
			}
			var doc struct{ Content string }
			if result.err = session.Call(callCtx, "workspace.document", map[string]string{"id": m.DocumentID}, &doc); result.err != nil {
				return result
			}
			result.docs[m.DocumentID] = doc.Content
			break
		}
		return result
	}
}
func (c *model) applySnapshot(v pollMsg) {
	c.snapshot = v.data
	if !c.snapshot.Busy {
		if c.notice == cancelPendingNotice {
			c.notice = ""
		}
		c.clearCompletedTools()
	}
	if c.planExpanded && (!c.visiblePlan() || c.pinnedPlanGeneration != c.snapshot.PlanScope.Generation) {
		c.planExpanded, c.pinnedPlan = false, nil
	}
	if c.planExpanded && c.pinnedPlanGeneration == c.snapshot.PlanScope.Generation && c.visiblePlan() {
		c.pinnedPlan = c.snapshot.Plan
	}
	c.documents = v.docs
	if c.documents == nil {
		c.documents = map[string]string{}
	}
	c.messages = nil
	generation := 0
	for _, r := range v.data.Roles {
		if r.Role == "matrix" || r.ID == "matrix" {
			generation = max(generation, r.Generation)
		}
	}
	for _, r := range v.data.Requests {
		generation = max(generation, r.Generation)
	}
	if c.snapshot.Busy || generation > 0 {
		c.taskStarted = true
	}
	if !c.taskStarted {
		c.liveText, c.shownText = safeText(c.snapshot.Greeting.Text), safeText(c.snapshot.Greeting.Text)
		if c.snapshot.Greeting.State == "offline" {
			c.notice = safeText(c.snapshot.Greeting.Error) + " · /api"
		}
		return
	}
	if generation < c.taskGeneration {
		// An idle core may retire all role/request records. Its empty snapshot
		// still closes the current presentation instead of leaving thought
		// activity visible forever. Older nonempty generations remain ignored.
		if generation == 0 && !c.snapshot.Busy && len(c.snapshot.Roles) == 0 && len(c.snapshot.Requests) == 0 {
			c.captureFlow()
		}
		return
	}
	if generation > c.taskGeneration {
		c.retainFlowBody()
		c.clearLive()
		c.taskGeneration = generation
	}
	c.inputPreviews = v.inputs
	for i := range c.snapshot.Roles {
		r := &c.snapshot.Roles[i]
		for j := range r.Activity.Items {
			a := &r.Activity.Items[j]
			if a.Input == "" && a.Command == "" {
				a.Input = v.inputs[r.ID+":"+a.ID].text
			}
		}
	}
	var newest protocol.WorkspaceLive
	keys := make([]string, 0, len(c.snapshot.Live))
	for k := range c.snapshot.Live {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		v := c.visibleLive(k, c.snapshot.Live[k])
		if v.BodyAt > newest.BodyAt || v.BodyAt == newest.BodyAt && v.Revision >= newest.Revision {
			newest = v
		}
	}
	text, thought, id := newest.Text, newest.Thought, newest.BodyID
	// 请求准备阶段保留的正文和旧思考不属于新流；只接收新推理。
	if newest.NewBody {
		text = ""
		if !newest.ReasoningSeen {
			thought = ""
		}
		if normalizeThought(thought) == "" {
			id = ""
		}
	}
	if !c.snapshot.Busy || text == "" && !newest.NewBody {
		for i := len(v.data.Messages) - 1; i >= 0; i-- {
			m := v.data.Messages[i]
			if m.From != "matrix" || m.Generation < c.taskGeneration || c.display.messages[m.ID] {
				continue
			}
			text = m.Text
			if doc, ok := c.documents[m.DocumentID]; ok {
				text = doc
			}
			text = c.visibleMessage(m.ID, text)
			if m.Error != "" {
				text += "\n" + m.Error
			}
			id = m.ID
			// 完成文档是同一流的最终正文，不为它重播已经显示的思考。
			if !newest.NewBody && newest.BodyID != "" && newest.Text != "" && strings.HasPrefix(text, newest.Text) {
				id = newest.BodyID
			}
			c.messages = []message{m}
			break
		}
	}
	c.receivePresentation(presentationBody{id: id, text: safeText(text), thought: boundedText(thought)})
	if c.snapshot.Busy && id != "" && (text != "" || thought != "") {
		c.recordRound("body:" + id)
	}
	c.syncActivities()
	c.captureFlow()
}
func (c *model) pendingHuman() *human {
	for _, r := range c.snapshot.Roles {
		if r.Generation < c.taskGeneration {
			continue
		}
		for _, h := range r.Humans {
			if r.State == "waiting_user" && h.State == "waiting_user" && h.Generation == r.Generation && h.AgentID == r.ID {
				copy := h
				return &copy
			}
		}
	}
	return nil
}
func (c *model) rebuild() {
	if c.screen == nil {
		return
	}
	c.screen.reset = true
	c.screen.pending = true
}
func (c *model) action(kind, name string, args any, draft string) tea.Cmd {
	if values, ok := args.(map[string]any); ok && (name == "matrix.send" || name == "matrix.cancel") {
		if _, bound := values["generation"]; !bound {
			values["generation"] = c.taskGeneration
		}
	}
	c.opPending = true
	c.actionVersion++
	session, epoch, inputEpoch, ctx := c.session, c.epoch, c.inputEpoch, c.ctx
	return func() tea.Msg {
		callCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()
		return actionMsg{epoch: epoch, inputEpoch: inputEpoch, kind: kind, draft: draft, err: session.Call(callCtx, name, args, nil)}
	}
}
func (c *model) reply(h human, text string) tea.Cmd {
	decision := map[string]string{"text": text}
	for _, o := range h.Options {
		if text == o.ID {
			decision = map[string]string{"option_id": text}
		}
	}
	return c.action("reply", "humans.reply", map[string]any{
		"request_id": requestID(), "session_id": h.SessionID, "agent_id": h.AgentID, "generation": h.Generation,
		"human_id": h.ID, "expected_request_version": h.Version, "request_token_sha256": h.Token, "decision": decision,
	}, c.input.Value())
}
func (c *model) cancelTask() tea.Cmd {
	if c.opPending {
		c.notice = "正在处理请求，请稍候再停止"
		return nil
	}
	for i := len(c.snapshot.Requests) - 1; i >= 0; i-- {
		r := c.snapshot.Requests[i]
		if r.State == "running" {
			return c.action("cancel", "matrix.cancel", map[string]any{"request_id": r.ID, "generation": r.Generation}, "")
		}
	}
	c.notice = "当前没有运行中的任务"
	return nil
}

const cancelPendingNotice = "停止请求已发送，等待核心确认"

func (c *model) open(id string) tea.Cmd {
	if c.opPending || c.opts.Open == nil || c.sending != nil || len(c.queuedSends) > 0 {
		c.notice = "等待发送确认后即可切换任务"
		return nil
	}
	c.opPending = true
	c.opening = true
	c.settlePaste()
	value := c.input.Value()
	open, ctx, epoch := c.opts.Open, c.ctx, c.epoch
	return func() tea.Msg {
		callCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		data, err := open(callCtx, id)
		return actionMsg{epoch: epoch, kind: "open", data: data, draft: value, err: err}
	}
}
func (c *model) completeAction(v actionMsg) tea.Cmd {
	if v.epoch != c.epoch {
		return nil
	}
	c.opPending = false
	c.actionVersion++
	var openingKeys []tea.KeyMsg
	if v.kind == "open" && v.err != nil {
		c.opening = false
		c.awaitingTaskSnapshot = false
		openingKeys, c.openingKeys = c.openingKeys, nil
	}
	if v.err != nil {
		if v.kind == "send" && c.sending != nil {
			p := *c.sending
			c.sending = nil
			c.failedSend = &p
			c.retryID, c.retryText = p.id, p.text
			if c.input.Value() == "" && len(c.queuedSends) == 0 {
				c.restoreDraft(p.draft)
			}
		}
		c.notice = safeText(v.err.Error())
		if v.kind == "send" {
			c.notice = "发送未确认，消息已保留；Enter 重试 · " + c.notice
		}
		if v.kind == "open" {
			// Keep text typed during a failed switch visible for recovery, but
			// never execute queued commands or cancellation on the old task.
			for _, k := range openingKeys {
				if k.Type == tea.KeyRunes && !k.Alt {
					c.handlePaste(string(k.Runes))
				} else if k.Type == tea.KeyCtrlJ {
					c.handlePaste("\n")
				}
			}
			c.menuClosed = true
			c.notice = "切换任务失败，输入已保留且未发送 · " + safeText(v.err.Error())
		}
		return nil
	}
	c.notice = ""
	switch v.kind {
	case "open":
		c.settlePaste()
		d := c.savedDraft()
		if c.failedByTask == nil {
			c.failedByTask = map[string]*pendingSend{}
		}
		c.failedByTask[c.session.ID] = c.failedSend
		c.drafts[c.session.ID] = d
		c.epoch++
		c.switchFlow(v.data.ID)
		c.session = v.data
		c.snapshot = snapshot{}
		c.clearLive()
		c.taskStarted = false
		c.taskGeneration = 0
		c.display = displayBoundary{}
		c.userText = ""
		c.messages = nil
		c.documents = map[string]string{}
		c.questionKey = ""
		c.retryID, c.retryText = "", ""
		c.failedSend, c.sending, c.queuedSends = c.failedByTask[v.data.ID], nil, nil
		if c.failedSend != nil {
			c.retryID, c.retryText = c.failedSend.id, c.failedSend.text
		}
		c.menuClosed = false
		c.restoreDraft(c.drafts[v.data.ID])
		if c.screen != nil {
			c.screen.reset = true
		}
		// The first snapshot supplies the actual generation and any pending
		// human decision. Only then may buffered input act on the new task.
		c.awaitingTaskSnapshot = true
		return c.poll(0)
	case "send", "reply":
		c.settlePaste()
		if v.kind == "reply" && c.inputEpoch == v.inputEpoch && c.input.Value() == v.draft {
			c.inputEpoch++
			c.input.Reset()
			c.pastes = nil
			c.clearPasteState()
			c.growInput()
		}
		c.menuClosed = false
		if v.kind == "send" {
			c.taskStarted = true
			c.snapshot.Busy = true
			c.retryID, c.retryText = "", ""
			c.sending = nil
			if len(c.queuedSends) > 0 {
				p := c.queuedSends[0]
				c.queuedSends = c.queuedSends[1:]
				c.sending = &p
				return c.action("send", "matrix.send", map[string]any{"request_id": p.id, "message": p.text}, p.draft.value)
			}
		}
	case "cancel":
		c.notice = cancelPendingNotice

	}
	return nil
}
