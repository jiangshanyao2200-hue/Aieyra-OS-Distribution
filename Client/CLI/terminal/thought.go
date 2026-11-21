// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: thoughtRibbon; normalizeThought; ready; advance; render
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/thought.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"math"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/rivo/uniseg"
)

// 单行阅读窗按字素前进；积压越长越快，正文到达后有界追赶到实际尾部。
type thoughtRibbon struct {
	text               string
	glyphs             []string
	widths             []int
	index, width, tail int
	travel             float64
	headFor, tailFor   time.Duration
	visible, end       bool
}

func normalizeThought(text string) string {
	return strings.Join(strings.Fields(text), " ")
}

func (r *thoughtRibbon) ready() bool {
	return r.text != "" && r.end && r.tailFor >= 240*time.Millisecond
}

func (r *thoughtRibbon) advance(dt time.Duration, catchup, loop bool) {
	if !r.visible || r.width <= 0 || dt <= 0 {
		return
	}
	if r.end {
		r.tailFor += dt
		if loop && r.tail > 0 && r.tailFor >= time.Second {
			r.index, r.travel, r.headFor, r.tailFor, r.end = 0, 0, 0, 0, false
		}
		return
	}
	r.headFor += dt
	if r.index == 0 && r.headFor < 120*time.Millisecond {
		return
	}
	rate := math.Max(12, float64(r.tail-r.index)/0.7)
	if catchup {
		rate = math.Max(rate, float64(r.tail)/0.65)
	}
	r.travel += rate * dt.Seconds()
	step := int(r.travel)
	r.travel -= float64(step)
	r.index = min(r.tail, r.index+step)
}

func (r *thoughtRibbon) render(text string, width int) string {
	text = normalizeThought(text)
	if text != r.text {
		if !strings.HasPrefix(text, r.text) {
			// 核心只保留思考的近期后缀；保留重叠字素的阅读位置。
			offset, retained := 0, false
			for i := 1; i < len(r.glyphs); i++ {
				offset += len(r.glyphs[i-1])
				if strings.HasPrefix(text, r.text[offset:]) {
					r.index = max(0, r.index-i)
					retained = true
					break
				}
			}
			if !retained {
				r.index, r.travel, r.headFor = 0, 0, 0
			}
		}
		r.tailFor, r.end = 0, false
		r.text, r.glyphs, r.widths = text, nil, nil
		g := uniseg.NewGraphemes(text)
		for g.Next() {
			s := g.Str()
			r.glyphs = append(r.glyphs, s)
			r.widths = append(r.widths, lipgloss.Width(s))
		}
	}
	r.width, r.visible = width, width > 0
	if width <= 0 || len(r.glyphs) == 0 {
		return ""
	}
	used := 0
	r.tail = len(r.glyphs)
	for r.tail > 0 && used+r.widths[r.tail-1] <= width {
		r.tail--
		used += r.widths[r.tail]
	}
	r.index = min(r.index, r.tail)
	var out strings.Builder
	used, end := 0, r.index
	for end < len(r.glyphs) && used+r.widths[end] <= width {
		out.WriteString(r.glyphs[end])
		used += r.widths[end]
		end++
	}
	r.end = end == len(r.glyphs)
	if !r.end {
		r.tailFor = 0
	}
	return out.String()
}
