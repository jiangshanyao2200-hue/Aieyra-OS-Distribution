// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: mdKind; mdListItem; mdBlock; fenceOpen; isFenceClose; isRule; heading; quoteLine; listItem; startsBlock; hasHardBreak; looksLikeTableRow; isTableSep; splitTableRow; parseMarkdown; joinText; needsSpace; mathSymbols; init; takeBraced; expandBracedCmd; convertMath; takeMath; takeLink; takeBareURL; parseInline; parseInlineDepth; isActionLine; wrapStyled; inlineWrap; expandTabs; wrapCodeLine; renderCodeBlock; renderQuote; renderList; renderTable; renderBlock; renderBlockRaw; blockCacheMax; blockKey; writeKV; renderBlockCached; RenderMarkdown; RenderMarkdownStable; RenderMarkdownCompactStable; renderMarkdownStable; holdAll; blockHoldback; blockSealed; Inline; Math; ActionLine; WrapStyled
// Impact: python -B scripts/code-atlas.py show Client/CLI/mdrender/markdown.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package mdrender

import (
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/charmbracelet/lipgloss"
)

// Markdown 兼容层。
//
// 定位：人格层明确要求不要用文档腔说话（自我.txt：不写"没有味道的报告"），
// 所以这里**不是渲染目标，而是兼容层**——模型偶尔会用，用户自己的输入里也常带代码。
//
// 两条硬性质：
//  1. 代码块里的内容一字不改（只展开 Tab、去行尾空白、必要时按宽度折行）
//  2. 每个源行的渲染只依赖「该行内容 + 该行起始处的解析状态」，
//     不依赖后面的行——这样流式追加时已显示的行不会重排。
//
// 第 2 条决定了几个设计取舍：不合并软换行、段落等于一个源行、表格整块缓冲。

// —— 块级模型 ——

type mdKind int

const (
	mdPara mdKind = iota
	mdHeading
	mdRule
	mdCode
	mdQuote
	mdList
	mdTable
)

// mdListItem 是列表里的一项。
type mdListItem struct {
	marker string // 例如 "1. " / "- "
	level  int    // 缩进层级，0 起
	text   string
}

// mdBlock 是一个块级元素。
type mdBlock struct {
	kind      mdKind
	text      string       // 段落 / 标题 / 引用的正文
	info      string       // 代码块的语言标签
	level     int          // 标题级别或引用深度
	lines     []string     // 代码块的原始行
	items     []mdListItem // 列表项
	rows      [][]string   // 表格
	closed    bool         // 仅代码块用：围栏是否已闭合
	sourceGap bool         // 该普通源行之前有真正的空行；仅 compact 布局使用
}

// —— 行级识别 ——

// fenceOpen 识别围栏代码块的开始，返回围栏标记与语言标签。
func fenceOpen(s string) (mark, info string, ok bool) {
	for _, c := range []string{"```", "~~~"} {
		if strings.HasPrefix(s, c) {
			n := 0
			for n < len(s) && string(s[n]) == c[:1] {
				n++
			}
			return s[:n], strings.TrimSpace(s[n:]), true
		}
	}
	return "", "", false
}

// isFenceClose 判断是否是结束围栏：同种字符、长度不少于开始标记。
func isFenceClose(s, mark string) bool {
	if mark == "" || !strings.HasPrefix(s, mark[:1]) {
		return false
	}
	n := 0
	for n < len(s) && string(s[n]) == mark[:1] {
		n++
	}
	return n >= len(mark) && strings.TrimSpace(s[n:]) == ""
}

// isRule 识别分隔线：三个以上相同的 - * _ 。
func isRule(s string) bool {
	if len(s) < 3 {
		return false
	}
	c := s[0]
	if c != '-' && c != '*' && c != '_' {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] != c {
			return false
		}
	}
	return true
}

// heading 识别 ATX 标题。
func heading(s string) (level int, content string, ok bool) {
	n := 0
	for n < len(s) && s[n] == '#' {
		n++
	}
	if n == 0 || n > 6 || n >= len(s) || s[n] != ' ' {
		return 0, "", false
	}
	return n, strings.TrimSpace(strings.TrimRight(s[n:], "#")), true
}

// quoteLine 识别引用行，返回深度与去掉 "> " 之后的正文。
func quoteLine(raw string) (depth int, content string, ok bool) {
	s := strings.TrimLeft(raw, " ")
	for strings.HasPrefix(s, ">") {
		depth++
		s = strings.TrimPrefix(s, ">")
		if strings.HasPrefix(s, " ") {
			s = s[1:]
		}
	}
	if depth == 0 {
		return 0, "", false
	}
	return depth, s, true
}

// listItem 识别列表项。level 由缩进推出：每两列算一层。
func listItem(raw string) (marker, content string, level int, ok bool) {
	indent := len(raw) - len(strings.TrimLeft(raw, " "))
	level = indent / 2
	s := strings.TrimLeft(raw, " ")
	if s == "" {
		return "", "", 0, false
	}
	// 无序：- * +
	if len(s) >= 2 && (s[0] == '-' || s[0] == '*' || s[0] == '+') && s[1] == ' ' {
		return string(s[0]) + " ", strings.TrimSpace(s[2:]), level, true
	}
	// 有序：数字 + . 或 ) + 空格
	i := 0
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	if i > 0 && i+1 < len(s) && (s[i] == '.' || s[i] == ')') && s[i+1] == ' ' {
		return s[:i+1] + " ", strings.TrimSpace(s[i+2:]), level, true
	}
	return "", "", 0, false
}

// startsBlock 判断这一行是否会开启一个新块（用于终止段落与列表项续行）。
func startsBlock(raw string) bool {
	s := strings.TrimSpace(raw)
	if s == "" {
		return true
	}
	if _, _, ok := fenceOpen(s); ok {
		return true
	}
	if _, _, ok := heading(s); ok {
		return true
	}
	if isRule(s) {
		return true
	}
	if _, _, ok := quoteLine(raw); ok {
		return true
	}
	if _, _, _, ok := listItem(raw); ok {
		return true
	}
	return false
}

// hasHardBreak 判断行尾是否有 Markdown 硬换行标记（两个以上空格或反斜杠）。
//
// 模型输出里这个标记满天飞（实测样本几乎每行都有），必须识别——否则会把
// 行尾空白当正文，宽度算多、还会凭空多出「只有空格的物理行」。
func hasHardBreak(raw string) bool {
	if strings.HasSuffix(raw, "\\") {
		return true
	}
	t := strings.TrimRight(raw, "\t")
	return len(t)-len(strings.TrimRight(t, " ")) >= 2
}

// —— 表格 ——

func looksLikeTableRow(s string) bool {
	return strings.Contains(s, "|") && strings.Count(s, "|") >= 2
}

// isTableSep 识别 |---|---| 这种分隔行。
func isTableSep(s string) bool {
	if !looksLikeTableRow(s) {
		return false
	}
	for _, r := range s {
		if r != '|' && r != '-' && r != ':' && r != ' ' {
			return false
		}
	}
	return strings.Contains(s, "-")
}

func splitTableRow(s string) []string {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "|")
	s = strings.TrimSuffix(s, "|")
	parts := strings.Split(s, "|")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		out = append(out, strings.TrimSpace(p))
	}
	return out
}

// —— 块级解析 ——

// parseMarkdown 把文本切成块。
//
// 逐行推进的状态机：只有围栏需要跨行状态；引用与列表各自成块，
// 表格整块缓冲（列宽要对齐，必须看到全部行）。
func parseMarkdown(text string) []mdBlock {
	src := strings.Split(text, "\n")
	var blocks []mdBlock
	fence := ""

	i := 0
	for i < len(src) {
		raw := src[i]
		trimmed := strings.TrimSpace(raw)

		// 围栏内部：原样收集，不做任何解析
		if fence != "" {
			if isFenceClose(trimmed, fence) {
				fence = ""
				blocks[len(blocks)-1].closed = true
				i++
				continue
			}
			blocks[len(blocks)-1].lines = append(blocks[len(blocks)-1].lines, raw)
			i++
			continue
		}
		if mark, info, ok := fenceOpen(trimmed); ok {
			fence = mark
			blocks = append(blocks, mdBlock{kind: mdCode, info: info})
			i++
			continue
		}
		if trimmed == "" {
			i++
			continue
		}
		if isRule(trimmed) {
			blocks = append(blocks, mdBlock{kind: mdRule})
			i++
			continue
		}
		if lvl, content, ok := heading(trimmed); ok {
			blocks = append(blocks, mdBlock{kind: mdHeading, text: content, level: lvl})
			i++
			continue
		}

		// 表格：当前行 + 下一行是分隔行 → 表头
		if i+1 < len(src) && looksLikeTableRow(trimmed) && isTableSep(strings.TrimSpace(src[i+1])) {
			rows := [][]string{splitTableRow(trimmed)}
			i += 2
			for i < len(src) && looksLikeTableRow(strings.TrimSpace(src[i])) {
				rows = append(rows, splitTableRow(strings.TrimSpace(src[i])))
				i++
			}
			blocks = append(blocks, mdBlock{kind: mdTable, rows: rows})
			continue
		}

		// 引用：连续同深度的引用行合成一块
		if depth, content, ok := quoteLine(raw); ok {
			b := mdBlock{kind: mdQuote, level: depth}
			b.lines = append(b.lines, content)
			i++
			for i < len(src) {
				d2, c2, ok2 := quoteLine(src[i])
				if !ok2 || d2 != depth {
					break
				}
				b.lines = append(b.lines, c2)
				i++
			}
			blocks = append(blocks, b)
			continue
		}

		// 列表：连续的列表项（含续行）合成一块
		if marker, content, level, ok := listItem(raw); ok {
			b := mdBlock{kind: mdList}
			b.items = append(b.items, mdListItem{marker: marker, level: level, text: content})
			i++
			for i < len(src) {
				t := strings.TrimSpace(src[i])
				if t == "" {
					break
				}
				if m2, c2, l2, ok2 := listItem(src[i]); ok2 {
					b.items = append(b.items, mdListItem{marker: m2, level: l2, text: c2})
					i++
					continue
				}
				if startsBlock(src[i]) {
					break
				}
				// 续行并入上一项
				last := &b.items[len(b.items)-1]
				last.text = joinText(last.text, t)
				i++
			}
			blocks = append(blocks, b)
			continue
		}

		// 段落：一个源行就是一个块。
		//
		// 刻意**不**把连续的软换行合并成一段：模型是一句话一行，
		// 合并会让后到的行改变已显示行的折行，流式时整段文字会跳动。
		blocks = append(blocks, mdBlock{kind: mdPara, text: trimmed, sourceGap: i > 0 && strings.TrimSpace(src[i-1]) == ""})
		i++
	}
	return blocks
}

// joinText 拼接两段文本：两侧都是拉丁字符时补一个空格，中文之间不补。
func joinText(a, b string) string {
	if a == "" {
		return b
	}
	if b == "" {
		return a
	}
	if needsSpace(a[len(a)-1], b[0]) {
		return a + " " + b
	}
	return a + b
}

func needsSpace(prev, next byte) bool {
	if prev >= 0x80 || next >= 0x80 {
		return false
	}
	return prev != ' ' && next != ' '
}

// —— 数学 ——
//
// 终端渲染不了 LaTeX。策略：剥定界符、常见符号转 Unicode、结构性命令展开；
// **转不了的原样保留**——宁可不漂亮，也不静默丢掉用户的内容。

var mathSymbols = []struct{ from, to string }{
	{`\leqslant`, "≤"}, {`\geqslant`, "≥"}, {`\rightarrow`, "→"}, {`\leftarrow`, "←"},
	{`\Rightarrow`, "⇒"}, {`\Leftarrow`, "⇐"}, {`\leftrightarrow`, "↔"},
	{`\cdots`, "⋯"}, {`\ldots`, "…"}, {`\times`, "×"}, {`\div`, "÷"},
	{`\cdot`, "·"}, {`\pm`, "±"}, {`\mp`, "∓"}, {`\leq`, "≤"}, {`\geq`, "≥"},
	{`\neq`, "≠"}, {`\approx`, "≈"}, {`\equiv`, "≡"}, {`\propto`, "∝"},
	{`\infty`, "∞"}, {`\sum`, "Σ"}, {`\prod`, "Π"}, {`\int`, "∫"},
	{`\partial`, "∂"}, {`\nabla`, "∇"}, {`\notin`, "∉"}, {`\in`, "∈"},
	{`\subset`, "⊂"}, {`\supset`, "⊃"}, {`\cup`, "∪"}, {`\cap`, "∩"},
	{`\forall`, "∀"}, {`\exists`, "∃"}, {`\angle`, "∠"}, {`\perp`, "⊥"},
	{`\parallel`, "∥"}, {`\alpha`, "α"}, {`\beta`, "β"}, {`\gamma`, "γ"},
	{`\delta`, "δ"}, {`\varepsilon`, "ε"}, {`\epsilon`, "ε"}, {`\zeta`, "ζ"},
	{`\eta`, "η"}, {`\theta`, "θ"}, {`\iota`, "ι"}, {`\kappa`, "κ"},
	{`\lambda`, "λ"}, {`\mu`, "μ"}, {`\nu`, "ν"}, {`\xi`, "ξ"}, {`\pi`, "π"},
	{`\rho`, "ρ"}, {`\sigma`, "σ"}, {`\tau`, "τ"}, {`\varphi`, "φ"}, {`\phi`, "φ"},
	{`\chi`, "χ"}, {`\psi`, "ψ"}, {`\omega`, "ω"}, {`\Delta`, "Δ"}, {`\Omega`, "Ω"},
	{`\Sigma`, "Σ"}, {`\Pi`, "Π"}, {`\Phi`, "Φ"}, {`\Theta`, "Θ"}, {`\Lambda`, "Λ"},
	{`\left`, ""}, {`\right`, ""}, {`\qquad`, "    "}, {`\quad`, "  "},
	{`\,`, " "}, {`\;`, " "}, {`\!`, ""},
}

func init() {
	// 长的先替换，否则 \in 会把 \infty 吃掉。
	sort.SliceStable(mathSymbols, func(i, j int) bool {
		return len(mathSymbols[i].from) > len(mathSymbols[j].from)
	})
}

// takeBraced 从 s[i] 处的 '{' 起取出配对的内容，返回内容与结束后的下标。
func takeBraced(s string, i int) (string, int, bool) {
	if i >= len(s) || s[i] != '{' {
		return "", 0, false
	}
	depth := 0
	for j := i; j < len(s); j++ {
		switch s[j] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return s[i+1 : j], j + 1, true
			}
		}
	}
	return "", 0, false
}

// expandBracedCmd 反复把 \cmd{a}{b} 形态的命令替换成模板结果。
func expandBracedCmd(s, cmd string, arity int, tmpl func(args []string) string) string {
	for {
		i := strings.Index(s, cmd)
		if i < 0 {
			return s
		}
		pos := i + len(cmd)
		args := make([]string, 0, arity)
		ok := true
		for k := 0; k < arity; k++ {
			a, next, good := takeBraced(s, pos)
			if !good {
				ok = false
				break
			}
			args = append(args, a)
			pos = next
		}
		if !ok {
			return s
		}
		s = s[:i] + tmpl(args) + s[pos:]
	}
}

// convertMath 把一段 LaTeX 正文转成终端可读形式。
func convertMath(s string) string {
	s = expandBracedCmd(s, `\frac`, 2, func(a []string) string { return "(" + a[0] + ")/(" + a[1] + ")" })
	s = expandBracedCmd(s, `\dfrac`, 2, func(a []string) string { return "(" + a[0] + ")/(" + a[1] + ")" })
	s = expandBracedCmd(s, `\sqrt`, 1, func(a []string) string { return "√(" + a[0] + ")" })
	s = expandBracedCmd(s, `\boxed`, 1, func(a []string) string { return "[" + a[0] + "]" })
	s = expandBracedCmd(s, `\text`, 1, func(a []string) string { return a[0] })
	for _, kv := range mathSymbols {
		s = strings.ReplaceAll(s, kv.from, kv.to)
	}
	// 剩下的花括号只是分组，去掉；转义符与未知命令保留原样，不静默丢内容。
	s = strings.ReplaceAll(s, "{", "")
	s = strings.ReplaceAll(s, "}", "")
	return strings.TrimSpace(strings.Join(strings.Fields(s), " "))
}

// takeMath 识别 \(...\) 与 \[...\]，返回转换后的正文与消耗的字节数。
func takeMath(s string) (string, int, bool) {
	for _, d := range [][2]string{{`\(`, `\)`}, {`\[`, `\]`}} {
		if !strings.HasPrefix(s, d[0]) {
			continue
		}
		body := s[len(d[0]):]
		end := strings.Index(body, d[1])
		if end < 0 {
			// 未闭合：把定界符剥掉按数学处理，避免流式时反斜杠糊在正文里
			return convertMath(body), len(s), true
		}
		return convertMath(body[:end]), len(d[0]) + end + len(d[1]), true
	}
	return "", 0, false
}

// —— 行内解析 ——

// takeLink 识别 [文本](url)。
func takeLink(s string) (text, url string, n int, ok bool) {
	if !strings.HasPrefix(s, "[") {
		return "", "", 0, false
	}
	mid := strings.Index(s, "](")
	if mid <= 0 {
		return "", "", 0, false
	}
	close := strings.Index(s[mid:], ")")
	if close < 0 {
		return "", "", 0, false
	}
	text = s[1:mid]
	url = s[mid+2 : mid+close]
	if strings.TrimSpace(text) == "" || strings.TrimSpace(url) == "" {
		return "", "", 0, false
	}
	return text, url, mid + close + 1, true
}

// takeBareURL 识别裸露的 http(s) 链接。
func takeBareURL(s string) (string, int, bool) {
	for _, p := range []string{"https://", "http://"} {
		if !strings.HasPrefix(s, p) {
			continue
		}
		j := len(p)
		for j < len(s) && s[j] > ' ' && s[j] < 0x80 && s[j] != ')' && s[j] != ']' {
			j++
		}
		// 收尾的句读标点不属于 URL
		for j > len(p) && strings.ContainsRune(".,;:!?", rune(s[j-1])) {
			j--
		}
		return s[:j], j, true
	}
	return "", 0, false
}

// parseInline 把一行文本切成带样式的片段。
//
// 未闭合的标记按**字面**处理：流式过程中 ** 常常只到一半，若把它当强调起点，
// 整行会在下一帧突然变形。宁可这一帧少一次加粗，也不要让文字跳动。
func parseInline(s string, base lipgloss.Style) []Span {
	return parseInlineDepth(s, base, 0)
}

func parseInlineDepth(s string, base lipgloss.Style, depth int) []Span {
	if depth >= 16 {
		return []Span{{Text: s, Style: base}}
	}
	var out []Span
	var buf strings.Builder
	flush := func() {
		if buf.Len() > 0 {
			out = append(out, Span{Text: buf.String(), Style: base})
			buf.Reset()
		}
	}

	i := 0
	for i < len(s) {
		if s[i] == '\\' && i+1 < len(s) && strings.ContainsRune("\\`*_{}[]()#+-.!|~", rune(s[i+1])) {
			buf.WriteByte(s[i+1])
			i += 2
			continue
		}
		if body, n, ok := takeMath(s[i:]); ok {
			flush()
			out = append(out, Span{Text: body, Style: styleMDMath})
			i += n
			continue
		}
		switch {
		case s[i] == '`':
			// 行内代码：反引号数量要配对（`` `` ``）
			n := 1
			for i+n < len(s) && s[i+n] == '`' {
				n++
			}
			tick := strings.Repeat("`", n)
			if end := strings.Index(s[i+n:], tick); end >= 0 {
				flush()
				out = append(out, Span{Text: s[i+n : i+n+end], Style: styleMDCode})
				i += n + end + n
				continue
			}
		case strings.HasPrefix(s[i:], "~~"):
			if end := strings.Index(s[i+2:], "~~"); end > 0 {
				flush()
				out = append(out, parseInlineDepth(s[i+2:i+2+end], base.Strikethrough(true).Foreground(styleMDStrike.GetForeground()), depth+1)...)
				i += end + 4
				continue
			}
		case s[i] == '*' || s[i] == '_':
			if body, n, count, ok := takeEmphasis(s, i); ok {
				flush()
				style := base
				if count >= 2 {
					style = style.Bold(true).Foreground(styleMDBold.GetForeground())
				}
				if count != 2 {
					style = style.Italic(true)
				}
				out = append(out, parseInlineDepth(body, style, depth+1)...)
				i += n
				continue
			}
		case s[i] == '[':
			if text, url, n, ok := takeLink(s[i:]); ok {
				flush()
				out = append(out, parseInlineDepth(text, base.Foreground(styleMDLink.GetForeground()), depth+1)...)
				out = append(out, Span{Text: " " + url, Style: styleMDURL})
				i += n
				continue
			}
		case s[i] == 'h':
			if u, n, ok := takeBareURL(s[i:]); ok {
				flush()
				out = append(out, Span{Text: u, Style: styleMDURL})
				i += n
				continue
			}
		}
		buf.WriteByte(s[i])
		i++
	}
	flush()
	return out
}

// isActionLine 判断整行是否是一个角色动作（*动作*）。
//
// 依据 Prompt/自我.txt 第 20 行：动作必须用 *动作* 且单独成排。
// 这是人格层的一等构造，不能当作普通斜体处理。
func isActionLine(s string) (string, bool) {
	t := strings.TrimSpace(s)
	if len(t) < 3 || t[0] != '*' || t[len(t)-1] != '*' {
		return "", false
	}
	if strings.HasPrefix(t, "**") || strings.Count(t, "*") != 2 {
		return "", false
	}
	body := strings.TrimSpace(t[1 : len(t)-1])
	if body == "" {
		return "", false
	}
	return body, true
}

// —— 块级渲染 ——

// wrapStyled 把纯文本按宽度折行并整段套用样式。
func wrapStyled(s string, width int, st lipgloss.Style) []Line {
	if s == "" {
		return nil
	}
	return WrapSpans([]Span{Styled(s, st)}, width)
}

// inlineWrap 先做行内解析，再按宽度折行。
func inlineWrap(s string, width int, base lipgloss.Style) []Line {
	if s == "" {
		return nil
	}
	return WrapSpans(parseInline(s, base), width)
}

// expandTabs 把 Tab 展开成空格。
//
// 必须展开：终端有自己的 Tab 停位，和我们按列数算的宽度完全不一致，
// 代码块里只要有一个 Tab，整块就会错位。
func expandTabs(s string, n int) string {
	if !strings.ContainsRune(s, '\t') {
		return s
	}
	var b strings.Builder
	col := 0
	for _, r := range s {
		if r == '\t' {
			pad := n - col%n
			b.WriteString(strings.Repeat(" ", pad))
			col += pad
			continue
		}
		b.WriteRune(r)
		col++
	}
	return b.String()
}

// wrapCodeLine 按显示宽度硬切代码行（代码没有词边界可依）。
func wrapCodeLine(s string, w int) []string {
	if w < 1 {
		w = 1
	}
	if lipgloss.Width(s) <= w {
		return []string{s}
	}
	var out []string
	var b strings.Builder
	acc := 0
	for _, c := range splitGlyphs(s) {
		if acc+c.w > w && acc > 0 {
			out = append(out, b.String())
			b.Reset()
			acc = 0
		}
		b.WriteString(c.text)
		acc += c.w
	}
	if b.Len() > 0 {
		out = append(out, b.String())
	}
	if len(out) == 0 {
		return []string{""}
	}
	return out
}

func renderCodeBlock(b mdBlock, width int) []Line {
	var out []Line
	if b.info != "" {
		out = append(out, Line{Styled("┌ "+b.info, styleMDLang)})
	}
	body := width - 2 // 给边槽留两列
	if body < 1 {
		body = 1
	}
	for _, raw := range b.lines {
		line := strings.TrimRight(expandTabs(raw, 4), " \t")
		segs := wrapCodeLine(line, body)
		for j, seg := range segs {
			gutter, gs := "│ ", styleMDGutter
			if j > 0 {
				gutter, gs = "┆ ", styleMDCont
			}
			// 补足到正文宽度，让整块的底色连成一片而不是参差。
			if pad := body - lipgloss.Width(seg); pad > 0 {
				seg += strings.Repeat(" ", pad)
			}
			out = append(out, Line{Styled(gutter, gs), Styled(seg, styleMDCodeBlock)})
		}
	}
	return out
}

func renderQuote(b mdBlock, width int) []Line {
	bar := strings.Repeat("▏ ", b.level)
	avail := width - lipgloss.Width(bar)
	if avail < 1 {
		avail = 1
	}
	var out []Line
	for _, text := range b.lines {
		for _, l := range inlineWrap(text, avail, styleMDQuote) {
			out = append(out, append(Line{Styled(bar, styleMDQuoteBar)}, l...))
		}
	}
	return out
}

func renderList(b mdBlock, width int) []Line {
	var out []Line
	for _, item := range b.items {
		marker, text, markerStyle := item.marker, item.text, styleMDMarker
		if strings.HasPrefix(text, "[ ] ") {
			marker, text = "☐ ", text[4:]
		} else if strings.HasPrefix(text, "[x] ") || strings.HasPrefix(text, "[X] ") {
			marker, text, markerStyle = "☑ ", text[4:], styleMDMarker.Foreground(colOk)
		}
		indent := strings.Repeat("  ", item.level)
		markerW := lipgloss.Width(marker)
		avail := width - lipgloss.Width(indent) - markerW
		if avail < 1 {
			avail = 1
		}
		lines := inlineWrap(text, avail, styleText)
		if len(lines) == 0 {
			lines = []Line{nil}
		}
		for i, l := range lines {
			if i == 0 {
				out = append(out, append(Line{
					Plain(indent),
					Styled(marker, markerStyle),
				}, l...))
				continue
			}
			// 悬挂缩进：续行左边界对齐到正文，而不是对齐到标记
			out = append(out, append(Line{
				Plain(indent + strings.Repeat(" ", markerW)),
			}, l...))
		}
	}
	return out
}

func renderTable(b mdBlock, width int) []Line {
	cols := 0
	for _, r := range b.rows {
		if len(r) > cols {
			cols = len(r)
		}
	}
	if cols == 0 {
		return nil
	}
	widths := make([]int, cols)
	for _, r := range b.rows {
		for i, cell := range r {
			if x := lineWidth(parseInline(cell, styleText)); x > widths[i] {
				widths[i] = x
			}
		}
	}
	const sep = " │ "
	total := lipgloss.Width(sep) * (cols - 1)
	for _, w := range widths {
		total += w
	}

	// 放不下就降级成「表头 值」的列表——折行会把表格彻底毁掉，那更糟。
	if total > width {
		var out []Line
		for ri, r := range b.rows {
			if ri == 0 {
				continue // 表头已经在每行的键里体现
			}
			parts := make([]string, 0, len(r))
			for i, cell := range r {
				key := ""
				if i < len(b.rows[0]) {
					key = b.rows[0][i]
				}
				parts = append(parts, strings.TrimSpace(key+" "+cell))
			}
			out = append(out, inlineWrap(strings.Join(parts, "  "), width, styleText)...)
		}
		return out
	}

	var out []Line
	for ri, r := range b.rows {
		line := make(Line, 0, cols*2)
		for i := 0; i < cols; i++ {
			cell := ""
			if i < len(r) {
				cell = r[i]
			}
			st := styleText
			if ri == 0 {
				st = styleMDBold
			}
			pad := ""
			if i < cols-1 {
				pad = strings.Repeat(" ", widths[i]-lineWidth(parseInline(cell, st)))
			}
			line = append(line, parseInline(cell, st)...)
			line = append(line, Plain(pad))
			if i < cols-1 {
				line = append(line, Styled(sep, styleMDTableBar))
			}
		}
		out = append(out, line)
		if ri == 0 {
			rule := make(Line, 0, cols*2)
			for i := 0; i < cols; i++ {
				rule = append(rule, Styled(strings.Repeat("─", widths[i]), styleMDRule))
				if i < cols-1 {
					rule = append(rule, Styled("─┼─", styleMDTableBar))
				}
			}
			out = append(out, rule)
		}
	}
	return out
}

// renderBlock 渲染一个块，并保证**每一行都不超过 width**。
//
// 收口放在这里、而不是各个渲染函数里：边槽、缩进、列表标记本身就可能吃掉
// 大部分宽度——fuzz 抓到过 width=8 时列表项渲染出 10 列（标记占 2 列，
// 而渲染函数把"可用宽度"的下限往上钳到了 8，于是反过来超过了总宽）。
// 指望每个渲染函数各自"保证不超宽"是靠不住的，统一裁一次才是结构性保证。
func renderBlock(b mdBlock, width int) []Line {
	return clampLines(renderBlockRaw(b, width), width)
}

// renderBlockRaw 是各块真正的渲染实现，不负责宽度收口。
func renderBlockRaw(b mdBlock, width int) []Line {
	switch b.kind {
	case mdCode:
		return renderCodeBlock(b, width)
	case mdRule:
		n := width
		if n > 24 {
			n = 24
		}
		return []Line{{Styled(strings.Repeat("─", n), styleMDRule)}}
	case mdHeading:
		lines := inlineWrap(b.text, width-2, styleMDHeading)
		for i := range lines {
			lines[i] = append(Line{Styled("▌ ", styleMDHeading)}, lines[i]...)
		}
		return lines
	case mdQuote:
		return renderQuote(b, width)
	case mdList:
		return renderList(b, width)
	case mdTable:
		return renderTable(b, width)
	default:
		// 动作行（*动作*）是人格层的一等构造，单独给样式并缩进。
		// 依据 Prompt/自我.txt 第 20 行：动作单独成排，与言语分开。
		if body, ok := isActionLine(b.text); ok {
			lines := wrapStyled(body, width-2, styleMDAction)
			for i := range lines {
				lines[i] = append(Line{Plain("  ")}, lines[i]...)
			}
			return lines
		}
		return inlineWrap(b.text, width, styleText)
	}
}

// —— 块渲染缓存 ——
//
// 流式时每一帧只有**最后一个块**在变，它前面所有块的渲染结果都可以复用。
//
// 实测（5.6KB 正文，`BenchmarkMarkdownPhaseSplit`）：
//
//	解析  27 µs
//	渲染  2.24 ms   ← 98% 在这里（uniseg 逐字素簇切分 + 折行）
//
// 所以缓存"块 → 行"能把每帧成本从 2.7ms 压到几十微秒；不缓存的话，
// 一个几万字的回答每帧要花十几毫秒，直接在 50ms 的渲染节拍里啃掉一大块。
//
// 只增不减的地图会漏内存，所以超过上限就整个丢掉重建——
// 块的内容本来就随对话变化，重建代价可以接受。
const blockCacheMax = 512

var (
	blockCacheMu sync.Mutex
	blockCache   = map[string][]Line{}
)

// blockKey 生成块的缓存键：同键的块渲染结果必然相同。
//
// 每个字段都按「长度:值」写，**不能只靠分隔符拼接**——
// 块内容里一旦出现那个分隔符，两个不同的块就会算出同一个键，
// 于是后一个块会被渲染成前一个块的样子。撞键是静默的错渲染，最难查。
func blockKey(b mdBlock, width int) string {
	var sb strings.Builder
	writeKV(&sb, strconv.Itoa(width))
	writeKV(&sb, strconv.Itoa(int(b.kind)))
	writeKV(&sb, strconv.Itoa(b.level))
	writeKV(&sb, b.info)
	writeKV(&sb, b.text)
	for _, l := range b.lines {
		writeKV(&sb, l)
	}
	for _, it := range b.items {
		writeKV(&sb, strconv.Itoa(it.level))
		writeKV(&sb, it.marker)
		writeKV(&sb, it.text)
	}
	for _, row := range b.rows {
		for _, cell := range row {
			writeKV(&sb, cell)
		}
		writeKV(&sb, "\x00") // 行结束标记，避免行与行的拼接产生歧义
	}
	writeKV(&sb, strconv.FormatBool(b.closed))
	return sb.String()
}

// writeKV 以「长度:值」写一个字段，保证拼接结果可唯一还原。
func writeKV(sb *strings.Builder, s string) {
	sb.WriteString(strconv.Itoa(len(s)))
	sb.WriteByte(':')
	sb.WriteString(s)
}

// renderBlockCached 走缓存渲染一个块。
//
// 返回的切片是共享的，**调用方只读**。
func renderBlockCached(b mdBlock, width int) []Line {
	key := blockKey(b, width)

	blockCacheMu.Lock()
	if hit, ok := blockCache[key]; ok {
		blockCacheMu.Unlock()
		return hit
	}
	blockCacheMu.Unlock()

	lines := renderBlock(b, width)

	blockCacheMu.Lock()
	if len(blockCache) >= blockCacheMax {
		blockCache = map[string][]Line{}
	}
	blockCache[key] = lines
	blockCacheMu.Unlock()
	return lines
}

// RenderMarkdown 一次性把 Markdown 文本排版成行。
//
// 块之间统一留一个空行：这既制造了段间距，又把模型输出的连续空行归一化成 1。
func RenderMarkdown(text string, width int) []Line {
	lines, _ := RenderMarkdownStable(text, width)
	return lines
}

// RenderMarkdownStable 额外返回「现在就可以打印进回滚区」的前缀行数。
//
// 回滚区里的内容不可撤回，所以这个数字是**硬约束**：调用方只许打印这么多行。
// 它比"整块是否定稿"更细——未定稿的块内部，前缀其实也是稳定的（见 blockHoldback）。
func RenderMarkdownStable(text string, width int) ([]Line, int) {
	return renderMarkdownStable(text, width, false)
}

// RenderMarkdownCompactStable preserves source paragraph breaks and structural
// block spacing, while consecutive ordinary source lines stay single-spaced.
// The returned stable prefix uses this compact layout's own row coordinates.
func RenderMarkdownCompactStable(text string, width int) ([]Line, int) {
	return renderMarkdownStable(text, width, true)
}

func renderMarkdownStable(text string, width int, compact bool) ([]Line, int) {
	if width < 1 {
		width = 1
	}
	// 渲染层是**通往终端的最后一道门**，所以在这里再兜一次底：
	// 内容里的 ESC / 控制字符绝不能被排进版面——终端会照做。
	// 干净的文本这一步不分配（见 needsStrip）。
	text = stripControl(text)
	blocks := parseMarkdown(text)
	last := len(blocks) - 1
	// 文本没有以换行结束，说明最后一个源行还在增长。此时连「它是普通段落还是
	// 标题」都还没定——"#" 下一字节就会变成 "# 标题"。
	complete := strings.HasSuffix(text, "\n")

	// 更隐蔽的一层：**正在增长的块会反过来改写前一个块的角色**。
	// 表格的表头就是例子——分隔行只到一半时，表头看上只是一段含竖线的普通文字；
	// 分隔行补齐后，前一行才变成表头。所以未完成时末两块都不许定稿。
	sealed := func(bi int, b mdBlock) bool {
		if bi == last {
			return complete && blockSealed(b)
		}
		if !complete && bi == last-1 {
			return false
		}
		return true
	}

	var out []Line
	printable := 0
	// held 一旦为真，后面所有块都不能打印。
	// 可打印区必须是**连续前缀**：否则一个只扣住末尾 1 行的块，会把前面整块
	// 被扣住的行"顶"进可打印区——这正是实测抓到的那个改写。
	held := false
	for bi, b := range blocks {
		if bi > 0 && !(compact && b.kind == mdPara && blocks[bi-1].kind == mdPara && !b.sourceGap) {
			out = append(out, nil) // 块间空行，也是可打印前缀的一部分
		}
		start := len(out)
		out = append(out, renderBlockCached(b, width)...)
		blockLines := len(out) - start

		hold := 0
		switch {
		case sealed(bi, b):
			hold = 0
		case !complete && bi == last-1:
			// 下一个块还在增长，它可能**整块改写这个块的角色**（表格表头），
			// 所以这里不能用块内回溯，必须整块扣住。
			hold = holdAll
		default:
			hold = blockHoldback(b)
		}
		if hold > blockLines {
			hold = blockLines
		}

		if held {
			continue
		}
		if hold == 0 {
			printable = len(out)
			continue
		}
		printable = len(out) - hold
		held = true
	}
	return out, printable
}

// holdAll 表示"整块都可能变，一行都不要打印"。
const holdAll = 1 << 30

// blockHoldback 返回一个**尚未定稿**的块末尾必须扣住多少行。
//
// 关键在于：贪婪折行下块内**前缀是稳定的**——追加内容只会影响末尾。
// 所以未定稿不等于整块不能打印，只是末尾要留一段缓冲。
// 不这样细化，一个没有换行的长段落会把活动区撑到几十行，终端跟着不停滚动。
func blockHoldback(b mdBlock) int {
	switch b.kind {
	case mdTable:
		// 表格的列宽依赖**全部行**，一行新数据就会改写上面所有行 → 整块扣住
		return holdAll
	case mdPara:
		// 段落：禁则回拉可能改写最后两次断行
		return 2
	default:
		// 代码 / 列表 / 引用：追加只发生在末尾，扣最后一行足够
		return 1
	}
}

// blockSealed 判断最后一个块是否已经不可能再吸收后续行。
//
// 这不是保守起见——列表、引用、表格都会把同类的下一行并进**同一个块**，
// 而表格的列宽依赖全部行。若提前定稿，后到的行会改变已经印出去的内容。
// 段落 / 标题 / 分隔线本身就是单行块，代码块则要看围栏是否闭合。
func blockSealed(b mdBlock) bool {
	switch b.kind {
	case mdPara:
		// 表格的表头行要先看到**下一行**（|---|---| 分隔行）才能定性。在此之前
		// 它看起来只是一段含竖线的普通文字——定稿了就会在分隔行到达时被改写。
		return !looksLikeTableRow(b.text)
	case mdHeading, mdRule:
		return true
	case mdCode:
		return b.closed
	default:
		return false
	}
}

// Inline 和 Math 供旧界面的兼容测试复用同一实现。
func Inline(s string, base lipgloss.Style) []Span { return parseInline(s, base) }
func Math(s string) string                        { return convertMath(s) }

func ActionLine(s string) (string, bool)                       { return isActionLine(s) }
func WrapStyled(s string, width int, st lipgloss.Style) []Line { return wrapStyled(s, width, st) }
