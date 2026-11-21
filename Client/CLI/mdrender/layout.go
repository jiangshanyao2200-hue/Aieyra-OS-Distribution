// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: Span; Line; Plain; Styled; noLineStart; noLineEnd; badLineStart; badLineEnd; glyphCell; splitGlyphs; isSpaceCell; isWordCell; WrapSpans; wrapLogicalLine; chooseBreak; applyKinsoku; cellsToLine; RenderLine; RenderLineWithRenderer; LinesToString; anyNeedsStrip; clampLines; clampLine; lineWidth; needsStrip; stripControl
// Impact: python -B scripts/code-atlas.py show Client/CLI/mdrender/layout.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package mdrender

import (
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	"github.com/rivo/uniseg"
	"strings"
)

type Span struct {
	Text  string
	Style lipgloss.Style
}

// Line 是一行排好版的文本，由若干 Span 顺序拼接而成。
type Line []Span

// Plain 构造无样式片段。
func Plain(s string) Span { return Span{Text: s} }

// Styled 构造带样式片段。
func Styled(s string, st lipgloss.Style) Span { return Span{Text: s, Style: st} }

// —— 禁则 ——
//
// clreq（W3C 中文排版需求）的行首行尾禁则：某些标点不允许出现在行首、
// 某些不允许出现在行尾。按列硬折行会经常违反，表现为句号孤零零挂在行首——
// 一眼就能看出是机器排的，而不是人写的。

// 不允许出现在行首的字符：收尾类标点与后括号。
const noLineStart = "。，、；：？！）］｝」』】》〉〕〗〙〛…‥—～·" +
	",.;:!?)]}%‰℃°′″”’"

// 不允许出现在行尾的字符：起始类标点与前括号。
const noLineEnd = "（［｛「『【《〈〔〖〘〚“‘([{"

func badLineStart(cluster string) bool {
	if cluster == "" {
		return false
	}
	return strings.ContainsRune(noLineStart, []rune(cluster)[0])
}

func badLineEnd(cluster string) bool {
	if cluster == "" {
		return false
	}
	return strings.ContainsRune(noLineEnd, []rune(cluster)[0])
}

// glyphCell 是排版的最小单位：一个字素簇、它的显示宽度、以及它来自哪个 Span。
type glyphCell struct {
	text  string
	w     int
	style int // 输入 Span 的下标
}

// splitGlyphs 按字素簇切分并算显示宽度。
//
// 宽度用 **lipgloss.Width**，刻意不用 uniseg.StringWidth：后者与前者在个别
// 字符上会给出不同答案（东亚「歧义」宽度的字符、畸形字素簇），而整条链路
// 最终收口的地方——`fitLines` / `truncateAnsi` / `lineWidth`——用的都是 lipgloss
// 那把尺子。两把尺子不一致的后果很实在：要么折出来的行超宽、要么为了迁就
// 尺子白丢字符，两种都在 fuzz 里实测踩到过。
func splitGlyphs(s string) []glyphCell {
	g := uniseg.NewGraphemes(s)
	out := make([]glyphCell, 0, len(s))
	for g.Next() {
		cl := g.Str()
		out = append(out, glyphCell{text: cl, w: lipgloss.Width(cl)})
	}
	return out
}

func isSpaceCell(c glyphCell) bool { return c.text == " " || c.text == "\t" }

// isWordCell 判断是否属于「不可从中间劈开」的词：ASCII 字母数字与下划线。
// 中文不属于此类——中文可以在任意字之间断行。
func isWordCell(c glyphCell) bool {
	if c.text == "" {
		return false
	}
	r := []rune(c.text)[0]
	if r > 0x7f {
		return false
	}
	return r >= '0' && r <= '9' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r == '_'
}

// WrapSpans 按显示宽度把带样式的文本折成若干行。
//
// 先按硬换行切成逻辑行、各自独立排版：列计数因此天然不会跨逻辑行泄漏。
// 空逻辑行保留为一个空行，段落结构靠它保持。
func WrapSpans(spans []Span, width int) []Line {
	// 只做「不小于 1」的保底，**绝不能往上钳**：调用方给的宽度是上限，
	// 往上钳会让可用宽度反过来超过它，于是折出来的行超宽。
	if width < 1 {
		width = 1
	}
	// 净化：折行层必须对**任意**输入成立。零宽格式字符与无效 UTF-8 会让字素簇
	// 宽度失去唯一答案（uniseg / lipgloss / 真实终端三者可能各不相同），
	// "任何一行都不超宽"就不再是硬保证。干净的输入这一步不分配。
	if anyNeedsStrip(spans) {
		clean := make([]Span, len(spans))
		for i, sp := range spans {
			clean[i] = Span{Text: stripControl(sp.Text), Style: sp.Style}
		}
		spans = clean
	}
	var out []Line
	var cur []Span
	for _, sp := range spans {
		parts := strings.Split(sp.Text, "\n")
		for i, part := range parts {
			if i > 0 {
				out = append(out, wrapLogicalLine(cur, width)...)
				cur = nil
			}
			if part != "" {
				cur = append(cur, Span{Text: part, Style: sp.Style})
			}
		}
	}
	out = append(out, wrapLogicalLine(cur, width)...)
	// 兜底收口：逐簇累计的宽度（uniseg）与最终度量的宽度（lipgloss）在个别
	// 畸形字素簇上会分歧，靠渲染函数自觉是不够的。
	return clampLines(out, width)
}

// wrapLogicalLine 排一个不含 \n 的逻辑行。
func wrapLogicalLine(spans []Span, width int) []Line {
	var cells []glyphCell
	for i, sp := range spans {
		for _, c := range splitGlyphs(sp.Text) {
			c.style = i
			cells = append(cells, c)
		}
	}
	// 去掉行尾空白。模型输出里行尾双空格是 Markdown 硬换行标记，终端里不可见；
	// 留着会凭空多出「只有空格的物理行」，还会把宽度算多、挤出多余的折行。
	for len(cells) > 0 && isSpaceCell(cells[len(cells)-1]) {
		cells = cells[:len(cells)-1]
	}
	if len(cells) == 0 {
		return []Line{nil} // 空行也是一个行，否则段落会塌陷
	}

	var out []Line
	start := 0
	for start < len(cells) {
		w, end := 0, start
		for end < len(cells) && w+cells[end].w <= width {
			w += cells[end].w
			end++
		}
		if end >= len(cells) {
			out = append(out, cellsToLine(cells[start:end], spans))
			break
		}
		brk := chooseBreak(cells, start, end)
		if brk <= start {
			brk = start + 1 // 兜底：一行至少一个字素簇，否则死循环
		}
		out = append(out, cellsToLine(cells[start:brk], spans))
		start = brk
		// 断点处的空格是分隔符，不带到下一行行首。
		if start < len(cells) && isSpaceCell(cells[start]) {
			start++
		}
	}
	return out
}

// chooseBreak 在 [start,end) 内挑断点，返回下一行的起始下标。
//
// 优先级：空格 > 词边界 > 任意位置；最后用禁则回拉。
// 「任意位置」对中文是合法的（中文可逐字断行），对拉丁文不合法——所以先试空格与词边界。
//
// 前置条件：start < end。`end == start` 是"这一行连第一个字素簇都放不下"
// 的合法情形（单个超宽字素簇，或者可用宽度被前缀压到 0），此时没有断点可选，
// 直接把 start 还给调用方——它会强制吃掉一个簇，最后交给 clampLines 收口。
// 这个分支不能省：老代码会一路走到 `cells[end-1]`，end 为 0 时就是下标 -1，
// 直接 panic（fuzz 用例 `"      * 二"` + 宽 8 抓到过）。
func chooseBreak(cells []glyphCell, start, end int) int {
	if end <= start {
		return start
	}
	if end > len(cells) {
		end = len(cells)
	}
	for i := end; i > start; i-- {
		if isSpaceCell(cells[i]) {
			return i
		}
	}
	// 断点正好卡在拉丁词中间时，退到词首，避免 instruc / tion 这种劈法。
	if end < len(cells) && isWordCell(cells[end-1]) && isWordCell(cells[end]) {
		i := end
		for i > start && isWordCell(cells[i-1]) {
			i--
		}
		if i > start {
			return applyKinsoku(cells, start, i)
		}
	}
	return applyKinsoku(cells, start, end)
}

// applyKinsoku 用禁则把断点回拉，保证标点不落在错误的一侧。
//
// 只回拉不悬挂：这样每行必然不超过给定宽度，不会顶破固定区域。
func applyKinsoku(cells []glyphCell, start, brk int) int {
	for brk > start+1 && brk < len(cells) && badLineStart(cells[brk].text) {
		brk--
	}
	for brk > start+1 && badLineEnd(cells[brk-1].text) {
		brk--
	}
	return brk
}

// cellsToLine 把字素簇还原成 Span，相邻同一样式的合并以减少转义序列数量。
func cellsToLine(cells []glyphCell, spans []Span) Line {
	var out Line
	var buf strings.Builder
	cur := -1
	flush := func() {
		if buf.Len() == 0 {
			return
		}
		sp := Span{Text: buf.String()}
		if cur >= 0 && cur < len(spans) {
			sp.Style = spans[cur].Style
		}
		out = append(out, sp)
		buf.Reset()
	}
	for _, c := range cells {
		if c.style != cur {
			flush()
			cur = c.style
		}
		buf.WriteString(c.text)
	}
	flush()
	return out
}

// RenderLine 把一行上色。**上色只发生在这里**，排版层因此永远不会碰到转义序列。
//
// 每行独立上色意味着跨行的样式会被重新开启，不会漏色。
func RenderLine(l Line) string {
	return RenderLineWithRenderer(l, nil)
}

// RenderLineWithRenderer uses the caller's terminal capabilities without changing
// Lip Gloss's process-wide stdout detector (which may see a pipe on Windows).
func RenderLineWithRenderer(l Line, renderer *lipgloss.Renderer) string {
	var b strings.Builder
	for _, sp := range l {
		if sp.Text == "" {
			continue
		}
		style := sp.Style
		if renderer != nil {
			style = style.Renderer(renderer)
		}
		b.WriteString(style.Render(sp.Text))
	}
	return b.String()
}

// LinesToString 把排版结果拼回多行字符串。
func LinesToString(lines []Line) string {
	var b strings.Builder
	for i, l := range lines {
		if i > 0 {
			b.WriteString("\n")
		}
		b.WriteString(RenderLine(l))
	}
	return b.String()
}

// anyNeedsStrip 判断这组片段里有没有需要净化的内容，避免为干净文本做副本。
func anyNeedsStrip(spans []Span) bool {
	for _, sp := range spans {
		if needsStrip(sp.Text) {
			return true
		}
	}
	return false
}

// —— 宽度收口 ——
//
// 「每一行都不超过给定宽度」是整套排版的地基：终端一旦自己折行，固定区域的
// 分行就全错位。所以它不能靠每个渲染函数各自自觉——统一在这里裁。

// clampLines 把超宽的行裁到 width 以内（保留片段样式）。
func clampLines(lines []Line, width int) []Line {
	for i, l := range lines {
		if lineWidth(l) > width {
			lines[i] = clampLine(l, width)
		}
	}
	return lines
}

// clampLine 逐字素簇裁剪一行。按字素簇而不是 rune，免得把多码位字符劈开。
func clampLine(l Line, width int) Line {
	var out Line
	acc := 0
	for _, sp := range l {
		if acc >= width {
			break
		}
		var b strings.Builder
		for _, c := range splitGlyphs(sp.Text) {
			if acc+c.w > width {
				break
			}
			b.WriteString(c.text)
			acc += c.w
		}
		if b.Len() > 0 {
			out = append(out, Span{Text: b.String(), Style: sp.Style})
		}
	}
	// 复核：上面用的是 uniseg 的逐簇宽度，而检查方 lineWidth 用的是 lipgloss 的宽度。
	// 两者在个别畸形组合上会给出不同答案（实测 `U+FFFD + VS16`：uniseg 算 1、
	// lipgloss 算 2；`👨🀁` 这种跨块的 ZWJ 组合也会分歧）。所以再用**检查方
	// 自己的尺子**裁一遍——宁可多裁一点，也不能让任何一行超宽。
	for len(out) > 0 && lineWidth(out) > width {
		last := out[len(out)-1]
		r := []rune(last.Text)
		if len(r) <= 1 {
			out = out[:len(out)-1]
			continue
		}
		last.Text = string(r[:len(r)-1])
		out[len(out)-1] = last
	}
	return out
}

func lineWidth(l Line) int {
	n := 0
	for _, sp := range l {
		n += lipgloss.Width(sp.Text)
	}
	return n
}

func needsStrip(s string) bool { return stripControl(s) != s }
func stripControl(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' || r >= 32 && r != 127 && !(r >= 128 && r <= 159) {
			return r
		}
		return -1
	}, ansi.Strip(strings.ToValidUTF8(s, "�")))
}
