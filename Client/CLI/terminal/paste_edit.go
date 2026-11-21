// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: clipboardTextMsg; clipboardResult; inputOffset; setInputAt; editPasteBlock; deletePasteRange
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/paste_edit.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Presentation extracted from the original Core/ui; no legacy executor.
package terminal

import (
	tea "github.com/charmbracelet/bubbletea"
	"strings"
)

type clipboardTextMsg struct {
	text string
	err  error
}
type clipboardResult struct {
	clipboardTextMsg
	session, input int
}

// LineInfo 提供逻辑行内的 rune 偏移，不需要从屏幕列数猜光标。
func (c *model) inputOffset() int {
	lines := strings.Split(c.input.Value(), "\n")
	pos := 0
	for i := 0; i < c.input.Line() && i < len(lines); i++ {
		pos += len([]rune(lines[i])) + 1
	}
	info := c.input.LineInfo()
	return pos + info.StartColumn + info.ColumnOffset
}
func (c *model) setInputAt(value string, offset int) {
	if value != c.input.Value() {
		c.inputEpoch++
	}
	c.input.SetValue(value)
	for i := len([]rune(value)); i > offset; i-- {
		c.input, _ = c.input.Update(tea.KeyMsg{Type: tea.KeyLeft})
	}
	c.growInput()
}

// 块是一个编辑单元：删除整块、左右跨过整块，不留下失效的半截占位符。
func (c *model) editPasteBlock(msg tea.KeyMsg) bool {
	if len(c.pastes) > 0 {
		switch msg.String() {
		case "ctrl+w", "alt+backspace", "alt+delete", "alt+d", "ctrl+k":
			c.deletePasteRange(msg)
			return true
		}
	}
	pos := c.inputOffset()
	text := c.input.Value()
	for i, p := range c.pastes {
		idx := strings.Index(text, p.token)
		if idx < 0 {
			continue
		}
		start := len([]rune(text[:idx]))
		end := start + len([]rune(p.token))
		switch msg.String() {
		case "backspace", "ctrl+h":
			if pos > start && pos <= end {
				c.setInputAt(text[:idx]+text[idx+len(p.token):], start)
				c.pastes = append(c.pastes[:i], c.pastes[i+1:]...)
				return true
			}
		case "delete", "ctrl+d":
			if pos >= start && pos < end {
				c.setInputAt(text[:idx]+text[idx+len(p.token):], start)
				c.pastes = append(c.pastes[:i], c.pastes[i+1:]...)
				return true
			}
		case "left", "ctrl+b":
			if pos > start && pos <= end {
				c.setInputAt(text, start)
				return true
			}
		case "right", "ctrl+f":
			if pos >= start && pos < end {
				c.setInputAt(text, end)
				return true
			}
		case "ctrl+t":
			if pos > start && pos <= end {
				return true
			}
		default:
			if pos > start && pos < end {
				c.setInputAt(text, end)
			}
		}
	}
	return false
}

// 先让控件算出删除范围，再把碰到占位符的边界扩展为整个块。
// Ctrl+W/Ctrl+K 等键不能留下半个标记，导致发送时正文悄悄消失。
func (c *model) deletePasteRange(msg tea.KeyMsg) {
	before := []rune(c.input.Value())
	c.input, _ = c.input.Update(msg)
	after := []rune(c.input.Value())
	start := 0
	for start < len(before) && start < len(after) && before[start] == after[start] {
		start++
	}
	end, tail := len(before), len(after)
	for end > start && tail > start && before[end-1] == after[tail-1] {
		end--
		tail--
	}
	if start == end {
		return
	}
	c.inputEpoch++
	kept := c.pastes[:0]
	original := string(before)
	for _, p := range c.pastes {
		idx := strings.Index(original, p.token)
		if idx < 0 {
			continue
		}
		lo := len([]rune(original[:idx]))
		hi := lo + len([]rune(p.token))
		if start < hi && end > lo {
			start = min(start, lo)
			end = max(end, hi)
		} else {
			kept = append(kept, p)
		}
	}
	c.pastes = kept
	c.setInputAt(string(before[:start])+string(before[end:]), start)
}
