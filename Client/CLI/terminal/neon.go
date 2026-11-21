// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: neon; composerDivider; toolBriefRow
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/neon.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"github.com/charmbracelet/x/ansi"
	"strings"
)

func neon(color, text string) string { return "\x1b[38;5;" + color + "m" + text + "\x1b[0m" }

// The scan moves in color only, keeping the composer and caret stationary.
func (c *model) composerDivider() string {
	label := ""
	if c.flow.reading {
		label = " 正在回看 · Ctrl+End 最新 "
	}
	w := max(0, c.width-ansi.StringWidth(label))
	pos := 0
	if w > 0 {
		pos = (c.frame / 2) % w
	}
	var b strings.Builder
	b.WriteString(neon("141", label))
	for i := 0; i < w; i++ {
		color := "60"
		if c.snapshot.Busy || c.opPending {
			if i == pos {
				color = "201"
			} else if i == pos-1 || i == pos+1 {
				color = "51"
			}
		} else if i < 2 || i >= w-2 {
			color = "141"
		}
		b.WriteString(neon(color, "─"))
	}
	return b.String()
}

func toolBriefRow(a activity, pulse string) string {
	icon, state := activityState(a.State)
	color := "118"
	if activityRunning(a.State) {
		icon, color = pulse, "51"
	}
	if a.State == "failed" || a.State == "error" || a.State == "timed_out" || a.State == "interrupted_unknown" {
		color = "203"
	}
	if a.State == "cancelled" || a.State == "canceled" || a.State == "skipped" {
		color = "141"
	}
	line := icon + " " + activityBrief(a)
	// Never imply success for a failed, pending or interrupted call.
	if color == "203" || color == "141" || activityRunning(a.State) {
		line += " · " + state
	}
	return neon(color, line)
}
