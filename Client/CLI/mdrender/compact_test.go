// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestLegacyMarkdownByteRegression; TestCompactPreservesSourceParagraphsAndStructuralSpacing; TestCompactStreamingStablePrefixDoesNotChange
// Impact: python -B scripts/code-atlas.py show Client/CLI/mdrender/compact_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package mdrender

import (
	"encoding/json"
	"io"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
)

func TestLegacyMarkdownByteRegression(t *testing.T) {
	b, err := os.ReadFile("testdata/cli-legacy-golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var samples []struct {
		Text      string
		Width     int
		Lines     []string
		Printable int
	}
	if err = json.Unmarshal(b, &samples); err != nil {
		t.Fatal(err)
	}
	r := lipgloss.NewRenderer(io.Discard)
	r.SetColorProfile(termenv.ANSI256)
	for _, v := range samples {
		lines, stable := RenderMarkdownStable(v.Text, v.Width)
		var got []string
		for _, line := range lines {
			got = append(got, RenderLineWithRenderer(line, r))
		}
		if !reflect.DeepEqual(got, v.Lines) || stable != v.Printable || !reflect.DeepEqual(lines, RenderMarkdown(v.Text, v.Width)) {
			t.Fatalf("legacy renderer changed: width=%d text=%q stable=%d/%d", v.Width, v.Text, stable, v.Printable)
		}
	}
}

func TestCompactPreservesSourceParagraphsAndStructuralSpacing(t *testing.T) {
	text := "one\ntwo\n\nthree\n\n\n# Heading\nbody\nnext\n\n- first\n- second\n\n> quote\n\n```txt\ncode\n\ncode2\n```\n\n| A | B |\n|---|---|\n| a | b |\n\nlast\n"
	lines, stable := RenderMarkdownCompactStable(text, 80)
	var rows []string
	for _, line := range lines {
		var b strings.Builder
		for _, span := range line {
			b.WriteString(span.Text)
		}
		rows = append(rows, b.String())
	}
	plain := strings.Join(rows, "\n")
	for _, want := range []string{"one\ntwo\n\nthree\n\n", "body\nnext\n\n", "│ code", "│ code2", "\n\nlast"} {
		if !strings.Contains(plain, want) {
			t.Fatalf("compact dropped source/structural spacing %q: %q", want, plain)
		}
	}
	if stable != len(lines) {
		t.Fatal("completed compact prefix wrong", stable, len(lines))
	}
	code := "```txt\ncode\n\ncode2\n```\n"
	compactCode, _ := RenderMarkdownCompactStable(code, 80)
	if !reflect.DeepEqual(compactCode, RenderMarkdown(code, 80)) {
		t.Fatal("compact changed code contents/blank lines")
	}
}

func TestCompactStreamingStablePrefixDoesNotChange(t *testing.T) {
	for _, text := range []string{
		"one\ntwo\n\n# Heading\ntext\n",
		"one\ntwo\n\n| A | B |\n|---|---|\n| a | value |\n| b | much wider value |\n\nend\n",
		"one\n```go\nfunc main() {\n\tprintln(\"👩‍💻\")\n}\n```\nend\n",
	} {
		for _, width := range []int{8, 40, 80} {
			var committed []Line
			for end := range text {
				lines, stable := RenderMarkdownCompactStable(text[:end], width)
				if len(lines) < len(committed) || len(committed) > 0 && !reflect.DeepEqual(lines[:len(committed)], committed) {
					t.Fatalf("compact stable prefix changed at byte=%d width=%d text=%q", end, width, text[:end])
				}
				if stable > len(committed) {
					committed = append(committed, lines[len(committed):stable]...)
				}
			}
		}
	}
}
