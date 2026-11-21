// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: inputCaret; wrapInputLine; repeatRune; runeWidth
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/viewport.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"github.com/charmbracelet/lipgloss"
	"strings"
)

func (c *model) inputCaret() (row, col int) {
	li := c.input.LineInfo()
	row = li.RowOffset
	col = li.CharOffset

	width := c.input.Width()
	if width < 1 {
		return row, col
	}
	logical := strings.Split(c.input.Value(), "\n")
	cur := c.input.Line()
	for i := 0; i < cur && i < len(logical); i++ {
		row += len(wrapInputLine([]rune(logical[i]), width))
	}
	return row, col
}

// wrapInputLine 复刻 bubbles textarea 的软折行，返回它会把这一行切成几段。
//
// 为什么不自己写一个"简单的折行"来数行：数错了插入点就会算到别的行上，
// 预编辑就落到错误的一行；输入框的高度也会少给一行，最后一行被藏起来。
// 所以这里逐条照抄 bubbles v1.0.0 的 textarea.wrap：按空白断词，
// 一个词放不下就整词换行，折行后补一个空格，末尾再补一个空格。
//
// 与上游唯一的差别是宽度尺子用本项目的 lipgloss.Width（约束 35）。
// 对输入框里的纯文本，lipgloss.Width 与上游的 uniseg.StringWidth 同源，
// 结果一致；统一尺子是为了不出现"两把尺子"。
func wrapInputLine(runes []rune, width int) [][]rune {
	lines := [][]rune{{}}
	var word []rune
	row := 0
	spaces := 0
	widthOf := func(rs []rune) int { return lipgloss.Width(string(rs)) }

	for _, r := range runes {
		if r == ' ' || r == '\t' {
			spaces++
		} else {
			word = append(word, r)
		}

		if spaces > 0 {
			if widthOf(lines[row])+widthOf(word)+spaces > width {
				row++
				lines = append(lines, []rune{})
				lines[row] = append(lines[row], word...)
				lines[row] = append(lines[row], repeatRune(' ', spaces)...)
			} else {
				lines[row] = append(lines[row], word...)
				lines[row] = append(lines[row], repeatRune(' ', spaces)...)
			}
			spaces, word = 0, nil
			continue
		}
		// 没有待处理的空白：累计的词可能已经占满整行，需要换行。
		//
		// 注意 append 必须在里面那层 if **之外**：当前行还是空的时候
		// （输入的第一个词就比一行宽）不换行，但词一定要落到这一行上并清零。
		// 把 append 也塞进 if 里，超长的词会永远堆在 word 里不落地，
		// 行数就恒等于 1——输入框再长也不长高，最后一行被藏起来。
		//
		// 条件里的 +last 不是重复计算：它的意思是“再加一个字就超了，
		// 现在就换行”，给行尾光标位留出一列。改成 widthOf(word) > width
		// 会让恰满行的词多赖一行，与 textarea 实测差一行
		//（TestWrapInputLineMatchesTextareaRowCount 会失败）。别动它。
		if len(word) > 0 {
			last := runeWidth(word[len(word)-1])
			if widthOf(word)+last > width {
				if len(lines[row]) > 0 {
					row++
					lines = append(lines, []rune{})
				}
				lines[row] = append(lines[row], word...)
				word = nil
			}
		}
	}

	if widthOf(lines[row])+widthOf(word)+spaces >= width {
		lines = append(lines, []rune{})
		lines[row+1] = append(lines[row+1], word...)
		lines[row+1] = append(lines[row+1], repeatRune(' ', spaces+1)...)
	} else {
		lines[row] = append(lines[row], word...)
		lines[row] = append(lines[row], repeatRune(' ', spaces+1)...)
	}
	return lines
}

// repeatRune 生成 n 个同一个字符。
func repeatRune(r rune, n int) []rune {
	if n <= 0 {
		return nil
	}
	return []rune(strings.Repeat(string(r), n))
}

// runeWidth 返回单个字符的显示宽度。
func runeWidth(r rune) int { return lipgloss.Width(string(r)) }
