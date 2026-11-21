// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: vterm; newVTerm; Write; skipEscape; doCSI; atoiCSI; clampCursor; put; newline; rowString; rowContent; snapshot; scrollbackText; resize; rewrapRunes
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/vterm_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"github.com/charmbracelet/lipgloss"
	"strings"
	"sync"
	"unicode/utf8"
)

// Reused native-byte renderer oracle from the original terminal.
type vterm struct {
	mu   sync.Mutex
	w, h int

	cells  [][]rune // h 行 x w 列；0 表示从未写过（空单元）
	filled [][]bool // 对应格子是否被写过：空格字符与空单元必须区分，
	// 否则重排时 padding 空格会被当成内容拼回去（真机 buffer 天然区分两者）。
	wrap []bool // wrap[i] 为 true 表示第 i 行是上一行的自动折行延续

	row, col           int
	savedRow, savedCol int
	scrollback         []string
	archiveOnErase     bool // Windows Terminal 的 ED2 保留旧屏幕到回滚区
	alternate          bool
	normal             *vterm
}

func newVTerm(w, h int) *vterm {
	if w < 1 {
		w = 1
	}
	if h < 1 {
		h = 1
	}
	v := &vterm{w: w, h: h}
	v.cells = make([][]rune, h)
	v.filled = make([][]bool, h)
	for i := range v.cells {
		v.cells[i] = make([]rune, w)
		v.filled[i] = make([]bool, w)
	}
	v.wrap = make([]bool, h)
	return v
}

// Write 实现 io.Writer，会被 viewportWriter 包一层再交给 tea.Program。
func (v *vterm) Write(p []byte) (int, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	s := string(p)
	for len(s) > 0 {
		if s[0] == '\x1b' {
			s = v.skipEscape(s)
			continue
		}
		r, size := utf8.DecodeRuneInString(s)
		s = s[size:]
		switch r {
		case '\r':
			v.col = 0
		case '\n':
			v.newline(false)
		case '\t':
			v.col += 8 - v.col%8
			if v.col > v.w {
				v.col = v.w
			}
		default:
			v.put(r)
		}
	}
	return len(p), nil
}

// skipEscape 跳过一条转义序列，返回剩余部分。
func (v *vterm) skipEscape(s string) string {
	if len(s) < 2 {
		return ""
	}
	switch s[1] {
	case '[':
		// CSI：参数字节 0x30–0x3F，终结字节 0x40–0x7E。
		i := 2
		for i < len(s) && (s[i] < 0x40 || s[i] > 0x7E) {
			i++
		}
		if i >= len(s) {
			return ""
		}
		v.doCSI(s[2:i], s[i])
		return s[i+1:]
	case ']':
		// OSC：BEL 或 ESC\ 终结（SetWindowTitle 走这里）。
		for i := 2; i < len(s); i++ {
			if s[i] == 0x07 {
				return s[i+1:]
			}
			if s[i] == '\x1b' && i+1 < len(s) && s[i+1] == '\\' {
				return s[i+2:]
			}
		}
		return ""
	case '7':
		v.savedRow, v.savedCol = v.row, v.col
		return s[2:]
	case '8':
		v.row, v.col = v.savedRow, v.savedCol
		v.clampCursor()
		return s[2:]
	default:
		// 单字符转义（charset 选择之类），跳过 ESC + 1 个普通字符；
		// 若后面还跟参数则按 CSI 重新解析，避免把半截 CSI 当普通转义吞掉。
		if len(s) > 2 && s[2] == '[' {
			return v.skipEscape(s[1:])
		}
		return s[2:]
	}
}

// doCSI 执行本程序会用到的 CSI 子集。
func (v *vterm) doCSI(params string, final byte) {
	if (final == 'h' || final == 'l') && params == "?1049" {
		if final == 'h' && !v.alternate {
			v.normal = &vterm{w: v.w, h: v.h, cells: v.cells, filled: v.filled, wrap: v.wrap, row: v.row, col: v.col, savedRow: v.savedRow, savedCol: v.savedCol, scrollback: v.scrollback}
			blank := newVTerm(v.w, v.h)
			v.cells, v.filled, v.wrap = blank.cells, blank.filled, blank.wrap
			v.row, v.col, v.savedRow, v.savedCol = 0, 0, 0, 0
			v.scrollback = nil
			v.alternate = true
		} else if final == 'l' && v.alternate {
			n := v.normal
			if n.w != v.w || n.h != v.h {
				n.resize(v.w, v.h)
			}
			v.cells, v.filled, v.wrap = n.cells, n.filled, n.wrap
			v.row, v.col, v.savedRow, v.savedCol = n.row, n.col, n.savedRow, n.savedCol
			v.scrollback = n.scrollback
			v.normal, v.alternate = nil, false
		}
		return
	}
	n := 1
	if params != "" {
		n = 0
		for _, part := range strings.Split(params, ";") {
			part = strings.TrimLeft(part, "?")
			if part == "" {
				continue
			}
			var x int
			for _, ch := range part {
				if ch < '0' || ch > '9' {
					x = -1
					break
				}
				x = x*10 + int(ch-'0')
			}
			if x >= 0 {
				n = x
			}
		}
		if n == 0 && (final == 'A' || final == 'B' || final == 'C' || final == 'D') {
			n = 1
		}
	}
	row2, col2 := v.row, v.col
	switch final {
	case 'A':
		row2 = v.row - n
	case 'B':
		row2 = v.row + n
	case 'C':
		col2 = v.col + n
	case 'D':
		col2 = v.col - n
	case 'H', 'f':
		// CUP：参数是 行;列（1 起）。
		r, c := 1, 1
		parts := strings.Split(params, ";")
		if len(parts) > 0 && parts[0] != "" {
			r = atoiCSI(parts[0])
		}
		if len(parts) > 1 && parts[1] != "" {
			c = atoiCSI(parts[1])
		}
		row2, col2 = r-1, c-1
	case 'X':
		// ConPTY 将连续空白优化为 ECH；擦除后光标不移动。
		for c := v.col; c < min(v.w, v.col+max(1, n)); c++ {
			v.cells[v.row][c] = 0
			v.filled[v.row][c] = false
		}
		return
	case 'K':
		start, end := v.col, v.w
		mode := 0
		if params != "" {
			mode = atoiCSI(params)
		}
		if mode == 1 {
			start, end = 0, v.col+1
		} else if mode == 2 {
			start = 0
		}
		for c := start; c < end; c++ {
			v.cells[v.row][c] = 0
			v.filled[v.row][c] = false
		}
		return
	case 'J':
		if n == 3 {
			v.scrollback = nil
			return
		}
		if n == 2 {
			if v.archiveOnErase && !v.alternate {
				last := -1
				for r := range v.cells {
					if strings.TrimSpace(v.rowString(r, true)) != "" {
						last = r
					}
				}
				for r := 0; r <= last; r++ {
					v.scrollback = append(v.scrollback, v.rowString(r, true))
				}
			}
			for r := range v.cells {
				clear(v.cells[r])
				clear(v.filled[r])
				v.wrap[r] = false
			}
			return
		}
		// ED0：清到屏尾。
		for c := v.col; c < v.w; c++ {
			v.cells[v.row][c] = 0
			v.filled[v.row][c] = false
		}
		for r := v.row + 1; r < v.h; r++ {
			for c := range v.cells[r] {
				v.cells[r][c] = 0
				v.filled[r][c] = false
			}
			v.wrap[r] = false
		}
		return
	default:
		// SGR、鼠标开关、私有模式等一律忽略（不占格子）。
		return
	}
	v.row, v.col = row2, col2
	v.clampCursor()
}

func atoiCSI(s string) int {
	n := 0
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return 1
		}
		n = n*10 + int(ch-'0')
	}
	if n < 1 {
		return 1
	}
	return n
}

func (v *vterm) clampCursor() {
	if v.row < 0 {
		v.row = 0
	}
	if v.row >= v.h {
		v.row = v.h - 1
	}
	if v.col < 0 {
		v.col = 0
	}
	if v.col >= v.w {
		v.col = v.w - 1
	}
}

// put 写一个可打印字符，超宽自动折行（DECAWM 开）。
func (v *vterm) put(r rune) {
	w := lipgloss.Width(string(r))
	if w < 1 {
		return
	}
	if v.col+w > v.w {
		v.newline(true)
	}
	if v.col+w > v.w {
		// 窗口比一个字还窄：硬写，超出部分丢弃（极端尺寸不断言这里）。
		w = v.w - v.col
		if w <= 0 {
			return
		}
	}
	v.cells[v.row][v.col] = r
	for i := 1; i < w; i++ {
		v.cells[v.row][v.col+i] = 0
		v.filled[v.row][v.col+i] = true
	}
	v.filled[v.row][v.col] = true
	v.col += w
}

// newline 换行；到底时滚屏（顶行进回滚区）。
func (v *vterm) newline(wrapped bool) {
	if v.row == v.h-1 {
		if !v.alternate {
			v.scrollback = append(v.scrollback, v.rowString(0, true))
		}
		copy(v.cells, v.cells[1:])
		copy(v.filled, v.filled[1:])
		v.cells[v.h-1] = make([]rune, v.w)
		v.filled[v.h-1] = make([]bool, v.w)
		copy(v.wrap, v.wrap[1:])
		v.wrap[v.h-1] = wrapped
		v.col = 0
		return
	}
	v.row++
	v.col = 0
	v.wrap[v.row] = wrapped
}

// rowString 取一行的可见文本；rstrip 为 true 时去尾空格。
//
// 未写过的格子显示为空格（Tab 跳过的空隙、行尾空白看起来都是空格），
// 但重排/滚动等"读内容"的路径必须走 filled 区分——
// rowString 只负责"看起来"，不负责"内容是什么"。
func (v *vterm) rowString(r int, rstrip bool) string {
	var b strings.Builder
	for c := range v.cells[r] {
		ch := v.cells[r][c]
		if ch == 0 && !v.filled[r][c] {
			b.WriteRune(' ')
			continue
		}
		if ch == 0 {
			continue // 宽字符第二格占位
		}
		b.WriteRune(ch)
	}
	if rstrip {
		return strings.TrimRight(b.String(), " \t")
	}
	return b.String()
}

// rowContent 取一行的真实内容：只有被写过的格子才算数。
// 重排拼行、滚动进回滚区都走这里——padding 空格进不来。
func (v *vterm) rowContent(r int) string {
	var b strings.Builder
	for c := range v.cells[r] {
		if !v.filled[r][c] {
			continue
		}
		if ch := v.cells[r][c]; ch != 0 {
			b.WriteRune(ch)
		}
	}
	return b.String()
}

// snapshot 快照可见区（每行去尾空格）。
func (v *vterm) snapshot() []string {
	v.mu.Lock()
	defer v.mu.Unlock()
	out := make([]string, v.h)
	for i := range out {
		out[i] = v.rowString(i, true)
	}
	return out
}

// scrollbackText 快照回滚区全文。
func (v *vterm) scrollbackText() string {
	v.mu.Lock()
	defer v.mu.Unlock()
	return strings.Join(v.scrollback, "\n")
}

// resize 变尺寸并重排已有行（Windows Terminal 行为：双向重排）。
//
// 折行延续的行拼回逻辑行再重折；行数超过新高度时，顶部进回滚区。
// 光标按"内容末尾"恢复——我们的流程里光标本就在块末尾，
// 重排后它还在块末尾；且 writer 下一帧会绝对重建一切，
// 这里只要保证 erase 的起点（块末）正确。
func (v *vterm) resize(nw, nh int) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if nw < 1 {
		nw = 1
	}
	if nh < 1 {
		nh = 1
	}
	// 1) 拼回逻辑行：只拼被写过的格子（rowContent）。
	//    padding 空格、Tab 空隙、被擦掉的尾巴都进不来——真机 buffer 天然如此。
	//    输入区换行断词的行尾空格是真内容（filled），照单全收，不会丢。
	var logical []string
	var cur strings.Builder
	for r := 0; r < v.h; r++ {
		cur.WriteString(v.rowContent(r))
		if r+1 >= v.h || !v.wrap[r+1] {
			logical = append(logical, strings.TrimRight(cur.String(), " \t"))
			cur.Reset()
		}
	}
	if cur.Len() > 0 {
		logical = append(logical, strings.TrimRight(cur.String(), " \t"))
	}
	// 2) 按新宽度重折。
	type outRow struct {
		text    string
		wrapped bool
	}
	var rows []outRow
	for _, ln := range logical {
		parts := rewrapRunes(ln, nw)
		for i, p := range parts {
			rows = append(rows, outRow{text: p, wrapped: i > 0})
		}
		if len(parts) == 0 {
			rows = append(rows, outRow{})
		}
	}
	// 3) 超高部分进回滚区。
	if len(rows) > nh {
		if !v.alternate {
			for _, r := range rows[:len(rows)-nh] {
				v.scrollback = append(v.scrollback, strings.TrimRight(r.text, " \t"))
			}
		}
		rows = rows[len(rows)-nh:]
	}
	// 4) 落格：装不下时顶部进回滚区（已在第 3 步处理）；
	// 装得下时内容贴底——真机上视口跟着光标/底部走，
	// 不是把内容顶到顶部、底部留空。
	v.w, v.h = nw, nh
	v.cells = make([][]rune, nh)
	v.filled = make([][]bool, nh)
	v.wrap = make([]bool, nh)
	off := 0
	if len(rows) < nh {
		off = nh - len(rows)
	}
	for i := range v.cells {
		v.cells[i] = make([]rune, nw)
		v.filled[i] = make([]bool, nw)
	}
	for i, r := range rows {
		col := 0
		for _, ch := range r.text {
			w := lipgloss.Width(string(ch))
			if w < 1 || col+w > nw {
				continue
			}
			v.cells[off+i][col] = ch
			v.filled[off+i][col] = true
			for k := 1; k < w; k++ {
				v.cells[off+i][col+k] = 0
				v.filled[off+i][col+k] = true
			}
			col += w
		}
		v.wrap[off+i] = r.wrapped
	}
	// 5) 光标回内容末尾。
	v.row, v.col = nh-1, 0
	for r := nh - 1; r >= 0; r-- {
		if t := v.rowString(r, true); t != "" {
			v.row = r
			v.col = 0
			for _, ch := range t {
				v.col += lipgloss.Width(string(ch))
			}
			if v.col > nw {
				v.col = nw
			}
			break
		}
	}
}

// rewrapRunes 把一行按列宽切成多段（纯折行，不感知词）。
func rewrapRunes(s string, w int) []string {
	if s == "" {
		return nil
	}
	var out []string
	var cur strings.Builder
	col := 0
	for _, r := range s {
		rw := lipgloss.Width(string(r))
		if rw < 1 {
			continue
		}
		if col+rw > w {
			out = append(out, cur.String())
			cur.Reset()
			col = 0
		}
		cur.WriteRune(r)
		col += rw
	}
	out = append(out, cur.String())
	return out
}
