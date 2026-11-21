// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: start; accountResize; historyRows; pushHistory; flushHistory; finishHistory
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/screen_history.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"github.com/charmbracelet/x/ansi"
	"strings"
)

// Reserve a live area on the main screen using ordinary newlines. Previous
// shell output survives above it, and the terminal owns the scrollbar/selection.
func (s *screen) start() {
	if s.started {
		return
	}
	s.started = true
	s.write("\x1b[?2004h" + strings.Repeat("\r\n", max(1, s.model.height)))
	s.rememberLiveTop()
}

// A host can reflow/shrink its primary screen before delivering the resize
// event. Those stable rows are already in scrollback. Account for them rather
// than committing them a second time; finish a partially pushed physical row.
func (s *screen) accountResize() []string {
	c := s.model
	if s.width == 0 || s.width == c.width && s.height == c.height {
		return nil
	}
	var reflow [][]string
	total := 0
	for _, line := range s.lastRows {
		parts := strings.Split(ansi.Hardwrap(line, max(1, c.width), true), "\n")
		reflow = append(reflow, parts)
		total += len(parts)
	}
	spill := max(0, total-c.height)
	var tail []string
	for i, parts := range reflow {
		if spill <= 0 {
			break
		}
		n := min(spill, len(parts))
		spill -= n
		if i >= len(s.liveRows) {
			continue
		}
		row := s.liveRows[i]
		if row.line < 0 {
			continue
		}
		for j := range c.flow.entries {
			e := &c.flow.entries[j]
			if e.key != row.key || e.kind != "body" && e.kind != "user" || row.line < e.committed {
				continue
			}
			if row.part != row.parts-1 {
				continue
			}
			if e.nativeWidth == 0 {
				e.nativeWidth = max(1, s.width-2)
			}
			e.nativeGap = true
			e.committed = row.line + 1
			tail = append(tail, parts[n:]...)
		}
	}
	return tail
}

// Only stable conversation rows are committed. Transient thinking, tool
// previews, status, menus and composer frames never enter native scrollback.
func (s *screen) historyRows(all bool) []string {
	c := s.model
	f := &c.flow
	if !all && (f.inspect != "" || c.api != nil || c.pinned != nil || c.planExpanded || len(c.menuItems()) > 0) {
		return nil
	}
	limit := len(f.rows)
	if !all {
		limit = min(limit, max(0, len(f.rows)-f.room))
	}
	var rows []string
	for i := range f.entries {
		e := &f.entries[i]
		if e.kind == "process" || e.text == "" && e.kind != "tool" {
			continue
		}
		if e.kind == "tool" {
			if len(e.tools) == 0 || !all && activityRunning(e.tools[0].State) {
				break
			}
		}
		lines := e.displayRows(max(1, c.width-2))
		if e.kind == "tool" {
			lines = []string{toolBriefRow(e.tools[0], "◈")}
		}
		n := len(lines)
		if !all {
			n = e.committed
			for _, row := range f.rows[:limit] {
				if row.key == e.key && row.line >= 0 && row.part == row.parts-1 {
					n = max(n, row.line+1)
				}
			}
			// Keep the streaming tail editable for wrapping/Markdown changes.
			if e.key == f.bodyKey(c.liveID) && c.snapshot.Busy {
				n = min(n, e.wrap.stable, max(0, len(lines)-3))
			}
		}
		if n <= e.committed {
			if e.committed < len(lines) {
				break
			}
			continue
		}
		if e.nativeWidth == 0 {
			e.nativeWidth = max(1, c.width-2)
		}
		if !e.nativeGap && e.kind != "tool" {
			rows = append(rows, "")
			e.nativeGap = true
		}
		for _, line := range lines[e.committed:min(n, len(lines))] {
			rows = append(rows, strings.Split(ansi.Hardwrap(line, max(1, c.width), true), "\n")...)
		}
		e.committed = min(n, len(lines))
		if e.committed < len(lines) {
			break
		}
	}
	return rows
}

// Replace the top k rows with the semantic rows before pushing them out of the
// viewport. This prevents old animation frames and input drafts being archived.
func (s *screen) pushHistory(b *strings.Builder, rows []string) {
	h := max(1, s.model.height)
	for len(rows) > 0 {
		n := min(h, len(rows))
		for i, row := range rows[:n] {
			b.WriteString(ansi.CursorPosition(1, i+1) + ansi.EraseEntireLine + cut(row, s.model.width))
		}
		b.WriteString(ansi.CursorPosition(1, h) + strings.Repeat("\r\n", n))
		rows = rows[n:]
	}
}

func (s *screen) flushHistory() {
	if !s.started || s.err != nil {
		return
	}
	// The session can close while a body is still waiting for its visual dwell.
	s.model.retainFlowBody()
	s.model.flowRows(max(1, s.model.height-5))
	// flowRows indexes the currently animated text. Restore the full pending
	// body after indexing, before committing the final/switch boundary.
	s.model.retainFlowBody()
	s.returnToLive()
	var b strings.Builder
	b.WriteString("\x1b[?2026h\x1b[?25l\x1b[?7l")
	s.pushHistory(&b, s.historyRows(true))
	for i := 0; i < s.model.height; i++ {
		b.WriteString(ansi.CursorPosition(1, i+1) + ansi.EraseEntireLine)
	}
	b.WriteString(ansi.CursorPosition(1, 1))
	s.write(b.String())
	s.rememberLiveTop()
	s.reset = true
}

func (s *screen) finishHistory() { s.flushHistory() }
