// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: draw
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/screen_draw.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"github.com/charmbracelet/x/ansi"
	"strings"
	"time"
)

// The main buffer has native history; only its live viewport is diff-painted.
func (s *screen) draw() {
	c := s.model
	if !c.ready || s.nativeBrowsing() {
		return
	}
	s.start()
	resizeHistory := s.accountResize()
	rows := strings.Split(c.View(), "\n")
	history := append(resizeHistory, s.historyRows(false)...)
	if len(rows) > c.height {
		rows = rows[len(rows)-c.height:]
	}
	for len(rows) < c.height {
		rows = append([]string{""}, rows...)
	}
	resized := s.width != c.width || s.height != c.height || s.reset
	up, right := c.caretCell()
	right = max(0, min(c.width-1, right))
	up = max(0, min(c.height-1, up))
	frame := strings.Join(rows, "\n")
	if frame != s.last || resized || len(history) > 0 || up != s.caretBelow || right != s.caretRight {
		var b strings.Builder
		b.WriteString("\x1b[?2026h\x1b[?25l\x1b[?7l")
		s.pushHistory(&b, history)
		resized = resized || len(history) > 0
		for i, line := range rows {
			if !resized && i < len(s.lastRows) && line == s.lastRows[i] {
				continue
			}
			b.WriteString(ansi.CursorPosition(1, i+1))
			b.WriteString(ansi.EraseEntireLine)
			b.WriteString(cut(line, c.width))
		}
		b.WriteString(ansi.CursorPosition(right+1, max(1, c.height-up)))
		if c.api == nil || c.api.textFocused() {
			b.WriteString(ansi.ShowCursor)
		}
		b.WriteString("\x1b[?7h\x1b[?2026l")
		s.write(b.String())
		s.rememberLiveTop()
	}
	s.last, s.width, s.height = frame, c.width, c.height
	s.caretBelow, s.caretRight = up, right
	s.lastRows = rows
	s.liveRows = nil
	if c.api == nil && c.pinned == nil && !c.planExpanded && c.flow.inspect == "" && len(c.menuItems()) == 0 {
		f := &c.flow
		s.liveRows = append(s.liveRows, f.rows[f.top:min(len(f.rows), f.top+f.room)]...)
	}
	s.pending = false
	s.reset = false
	s.drawnAt = time.Now()
}
