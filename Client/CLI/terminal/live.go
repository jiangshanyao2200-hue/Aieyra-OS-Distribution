// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: markdownRenderer; markdown; boundedText; wrapCache; wrap; clearLive; advanceText; animate
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/live.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"github.com/aieyra/aieyra-os/client/CLI/mdrender"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	"github.com/muesli/termenv"
	"github.com/rivo/uniseg"
	"io"
	"strings"
	"time"
)

// Run already requires an interactive VT terminal; the rest of this renderer
// uses the same 256-color palette. Inherited stdout can be a pipe even when our
// actual output is CONOUT$, so never use its cached global color detection.
var markdownRenderer = func() *lipgloss.Renderer {
	r := lipgloss.NewRenderer(io.Discard)
	r.SetColorProfile(termenv.ANSI256)
	return r
}()

func (w *wrapCache) markdown(text string, width int) []string {
	if w.text == text && w.width == width {
		return w.rows
	}
	w.text, w.width, w.rows, w.stable = text, width, nil, 0
	if text != "" {
		lines, stable := mdrender.RenderMarkdownCompactStable(text, max(1, width))
		w.stable = stable
		for _, line := range lines {
			w.rows = append(w.rows, mdrender.RenderLineWithRenderer(line, markdownRenderer))
		}
	}
	return w.rows
}

// 显示仅保留当前尾部；核心正文和持久记录不受显示预算影响。
func boundedText(s string) string {
	s = safeText(s)
	const limit = 48 << 10
	if len(s) > limit {
		threshold := len(s) - limit
		start := len(s)
		g := uniseg.NewGraphemes(s)
		for g.Next() {
			left, _ := g.Positions()
			if left >= threshold {
				start = left
				break
			}
		}
		s = "…\n" + s[start:]
	}
	return s
}

type wrapCache struct {
	text   string
	width  int
	rows   []string
	stable int
}

func (w *wrapCache) wrap(text string, width int) []string {
	if w.text == text && w.width == width {
		return w.rows
	}
	w.text, w.width = text, width
	w.rows = nil
	if text != "" {
		w.rows = strings.Split(ansi.Hardwrap(strings.ReplaceAll(text, "\t", "    "), max(1, width), true), "\n")
	}
	return w.rows
}
func (c *model) clearLive() {
	c.liveID = ""
	c.liveText = ""
	c.liveThought = ""
	c.shownText = ""
	c.shownThought = ""
	c.activities = nil
	c.inputPreviews = nil
	c.bodyWrap = wrapCache{}
	c.thoughtWrap = wrapCache{}
	c.thoughtLine = thoughtRibbon{}
	c.pendingBodies = nil
	c.bodyVisible, c.bodyVisibleFor = false, 0
}
func advanceText(shown, target string, dt time.Duration) string {
	if shown == target {
		return shown
	}
	if !strings.HasPrefix(target, shown) {
		shown = ""
	}
	remaining := target[len(shown):]
	// 大块最多保留 4KiB 动画尾部，逐帧只沿字素边界前进。
	budget := max(2, int(float64(len(remaining))*min(1, dt.Seconds()/0.10)))
	if len(remaining) > 4096 {
		budget = max(budget, len(remaining)-4096)
	}
	g := uniseg.NewGraphemes(remaining)
	end := 0
	for g.Next() {
		_, end = g.Positions()
		if end >= budget {
			break
		}
	}
	return target[:len(shown)+end]
}
func (c *model) animate() {
	now := time.Now()
	dt := now.Sub(c.lastPulse)
	c.lastPulse = now
	if dt > 100*time.Millisecond {
		dt = 40 * time.Millisecond
	}
	c.animateActivities(now, dt)
	c.animatePresentation(dt)
}
