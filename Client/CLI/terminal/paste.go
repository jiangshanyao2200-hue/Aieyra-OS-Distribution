// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: pasteFoldRunes; pasteFoldLines; pasteBlock; burstGap; pasteGuardWindow; pasteSettleMsg; pasteGuardActive; bufferInput; armPasteTimer; settlePaste; clearPasteState; insertPasted; handlePaste; pasteToken; expandPastes
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/paste.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"fmt"
	tea "github.com/charmbracelet/bubbletea"
	"strings"
	"time"
)

const pasteFoldRunes = 200
const pasteFoldLines = 6

type pasteBlock struct{ token, text string }

const burstGap = 20 * time.Millisecond
const pasteGuardWindow = 120 * time.Millisecond

type pasteSettleMsg struct {
	gen   int
	timed bool
	epoch int
}

func (c *model) pasteGuardActive() bool {
	return !c.pasteUntil.IsZero() && time.Now().Before(c.pasteUntil)
}

func (c *model) bufferInput(text string) tea.Cmd {
	if text != "" {
		c.inputEpoch++
	}
	now := time.Now()
	if len(c.pasteBuffer) > 0 && !c.pasteGuardActive() {
		c.settlePaste()
	}
	// 中文和 ASCII 都只短暂等待首批输入；短输入法提交不折叠。
	runes := []rune(text)
	// 普通逐键输入不能因为速度快而吞掉 Enter；只有成块输入才延续粘贴换行。
	c.pasteBulk = c.pasteBulk || len(runes) >= 16 || strings.ContainsAny(text, "\n\r\t")
	continuing := len(c.pasteBuffer) > 0
	if !continuing {
		c.foldStart = c.inputOffset()
	}
	c.pasteBuffer = append(c.pasteBuffer, runes...)
	c.pasteGen++
	delay := burstGap
	if continuing {
		delay = 60 * time.Millisecond
	}
	if len(c.pasteBuffer) > pasteFoldRunes || strings.ContainsAny(text, "\n\r\t") {
		delay = pasteGuardWindow
	}
	c.pasteDelay = max(c.pasteDelay, delay)
	c.pasteUntil = now.Add(c.pasteDelay)
	return c.armPasteTimer()
}

// 一个洪流最多一个在途定时器；后续字符只更新截止时刻，不逐字创建 goroutine。
func (c *model) armPasteTimer() tea.Cmd {
	if c.pasteTimer || len(c.pasteBuffer) == 0 {
		return nil
	}
	c.pasteTimer = true
	epoch, gen := c.pasteEpoch, c.pasteGen
	delay := max(time.Millisecond, c.pasteUntil.Sub(time.Now()))
	return tea.Tick(delay, func(time.Time) tea.Msg { return pasteSettleMsg{gen: gen, timed: true, epoch: epoch} })
}

func (c *model) settlePaste() tea.Cmd {
	if len(c.pasteBuffer) == 0 {
		return nil
	}
	text := string(c.pasteBuffer)
	c.clearPasteState()
	text = safeText(strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n"))
	c.insertPasted(text)
	return nil
}

func (c *model) clearPasteState() {
	c.pasteBuffer = nil
	c.pasteDelay = 0
	c.foldStart = -1
	c.pasteGen++
	c.pasteEpoch++
	c.pasteTimer = false
	c.pasteBulk = false
	c.pasteUntil = time.Time{}
}

// insertPasted 把一段粘贴文本放进输入框，超长时折叠成占位符。
func (c *model) insertPasted(text string) {
	display := text
	// The textarea sanitizer turns tabs into spaces. Keep code indentation exact
	// inside a block, including short snippets and literal block-label examples.
	if len([]rune(text)) > pasteFoldRunes || strings.Count(text, "\n")+1 > pasteFoldLines || strings.Contains(text, "\t") || strings.Contains(text, "[已粘贴 ") {
		c.pasteSeq++
		token := pasteToken(c.pasteSeq, text)
		for strings.Contains(c.input.Value(), token) {
			c.pasteSeq++
			token = pasteToken(c.pasteSeq, text)
		}
		c.pastes = append(c.pastes, pasteBlock{token: token, text: text})
		display = token
	}
	before := c.input.Value()
	c.input.InsertString(display)
	if c.input.Value() != before {
		c.inputEpoch++
	}
	c.menuClosed = false
	c.growInput()
}

// handlePaste 处理一次**带括号标记**的粘贴：净化 → 必要时折叠 → 插进输入框。
//
// 这条路是首选：终端明确告诉我们"这是一整段粘贴"，不可能是按键。
// 内容完整到手，不开装配窗口；同时清零洪流计时——
// 粘完紧接着按的回车必须是发送，不能再被当成粘贴换行。
func (c *model) handlePaste(raw string) tea.Cmd {
	c.settlePaste()
	text, ok := sanitizePaste(raw)
	if !ok {
		// 全是控制字符（或空）——明确拒绝，并且让用户看见，
		// 否则他会以为程序卡住了。
		c.notice = "已忽略：粘贴的不是文本"
		return nil
	}
	c.insertPasted(text)
	return nil
}

func pasteToken(seq int, text string) string {
	return fmt.Sprintf("[已粘贴 %d 字符 #%d]", len([]rune(text)), seq)
}

// expandPastes 把输入框里的占位符换回真正的粘贴内容。
//
// 按顺序逐个替换**第一处**出现：这样两次内容相同的粘贴也能各归各位。
func (c *model) expandPastes(display string) string {
	// 只扫描显示串，不再次扫描展开后的正文，避免正文中的 token 文本被二次替换。
	var out strings.Builder
	used := make([]bool, len(c.pastes))
	for len(display) > 0 {
		next, which := -1, -1
		for i, p := range c.pastes {
			if used[i] {
				continue
			}
			idx := strings.Index(display, p.token)
			if idx >= 0 && (next < 0 || idx < next) {
				next, which = idx, i
			}
		}
		if which < 0 {
			out.WriteString(display)
			break
		}
		p := c.pastes[which]
		used[which] = true
		out.WriteString(display[:next])
		out.WriteString(p.text)
		display = display[next+len(p.token):]
	}
	return out.String()
}
