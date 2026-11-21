// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: apiFieldView; oneLine; encodeAPIStrings; decodeAPIStrings
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/api_field.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/x/ansi"
	"github.com/rivo/uniseg"
	"strings"
)

func apiFieldView(field textinput.Model, width int) (string, int) {
	value := field.Value()
	position := min(len([]rune(value)), field.Position())
	if field.EchoMode == textinput.EchoPassword {
		value = strings.Repeat(string(field.EchoCharacter), len([]rune(value)))
	}
	runes := []rune(value)
	// The input library uses rune positions. A terminal caret cannot safely
	// split a combined glyph, so render an interior position at its start.
	if field.EchoMode != textinput.EchoPassword {
		at := 0
		graphemes := uniseg.NewGraphemes(value)
		for graphemes.Next() {
			next := at + len([]rune(graphemes.Str()))
			if position >= at && position < next {
				position = at
				break
			}
			at = next
		}
	}
	before := string(runes[:position])
	// Position is always kept in view; rendering and IME use the same cell.
	caret := ansi.StringWidth(before)
	start := 0
	graphemes := uniseg.NewGraphemes(before)
	for caret > max(0, width-1) && graphemes.Next() {
		_, start = graphemes.Positions()
		caret -= ansi.StringWidth(graphemes.Str())
	}
	before = before[start:]
	var after strings.Builder
	remaining := max(0, width-caret)
	graphemes = uniseg.NewGraphemes(string(runes[position:]))
	for graphemes.Next() {
		glyph := graphemes.Str()
		cells := ansi.StringWidth(glyph)
		if cells > remaining {
			break
		}
		after.WriteString(glyph)
		remaining -= cells
	}
	visible := before + after.String()
	if value == "" && !field.Focused() {
		visible = cut(field.Placeholder, width)
	}
	return visible, caret
}
func oneLine(s string) string { return strings.Join(strings.Fields(safeText(s)), " ") }

// textinput collapses newlines and tabs. Keep list parameters reversible in a
// single terminal row, including literal backslashes in stop sequences.
func encodeAPIStrings(value string) string {
	value = strings.ReplaceAll(strings.ReplaceAll(value, "\r\n", "\n"), "\r", "\n")
	return strings.NewReplacer("\\", "\\\\", "\n", "\\n", "\t", "\\t").Replace(safeText(value))
}

func decodeAPIStrings(value string) string {
	var out strings.Builder
	runes := []rune(value)
	for i := 0; i < len(runes); i++ {
		if runes[i] == '\\' && i+1 < len(runes) {
			switch runes[i+1] {
			case 'n':
				out.WriteRune('\n')
				i++
				continue
			case 't':
				out.WriteRune('\t')
				i++
				continue
			case '\\':
				out.WriteRune('\\')
				i++
				continue
			}
		}
		out.WriteRune(runes[i])
	}
	return out.String()
}
