// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: activityView; activityKey; activityAnimating; syncActivities; activeActivities; activityState; activityRunning; activityRows; activityBrief; activityDetails; animateActivities; activityPreviewLines; planLine; detailCache; sameDetailActivity; detailLines; detailRows; detailHint
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/activity.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"bytes"
	"fmt"
	plantext "github.com/aieyra/aieyra-os/tool/base/official/update_plan/presentation/text"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/x/ansi"
)

type activityView struct {
	activity
	appeared, retired time.Time
	details, shown    string
	readAt            time.Time
}

func activityKey(a activity) string { return a.AgentID + ":" + a.ID }

func (c *model) activityAnimating() bool {
	for _, a := range c.activities {
		if a.retired.IsZero() && (a.shown != a.details || a.readAt.IsZero() || time.Since(a.readAt) < 3*time.Second) {
			return true
		}
		if a.retired.IsZero() && time.Since(a.appeared) < 160*time.Millisecond || !a.retired.IsZero() && time.Since(a.retired) < 220*time.Millisecond {
			return true
		}
	}
	return false
}

func (c *model) syncActivities() {
	var next []activity
	for _, r := range c.snapshot.Roles {
		if !c.taskStarted || r.Generation < c.taskGeneration {
			continue
		}
		for _, a := range r.Activity.Items {
			if !a.Hidden && a.Generation == r.Generation {
				a.AgentID = r.ID
				if c.display.tools[activityKey(a)] {
					continue
				}
				c.recordRound(activityKey(a))
				next = append(next, a)
			}
		}
	}
	sort.SliceStable(next, func(i, j int) bool {
		if next[i].StartedAt != next[j].StartedAt {
			return next[i].StartedAt < next[j].StartedAt
		}
		return next[i].Sequence < next[j].Sequence
	})
	if c.pinned != nil {
		for _, a := range next {
			if a.ID == c.pinned.ID && a.AgentID == c.pinned.AgentID {
				if activityRunning(c.pinned.State) && !activityRunning(a.State) {
					c.receiptRefresh = true
				}
				v := a
				c.pinned = &v
				break
			}
		}
	}
	next = next[max(0, len(next)-3):]
	now := time.Now()
	previous := map[string]activityView{}
	for _, a := range c.activities {
		previous[activityKey(a.activity)] = a
	}
	var visible []activityView
	for _, a := range next {
		v := activityView{activity: a, appeared: now, details: activityDetails(a)}
		if old, ok := previous[activityKey(a)]; ok {
			v.appeared = old.appeared
			v.shown, v.readAt = old.shown, old.readAt
			if v.details != old.details {
				v.readAt = time.Time{}
			}
		}
		visible = append(visible, v)
		delete(previous, activityKey(a))
	}
	// One retiring row is sufficient to soften replacement without growing a log.
	for i := len(c.activities) - 1; i >= 0; i-- {
		a := c.activities[i]
		if _, ok := previous[activityKey(a.activity)]; !ok {
			continue
		}
		if a.retired.IsZero() {
			a.retired = now
		}
		if now.Sub(a.retired) < 220*time.Millisecond {
			visible = append([]activityView{a}, visible...)
			break
		}
	}
	c.activities = visible
}
func (c *model) activeActivities() []activity {
	var items []activity
	for _, a := range c.activities {
		if a.retired.IsZero() && (c.snapshot.Busy || activityRunning(a.State)) {
			items = append(items, a.activity)
		}
	}
	return items
}
func activityState(state string) (string, string) {
	switch state {
	case "queued", "pending":
		return "○", "等待中"
	case "running", "started":
		return "◌", "运行中"
	case "completed", "success", "succeeded":
		return "✓", "完成"
	case "error", "failed":
		return "!", "失败"
	case "cancelled", "canceled":
		return "−", "已停止"
	case "timed_out":
		return "!", "已超时"
	case "interrupted_unknown":
		return "!", "已中断，结果待确认"
	case "in_progress":
		return "◌", "进行中"
	case "skipped":
		return "−", "已跳过"
	}
	return "·", oneLine(state)
}
func activityRunning(state string) bool {
	return state == "running" || state == "started" || state == "queued" || state == "pending" || state == "in_progress"
}
func (c *model) activityRows(room int) []string {
	if room <= 0 {
		return nil
	}
	now := time.Now()
	var visible []activityView
	for _, a := range c.activities {
		if !a.retired.IsZero() && now.Sub(a.retired) >= 220*time.Millisecond {
			continue
		}
		visible = append(visible, a)
	}
	visible = visible[max(0, len(visible)-room):]
	// Reserve every visible brief before assigning detail space, newest first.
	// Tail-cropping the flattened rows used to detach output from its tool.
	details := make([][]string, len(visible))
	remaining := room - len(visible)
	for i := len(visible) - 1; i >= 0 && remaining > 0; i-- {
		a := visible[i]
		if !a.retired.IsZero() || !a.readAt.IsZero() && now.Sub(a.readAt) >= 3*time.Second || a.shown == "" {
			continue
		}
		shown := strings.ReplaceAll(a.shown, "\t", "    ")
		lines := strings.Split(ansi.Hardwrap(shown, max(1, c.width-2), true), "\n")
		n := min(remaining, len(lines))
		details[i] = lines[len(lines)-n:]
		remaining -= n
	}
	var rows []string
	for i, a := range visible {
		line := toolBriefRow(a.activity, c.workPulse())
		if a.State == "failed" || a.State == "error" || a.State == "timed_out" || a.State == "interrupted_unknown" {
			_, state := activityState(a.State)
			_ = state
			line = "\x1b[38;5;203m" + line + "\x1b[0m"
		} else {
			line = neon("51", line)
		}
		if now.Sub(a.appeared) < 160*time.Millisecond || !a.retired.IsZero() {
			line = "\x1b[2m" + line + "\x1b[0m"
		}
		rows = append(rows, cut(line, c.width))
		for j, detail := range details[i] {
			prefix := "  "
			if a.shown != a.details && j == len(details[i])-1 {
				// 仅改变光点亮度，不旋转、跳动或改写真实输出。
				prefix = c.workPulse() + " "
			}
			rows = append(rows, cut(prefix+"\x1b[2m"+detail+"\x1b[0m", c.width))
		}
	}
	return rows
}

func activityBrief(a activity) string {
	title := oneLine(a.Title)
	for _, prefix := range []string{"接下来我", "现在我", "我现在", "让我", "我来", "我"} {
		if strings.HasPrefix(title, prefix) {
			title = strings.TrimSpace(strings.TrimPrefix(title, prefix))
			break
		}
	}
	title = strings.TrimPrefix(title, "开始")
	if strings.HasPrefix(title, "看看") {
		title = "查看" + strings.TrimPrefix(title, "看看")
	}
	if title != "" && title != a.Tool {
		return title
	}
	labels := map[string]string{
		"exec_command": "执行命令", "shell": "执行命令", "write_stdin": "传入命令输入",
		"read_shell_output": "读取命令结果", "apply_patch": "修改文件", "read_file": "读取文件",
		"list_dir": "查看文件夹", "view_image": "查看图片", "web_search": "搜索网页",
		"websearch": "搜索网页", "update_plan": "更新计划",
	}
	if label := labels[a.Tool]; label != "" {
		return label
	}
	if a.Tool != "" {
		return oneLine(a.Tool)
	}
	return "工具调用"
}

func activityDetails(a activity) string {
	var parts []string
	if a.Command != "" {
		parts = append(parts, "输入  $ "+a.Command)
	}
	if a.Input != "" && a.Input != a.Command {
		parts = append(parts, "输入  "+a.Input)
	}
	if a.Detail != "" {
		parts = append(parts, "输出  "+a.Detail)
	}
	if output := previewText(a.Preview); output != "" {
		parts = append(parts, "输出  "+output)
	}
	return boundedText(strings.Join(parts, "\n"))
}

func (c *model) animateActivities(now time.Time, dt time.Duration) {
	for i := range c.activities {
		a := &c.activities[i]
		if !a.retired.IsZero() {
			continue
		}
		// Give the brief its own first frame, then reveal at most three lines.
		// Large snapshots must not jump straight past their input preview.
		if now.Sub(a.appeared) < 160*time.Millisecond {
			continue
		}
		next := advanceText(a.shown, a.details, dt)
		if strings.HasPrefix(next, a.shown) {
			remaining := next[len(a.shown):]
			lines := strings.SplitAfter(remaining, "\n")
			if len(lines) > 3 {
				next = a.shown + strings.Join(lines[:3], "")
			}
		}
		a.shown = next
		if a.shown == a.details && a.readAt.IsZero() {
			a.readAt = now
		}
	}
}

// Keep an input landmark when an output preview scrolls. The full original
// receipt remains available on demand rather than occupying the conversation.
func (c *model) activityPreviewLines(a activityView, room int) []string {
	if room <= 0 || a.shown == "" || !a.readAt.IsZero() && time.Since(a.readAt) >= 3*time.Second {
		return nil
	}
	var lines, sections []string
	section := ""
	for _, source := range strings.Split(strings.ReplaceAll(a.shown, "\t", "    "), "\n") {
		if strings.HasPrefix(source, "输入") {
			section = "输入"
		} else if strings.HasPrefix(source, "输出") {
			section = "输出"
		}
		for _, line := range strings.Split(ansi.Hardwrap(source, max(1, c.width-4), true), "\n") {
			lines = append(lines, line)
			sections = append(sections, section)
		}
	}
	if len(lines) <= room {
		return lines
	}
	var head []string
	if room >= 3 && strings.HasPrefix(lines[0], "输入") {
		head = append(head, lines[0])
	}
	start := len(lines) - (room - len(head))
	tail := lines[start:]
	if !strings.HasPrefix(tail[0], "输出") && !strings.HasPrefix(tail[0], "输入") {
		tail = append([]string(nil), tail...)
		label := sections[start]
		if label != "" {
			tail[0] = label + "  … " + cut(tail[0], max(1, c.width-14))
		}
	}
	return append(head, tail...)
}
func (c *model) planLine() string {
	if !c.visiblePlan() {
		return ""
	}
	return plantext.Summary(c.snapshot.Plan, oneLine)
}

type detailCache struct {
	activity    activity
	hasActivity bool
	receipt     *toolReceipt
	plan        *livePlan
	width       int
	rows        []string
}

func sameDetailActivity(a, b activity) bool {
	return a.ID == b.ID && a.AgentID == b.AgentID && a.Tool == b.Tool && a.State == b.State &&
		a.Command == b.Command && a.Input == b.Input && a.Detail == b.Detail && bytes.Equal(a.Preview, b.Preview)
}

func (c *model) detailLines() []string {
	d := &c.detailCache
	width := max(1, c.width-2)
	if d.rows != nil && d.width == width && d.receipt == c.receipt && d.plan == c.pinnedPlan &&
		d.hasActivity == (c.pinned != nil) && (c.pinned == nil || sameDetailActivity(d.activity, *c.pinned)) {
		return d.rows
	}
	d.width, d.receipt, d.plan, d.hasActivity = width, c.receipt, c.pinnedPlan, c.pinned != nil
	var text strings.Builder
	if a := c.pinned; a != nil {
		d.activity = *a
		d.activity.Preview = bytes.Clone(a.Preview)
		icon, state := activityState(a.State)
		text.WriteString(icon + " " + oneLine(a.Tool) + " · " + state + "\n")
		if c.receipt != nil {
			if c.receipt.Input != "" {
				text.WriteString("输入\n" + safeText(c.receipt.Input) + "\n")
			}
			if c.receipt.Output != "" {
				text.WriteString("输出\n" + safeText(c.receipt.Output) + "\n")
			}
		} else if a.Command != "" {
			text.WriteString("$ " + safeText(a.Command) + "\n")
		}
		if c.receipt == nil && a.Input != "" {
			text.WriteString("输入\n" + safeText(a.Input) + "\n")
		}
		if a.Detail != "" {
			text.WriteString(safeText(a.Detail) + "\n")
		}
		if c.receipt == nil && len(a.Preview) > 0 {
			if output := previewText(a.Preview); output != "" {
				text.WriteString("输出\n" + safeText(output))
			}
		}
	} else if p := c.pinnedPlan; p != nil {
		text.WriteString(plantext.Detail(p, oneLine, safeText, activityState))
	}

	d.rows = strings.Split(ansi.Hardwrap(strings.ReplaceAll(text.String(), "\t", "    "), width, true), "\n")
	return d.rows
}

func (c *model) detailRows(room int) []string {
	if room <= 0 {
		return nil
	}
	lines := c.detailLines()
	content := max(0, room-1)
	c.detailOffset = min(c.detailOffset, max(0, len(lines)-content))
	end := min(len(lines), c.detailOffset+content)
	rows := softEdges(lines[c.detailOffset:end], c.detailOffset > 0, end < len(lines))
	for len(rows) < content {
		rows = append(rows, "")
	}
	return append(rows, "\x1b[2m"+c.detailHint()+"\x1b[0m")
}

func (c *model) detailHint() string {
	hint := "PgUp/PgDn滚动 · Esc关闭"
	if c.pinned != nil {
		hint = "Alt+R刷新 · " + hint
		if c.receiptPending {
			hint = "正在读取原始收据… · Esc关闭"
		} else if c.receiptError != "" {
			hint = "Alt+R重试 · Esc关闭 · " + c.receiptError
		} else if c.receipt != nil {
			hint = fmt.Sprintf("第%d段", c.receiptPage+1)
			if c.receiptPage > 0 {
				hint += " · Alt+←上段"
			}
			if c.receipt.NextInput > 0 || c.receipt.NextOutput > 0 {
				hint += " · Alt+→下段"
			}
			full := hint + " · PgUp/Dn滚动 · Alt+R刷新 · Esc关闭"
			if ansi.StringWidth(full) <= c.width {
				return full
			}
			hint += " · Esc关闭"
			if ansi.StringWidth(hint) > c.width {
				hint = fmt.Sprintf("%d", c.receiptPage+1)
				if c.receiptPage > 0 {
					hint += " Alt+←"
				}
				if c.receipt.NextInput > 0 || c.receipt.NextOutput > 0 {
					hint += " Alt+→"
				}
				hint += " Esc"
			}
		}
	}
	return hint
}
