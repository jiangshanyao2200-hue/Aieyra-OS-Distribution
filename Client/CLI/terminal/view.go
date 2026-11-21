// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: cut; statusLine; workPulse; compactNumber; metricsLine; inputRows; caretCell; View; softEdges
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/view.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/x/ansi"
)

func cut(s string, w int) string { return ansi.Truncate(s, max(0, w), "…") }
func (c *model) statusLine() string {
	state := "就绪"
	circle := "○"
	if c.session.Call == nil {
		state = "核心未连接 · /api 打开 Eyra API"
	}
	if c.snapshot.Busy {
		state = "工作中"
	}
	if c.pendingHuman() != nil {
		state = "等待答复"
	}
	if c.opPending {
		state = "处理中"
	}
	if c.snapshot.Busy || c.opPending || c.api != nil && c.api.pending {
		circle = c.workPulse()
	}
	if c.notice != "" {
		state = oneLine(c.notice)
	}
	return neon("51", circle) + " " + neon("141", state)
}

func (c *model) workPulse() string {
	colors := [...]string{"51", "87", "123", "201", "165", "141", "87", "51"}
	return neon(colors[(c.frame/3)%len(colors)], "◈")
}
func compactNumber(n int) string {
	if n >= 1000000 {
		return fmt.Sprintf("%.1fM", float64(n)/1000000)
	}
	if n >= 10000 {
		return fmt.Sprintf("%.1fk", float64(n)/1000)
	}
	return fmt.Sprint(n)
}
func (c *model) metricsLine() string {
	input, output, cache, context := "—", "—", "—", "—"
	partial := false
	for _, r := range c.snapshot.Roles {
		if r.Role != "matrix" && r.ID != "matrix" {
			continue
		}
		u := r.Usage
		if u.Reported+u.Estimated > 0 {
			input = compactNumber(u.Input)
			output = compactNumber(u.Output)
			partial = !u.Complete || u.Estimated > 0
		}
		if u.CacheKnown && u.CacheInput > 0 {
			cache = fmt.Sprintf("%.0f%%", 100*float64(u.Cached)/float64(u.CacheInput))
		}
		if r.Context != nil && r.Context.Window > 0 {
			context = compactNumber(r.Context.Tokens) + "/" + compactNumber(r.Context.Window)
		}
		break
	}
	if partial {
		input += "~"
		output += "~"
	}
	right := "输入 " + input + "  输出 " + output + "  缓存 " + cache + "  上下文 " + context
	if c.width < 88 {
		right = "输入 " + input + " 输出 " + output + " 缓存 " + cache
	}
	if c.width < 44 {
		right = "输入 " + input + " 输出 " + output
	}
	name := oneLine(strings.ToUpper(c.snapshot.Model))
	if name == "" {
		name = "未连接模型"
	}
	left := name
	// 右侧用量优先保留列，窄窗按显示单元截断而非换行。
	rw := ansi.StringWidth(right)
	if rw+4 > c.width {
		right = cut(right, max(1, c.width/2))
		rw = ansi.StringWidth(right)
	}
	left = cut(left, max(0, c.width-rw-2))
	return neon("141", left) + strings.Repeat(" ", max(0, c.width-ansi.StringWidth(left)-rw)) + neon("87", right)
}

// Use the same logical wrapping and caret coordinates as the proven textarea,
// including soft wraps. Render only the window that contains the insertion point.
func (c *model) inputRows() ([]string, int, int) {
	var all []string
	for _, line := range strings.Split(c.input.Value(), "\n") {
		for _, wrapped := range wrapInputLine([]rune(line), max(1, c.input.Width())) {
			all = append(all, string(wrapped))
		}
	}
	row, col := c.inputCaret()
	row = min(max(0, row), max(0, len(all)-1))
	height := min(c.input.Height(), max(1, c.height-3))
	start := max(0, row-height+1)
	end := min(len(all), start+height)
	rows := append([]string(nil), all[start:end]...)
	for len(rows) < height {
		rows = append(rows, "")
	}
	for i, line := range rows {
		prefix := "  "
		if i == 0 {
			prefix = neon("201", "›") + " "
		}
		rows[i] = cut(prefix+line, c.width)
	}
	return rows, row - start, min(c.width-1, 2+col)
}
func (c *model) caretCell() (up, right int) {
	if c.api != nil {
		return max(0, c.height-1-c.api.caretRow), c.api.caretCol
	}
	rows, row, col := c.inputRows()
	return 1 + len(rows) - 1 - row, col
}
func (c *model) View() string {
	c.userVisible, c.bodyVisible, c.thoughtLine.visible = false, false, false
	if c.api != nil {
		room := c.height
		if room > 1 {
			room--
		}
		rows := c.apiRows(room)
		for len(rows) < room {
			rows = append(rows, "")
		}
		if c.height > 1 {
			rows = append(rows, c.metricsLine())
		}
		for i := range rows {
			rows[i] = cut(rows[i], c.width)
		}
		return strings.Join(rows, "\n")
	}
	input, _, _ := c.inputRows()
	bottom := []string{cut(c.statusLine(), c.width), c.composerDivider()}
	bottom = append(bottom, input...)
	bottom = append(bottom, c.metricsLine())
	if len(bottom) > c.height {
		return strings.Join(bottom[len(bottom)-c.height:], "\n")
	}
	room := c.height - len(bottom)
	rows := make([]string, 0, room)
	if c.pinned != nil || c.planExpanded {
		// Keep current calls visible while the user reads a retained detail.
		activity := c.activityRows(min(3, max(0, (room-4)/3)))
		rows = append(c.detailRows(room-len(activity)), activity...)
	} else if items := c.menuItems(); len(items) > 0 {
		rows = append(rows, "  任务 · ↑↓ 选择 · Enter 进入")
		count := max(0, room-1)
		start := max(0, c.menuIndex-count+1)
		for i := start; i < min(len(items), start+count); i++ {
			prefix := "  "
			if i == c.menuIndex {
				prefix = neon("201", "›") + " "
			}
			rows = append(rows, cut(prefix+items[i].label, c.width))
		}
	} else if c.flow.inspect != "" {
		rows = c.flowDetailRows(room)
	} else {
		rows = c.flowRows(room)
	}
	if len(rows) > room {
		rows = rows[:room]
	}
	for len(rows) < room {
		rows = append(rows, "")
	}
	for i := range rows {
		rows[i] = cut(rows[i], c.width)
	}
	return strings.Join(append(rows, bottom...), "\n")
}

// Terminal cells have no alpha channel; graduated intensity makes clipped
// content recede without adding hard separators or modifying cached text.
func softEdges(lines []string, top, bottom bool) []string {
	rows := append([]string(nil), lines...)
	for i, row := range rows {
		distance := len(rows)
		if top {
			distance = i
		}
		if bottom {
			distance = min(distance, len(rows)-1-i)
		}
		if distance == 0 {
			rows[i] = "\x1b[38;5;240m" + row + "\x1b[0m"
		} else if distance == 1 && len(rows) > 2 {
			rows[i] = "\x1b[2m" + row + "\x1b[0m"
		}
	}
	return rows
}
