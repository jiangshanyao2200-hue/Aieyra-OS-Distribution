// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: flowByteLimit; flowEntryLimit; flowToolLimit; flowEntry; flowRow; terminalFlow; flowText; entry; processKey; bodyKey; bytes; trim; flowThought; syncFlowBody; retainFlowBody; retainCurrentFlowBody; beginFlow; captureFlow; processSummary; displayRows; flowRows; inspectEntry; processKeys; flowDetailRows; flowKey; switchFlow
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/flow.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"fmt"
	"sort"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
	"github.com/rivo/uniseg"
)

// A bounded presentation cache, never an execution log or a second archive.
const flowByteLimit = 512 << 10
const flowEntryLimit = 96
const flowToolLimit = 64

type flowEntry struct {
	key, kind, text        string
	thoughts               []presentationBody
	tools                  []activity
	plan                   string
	finished               time.Time
	wrap                   wrapCache
	nativeWidth, committed int
	nativeGap              bool
}
type flowRow struct {
	key         string
	line        int
	text        string
	part, parts int
}
type terminalFlow struct {
	entries                  []flowEntry
	round                    int
	trimmed                  bool
	reading                  bool
	anchor                   flowRow
	top, room                int
	rows                     []flowRow
	inspect                  string
	inspectOffset, toolIndex int
	lastUserKey              string
	jumpTool                 bool
}

func flowText(s string, limit int) string {
	s = boundedText(s)
	if len(s) > limit {
		// boundedText protects terminal control codes; don't split UTF-8.
		g := uniseg.NewGraphemes(s)
		end := 0
		for g.Next() {
			_, right := g.Positions()
			if right > limit {
				break
			}
			end = right
		}
		return s[:end] + "…"
	}
	return s
}
func (f *terminalFlow) entry(key, kind string) *flowEntry {
	for i := range f.entries {
		if f.entries[i].key == key {
			return &f.entries[i]
		}
	}
	f.entries = append(f.entries, flowEntry{key: key, kind: kind})
	return &f.entries[len(f.entries)-1]
}
func (f *terminalFlow) processKey() string       { return fmt.Sprintf("process:%d", f.round) }
func (f *terminalFlow) bodyKey(id string) string { return fmt.Sprintf("body:%d:%s", f.round, id) }
func (f *terminalFlow) bytes() int {
	n := 0
	for _, e := range f.entries {
		n += len(e.key) + len(e.text) + len(e.plan)
		for _, t := range e.thoughts {
			n += len(t.id) + len(t.thought)
		}
		for _, a := range e.tools {
			n += len(a.ID) + len(a.AgentID) + len(a.Tool) + len(a.State) + len(a.Title) + len(a.Input) + len(a.Command) + len(a.Detail) + len(a.Preview)
		}
	}
	return n
}
func (f *terminalFlow) trim() {
	for len(f.entries) > 1 && (len(f.entries) > flowEntryLimit || f.bytes() > flowByteLimit) {
		// Drop cached wrapping and previews too; slicing alone retains their backing array.
		f.entries[0] = flowEntry{}
		f.entries = f.entries[1:]
		f.trimmed = true
	}
}
func (c *model) flowThought(id, text string) {
	if text == "" {
		return
	}
	e := c.flow.entry(c.flow.processKey(), "process")
	for i := range e.thoughts {
		if e.thoughts[i].id == id {
			e.thoughts[i].thought = flowText(text, 2048)
			return
		}
	}
	e.thoughts = append(e.thoughts, presentationBody{id: id, thought: flowText(text, 2048)})
	if len(e.thoughts) > 16 {
		e.thoughts = append([]presentationBody(nil), e.thoughts[len(e.thoughts)-16:]...)
	}
}
func (c *model) syncFlowBody() {
	c.flowThought(c.liveID, c.liveThought)
	if (c.shownText != "" || c.liveText != "") && (c.taskStarted || c.liveID != "") {
		c.flow.entry(c.flow.bodyKey(c.liveID), "body").text = c.shownText
	}
	c.flow.trim()
}
func (c *model) retainFlowBody() {
	// A task switch or new send must not discard a fast final response still
	// waiting for the display animation. This copy cannot delay core cancellation.
	c.retainCurrentFlowBody()
	for _, b := range c.pendingBodies {
		c.flowThought(b.id, b.thought)
		if b.text != "" {
			c.flow.entry(c.flow.bodyKey(b.id), "body").text = b.text
		}
	}
	c.flow.trim()
}
func (c *model) retainCurrentFlowBody() {
	c.flowThought(c.liveID, c.liveThought)
	if c.liveText != "" && (c.taskStarted || c.liveID != "") {
		c.flow.entry(c.flow.bodyKey(c.liveID), "body").text = c.liveText
	} else if (c.shownText != "" || c.liveText != "") && (c.taskStarted || c.liveID != "") {
		c.flow.entry(c.flow.bodyKey(c.liveID), "body").text = c.shownText
	}
	c.flow.trim()
}
func (c *model) beginFlow(text, request string) {
	c.retainFlowBody()
	if request != "" {
		for _, e := range c.flow.entries {
			if e.key == "user:"+request {
				return
			} // lost ACK retry, same message
		}
	}
	if c.screen != nil {
		c.screen.flushHistory()
	}
	if e := c.flow.entry(c.flow.processKey(), "process"); e.finished.IsZero() {
		e.finished = time.Now()
	}
	c.flow.round++
	if request == "" {
		request = fmt.Sprint(c.flow.round)
	}
	c.flow.entry("user:"+request, "user").text = boundedText(text)
	c.flow.lastUserKey = "user:" + request
	c.flow.reading = false
	c.flow.inspect = ""
	c.flow.trim()
}
func (c *model) captureFlow() {
	var tools []activity
	for _, r := range c.snapshot.Roles {
		if r.Generation < c.taskGeneration {
			continue
		}
		for _, a := range r.Activity.Items {
			a.AgentID = r.ID
			if a.Hidden || a.Generation != r.Generation || c.display.tools[activityKey(a)] {
				continue
			}
			tools = append(tools, a)
		}
	}
	sort.SliceStable(tools, func(i, j int) bool {
		if tools[i].StartedAt != tools[j].StartedAt {
			return tools[i].StartedAt < tools[j].StartedAt
		}
		return tools[i].Sequence < tools[j].Sequence
	})
	if len(tools) > 0 || c.snapshot.Plan != nil && c.planSignature() != c.display.plan {
		c.syncFlowBody()
		e := c.flow.entry(c.flow.processKey(), "process")
		for _, a := range tools {
			// Each tool owns its place in the ordinary flow; receipts remain in CORE.
			te := c.flow.entry(fmt.Sprintf("tool:%d:%s", c.flow.round, activityKey(a)), "tool")
			e = c.flow.entry(c.flow.processKey(), "process")
			a.Input, a.Command, a.Detail = flowText(a.Input, 2048), flowText(a.Command, 2048), flowText(a.Detail, 2048)
			a.Preview = nil
			te.tools = []activity{a}
			index := -1
			for i := range e.tools {
				if activityKey(e.tools[i]) == activityKey(a) {
					index = i
					break
				}
			}
			if index >= 0 {
				e.tools[index] = a
			} else {
				e.tools = append(e.tools, a)
			}
		}
		if len(e.tools) > flowToolLimit {
			e.tools = append([]activity(nil), e.tools[len(e.tools)-flowToolLimit:]...)
		}
		if p := c.snapshot.Plan; p != nil && c.snapshot.PlanScope.Generation >= c.taskGeneration && c.planSignature() != c.display.plan {
			var b strings.Builder
			b.WriteString(p.Objective)
			for _, ph := range p.Phases {
				for _, s := range ph.Steps {
					icon, state := activityState(s.Status)
					b.WriteString("\n" + icon + " " + s.Text + " · " + state)
				}
			}
			e.plan = flowText(b.String(), 8192)
		}
	}
	for i := range c.flow.entries {
		e := &c.flow.entries[i]
		if e.key == c.flow.processKey() {
			if c.snapshot.Busy {
				e.finished = time.Time{}
			} else if e.finished.IsZero() {
				e.finished = time.Now()
			}
		}
	}
	c.flow.trim()
}
func processSummary(e *flowEntry) string {
	failed, waiting, done, stopped, skipped := 0, 0, 0, 0, 0
	for _, a := range e.tools {
		switch a.State {
		case "failed", "error", "timed_out", "interrupted_unknown":
			failed++
		case "cancelled", "canceled":
			stopped++
		case "skipped":
			skipped++
		case "completed", "success", "succeeded":
			done++
		default:
			waiting++
		}
	}
	parts := []string{}
	if len(e.thoughts) > 0 {
		parts = append(parts, "已思考")
	}
	if done > 0 {
		parts = append(parts, fmt.Sprintf("%d 项已处理", done))
	}
	if waiting > 0 {
		parts = append(parts, fmt.Sprintf("%d 项结果待确认", waiting))
	}
	if failed > 0 {
		parts = append(parts, fmt.Sprintf("%d 项失败或中断", failed))
	}
	if stopped > 0 {
		parts = append(parts, fmt.Sprintf("%d 项已停止", stopped))
	}
	if skipped > 0 {
		parts = append(parts, fmt.Sprintf("%d 项已跳过", skipped))
	}
	if e.plan != "" {
		parts = append(parts, "有计划")
	}
	if len(parts) == 0 {
		return ""
	}
	color := "141"
	if failed > 0 || waiting > 0 {
		color = "203"
	}
	return "\x1b[38;5;" + color + "m  › 过程 · " + strings.Join(parts, " · ") + " · Alt+H\x1b[0m"
}

func (e *flowEntry) displayRows(width int) []string {
	if e.nativeWidth > 0 {
		width = e.nativeWidth
	}
	if e.wrap.text == e.text && e.wrap.width == width {
		return e.wrap.rows
	}
	var rows []string
	if e.kind == "body" {
		rows = e.wrap.markdown(e.text, width)
	} else {
		rows = e.wrap.wrap(e.text, width)
	}
	// This entry owns its wrap cache. Style only when its text or width changes;
	// replaying every historical line each animation frame wastes allocations.
	for i, line := range rows {
		prefix := "  "
		if i == 0 {
			if e.kind == "user" {
				prefix = neon("201", "●") + " "
			} else {
				prefix = neon("51", "○") + " "
			}
		}
		if e.kind == "user" {
			line = "\x1b[1m" + line + "\x1b[0m"
		}
		rows[i] = prefix + line
	}
	return rows
}

func (c *model) flowRows(room int) []string {
	c.syncFlowBody()
	f := &c.flow
	// Reuse the row index, releasing any references to evicted entries first.
	clear(f.rows)
	all := f.rows[:0]
	add := func(key string, lines []string) {
		for i, text := range lines {
			all = append(all, flowRow{key: key, line: i, text: text})
		}
	}
	if f.trimmed {
		add("trimmed", []string{"\x1b[2m较早记录已退出显示缓存，原记录仍由 CORE 保存\x1b[0m"})
	}
	currentKey := f.bodyKey(c.liveID)
	active := c.snapshot.Busy || !c.thoughtReady() || len(c.pendingBodies) > 0 || c.shownText != c.liveText
	// A new thought temporarily occupies the current body slot; the first body
	// frame replaces it. Historical thoughts remain accessible via Alt+H.
	thought := c.shownThought != "" && (c.shownText == "" || !c.thoughtReady()) && active
	thoughtAdded := false
	lastKind := ""
	addEntry := func(e *flowEntry, lines []string) {
		if len(lines) == 0 {
			return
		}
		if len(all) > 0 && (e.kind != "tool" || lastKind != "tool") {
			all = append(all, flowRow{key: e.key, line: -1, text: "", parts: 1})
		}
		for i, text := range lines {
			parts := strings.Split(ansi.Hardwrap(text, max(1, c.width), true), "\n")
			for part, line := range parts {
				all = append(all, flowRow{key: e.key, line: i, text: line, part: part, parts: len(parts)})
			}
		}
		lastKind = e.kind
	}
	addThought := func() {
		if !thought || thoughtAdded {
			return
		}
		if len(all) > 0 {
			add("thought-gap", []string{""})
		}
		add("live-thought", []string{neon("201", "○") + " " + neon("141", c.thoughtLine.render(c.shownThought, max(0, c.width-2)))})
		thoughtAdded = true
		lastKind = "body"
	}
	for i := range f.entries {
		e := &f.entries[i]
		if e.kind == "process" {
			continue
		}
		if e.key == currentKey && thought {
			addThought()
			continue
		}
		if e.kind == "tool" {
			if len(e.tools) == 0 {
				continue
			}
			lines := []string{toolBriefRow(e.tools[0], c.workPulse())}
			for _, a := range c.activities {
				if activityKey(a.activity) != activityKey(e.tools[0]) || !a.retired.IsZero() {
					continue
				}
				if a.shown != "" {
					for _, line := range c.activityPreviewLines(a, max(1, min(8, room-3))) {
						lines = append(lines, "  "+neon("87", "│")+" "+neon("141", line))
					}
				}
			}
			addEntry(e, lines)
			continue
		}
		addEntry(e, e.displayRows(max(1, c.width-2)))
	}
	addThought()
	if !c.taskStarted && c.liveID == "" && c.shownText != "" {
		add("greeting", c.bodyWrap.markdown(c.shownText, c.width-2))
	}
	if h := c.pendingHuman(); h != nil {
		text := h.Question + "\n" + h.Facts + "\n" + h.Recommendation + "\n" + h.Impact
		for _, o := range h.Options {
			text += "\n" + o.ID + " · " + o.Label + " " + o.Impact
		}
		add("human:"+h.ID, c.thoughtWrap.wrap(safeText(text), c.width-2))
	}
	// Direct projection tests and snapshots without captured tools keep their live view.
	if len(c.activities) > 0 {
		captured := false
		for _, e := range f.entries {
			if e.kind == "tool" {
				captured = true
				break
			}
		}
		if !captured {
			add("live-tools", c.activityRows(min(9, max(0, room-1))))
		}
	}
	if plan := c.planLine(); plan != "" {
		add("live-plan", []string{"\x1b[2m" + plan + "\x1b[0m"})
	}
	if len(all) == 0 {
		add("welcome", []string{neon("51", "◈ AIEYRA") + neon("201", " // CLI ") + neon("141", oneLine(c.opts.Version)), "", neon("87", "直接输入开始") + neon("141", " · /api 连接模型")})
	}
	f.rows, f.room = all, room
	start := max(0, len(all)-room)
	if f.reading {
		start = min(f.top, max(0, len(all)-room))
		for i, row := range all {
			if row.key == f.anchor.key && row.line >= f.anchor.line {
				start = min(i, max(0, len(all)-room))
				break
			}
		}
	}
	f.top = start
	if len(all) > start {
		f.anchor = all[start]
	}
	end := min(len(all), start+room)
	rows := make([]string, 0, room)
	c.thoughtLine.visible = false
	for _, r := range all[start:end] {
		rows = append(rows, r.text)
		if r.key == "live-thought" {
			c.thoughtLine.visible = true
		}
		if r.key == currentKey {
			c.bodyVisible = c.shownText != ""
		}
		if r.key == f.lastUserKey && c.userText != "" {
			c.userVisible = true
		}
	}
	// When following a long body, an appended thought must still get its reading
	// window. Hidden history/menu views keep their own visible-time semantics.
	if !f.reading && thought && !c.thoughtReady() && !c.thoughtLine.visible && len(rows) > 1 {
		for _, r := range all {
			if r.key == "live-thought" {
				rows[0] = r.text
				c.thoughtLine.visible = true
				break
			}
		}
	}
	return softEdges(rows, start > 0, end < len(all))
}
func (c *model) inspectEntry() *flowEntry {
	for i := range c.flow.entries {
		if c.flow.entries[i].key == c.flow.inspect {
			return &c.flow.entries[i]
		}
	}
	return nil
}
func (c *model) processKeys() []string {
	var keys []string
	for i := range c.flow.entries {
		e := &c.flow.entries[i]
		if e.kind == "process" && processSummary(e) != "" {
			keys = append(keys, e.key)
		}
	}
	return keys
}
func (c *model) flowDetailRows(room int) []string {
	e := c.inspectEntry()
	if e == nil {
		c.flow.inspect = ""
		return c.flowRows(room)
	}
	var b strings.Builder
	for _, t := range e.thoughts {
		b.WriteString("思考\n" + t.thought + "\n\n")
	}
	if e.plan != "" {
		b.WriteString("计划\n" + e.plan + "\n\n")
	}
	selectedOffset := 0
	for i, a := range e.tools {
		icon, state := activityState(a.State)
		prefix := "  "
		if i == c.flow.toolIndex {
			prefix = "› "
			selectedOffset = len(c.thoughtWrap.wrap(b.String(), c.width-2))
		}
		b.WriteString(fmt.Sprintf("%s%s %s · %s\n%s\n\n", prefix, icon, activityBrief(a), state, activityDetails(a)))
	}
	lines := c.thoughtWrap.wrap(b.String(), c.width-2)
	if c.flow.jumpTool {
		c.flow.inspectOffset = selectedOffset
		c.flow.jumpTool = false
	}
	c.flow.inspectOffset = min(c.flow.inspectOffset, max(0, len(lines)-max(0, room-1)))
	start := c.flow.inspectOffset
	end := min(len(lines), start+max(0, room-1))
	rows := []string{cut("过程 · Alt+←/→ 切换 · Alt+↑/↓ 工具 · Alt+R 原记录 · Esc 返回", c.width)}
	return append(rows, softEdges(lines[start:end], start > 0, end < len(lines))...)
}
func (c *model) flowKey(k tea.KeyMsg) (bool, tea.Cmd) {
	f := &c.flow
	if k.String() == "alt+h" {
		c.resetReceipt()
		c.pinned = nil
		c.planExpanded = false
		c.pinnedPlan = nil
		if f.inspect != "" {
			f.inspect = ""
		} else if keys := c.processKeys(); len(keys) > 0 {
			f.inspect = keys[len(keys)-1]
			f.inspectOffset, f.toolIndex = 0, 0
		} else {
			c.notice = "还没有需要展开的过程"
		}
		return true, nil
	}
	if c.pinned != nil || c.planExpanded {
		return false, nil
	}
	if f.inspect != "" {
		switch k.String() {
		case "esc":
			f.inspect = ""
			return true, nil
		case "pgup":
			f.inspectOffset = max(0, f.inspectOffset-max(1, c.height/2))
			return true, nil
		case "pgdown":
			f.inspectOffset += max(1, c.height/2)
			return true, nil
		case "alt+left", "alt+right":
			keys := c.processKeys()
			for i, key := range keys {
				if key == f.inspect {
					if k.String() == "alt+left" {
						i = max(0, i-1)
					} else {
						i = min(len(keys)-1, i+1)
					}
					f.inspect = keys[i]
					f.inspectOffset, f.toolIndex = 0, 0
					break
				}
			}
			return true, nil
		case "alt+up", "alt+down":
			if e := c.inspectEntry(); e != nil {
				if k.String() == "alt+up" {
					f.toolIndex = max(0, f.toolIndex-1)
				} else {
					f.toolIndex = min(max(0, len(e.tools)-1), f.toolIndex+1)
				}
			}
			f.jumpTool = true
			return true, nil
		case "alt+r":
			if e := c.inspectEntry(); e != nil && f.toolIndex < len(e.tools) {
				a := e.tools[f.toolIndex]
				c.pinned = &a
				c.detailOffset = 0
				return true, c.loadReceipt()
			}
			return true, nil
		}
	}
	if len(c.menuItems()) > 0 {
		return false, nil
	}
	switch k.String() {
	case "ctrl+end":
		f.reading = false
		return true, nil
	case "pgup", "pgdown":
		if len(f.rows) == 0 {
			return true, nil
		}
		step := max(1, f.room-2)
		if k.String() == "pgup" {
			f.top = max(0, f.top-step)
			f.reading = true
		} else {
			f.top = min(max(0, len(f.rows)-f.room), f.top+step)
			f.reading = f.top < max(0, len(f.rows)-f.room)
		}
		f.anchor = f.rows[min(f.top, len(f.rows)-1)]
		return true, nil
	}
	return false, nil
}

func (c *model) switchFlow(id string) {
	if id == c.session.ID {
		return
	}
	c.retainFlowBody()
	if c.screen != nil {
		c.screen.flushHistory()
	}
	if c.flows == nil {
		c.flows = map[string]terminalFlow{}
	}
	// The active task plus three parked tasks share the 2 MiB text budget.
	// Remove a restored task from the parked cache so its backing arrays aren't
	// retained there while the active flow changes.
	next := c.flows[id]
	delete(c.flows, id)
	for i, task := range c.flowTasks {
		if task == id {
			c.flowTasks = append(c.flowTasks[:i], c.flowTasks[i+1:]...)
			break
		}
	}
	c.flow.rows = nil
	c.flow.inspect = ""
	c.flows[c.session.ID] = c.flow
	c.flowTasks = append(c.flowTasks, c.session.ID)
	for len(c.flowTasks) > 3 {
		delete(c.flows, c.flowTasks[0])
		c.flowTasks = c.flowTasks[1:]
	}
	c.flow = next
}
