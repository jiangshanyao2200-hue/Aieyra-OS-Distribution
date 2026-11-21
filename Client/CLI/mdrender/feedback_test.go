// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: plainSpans; TestFeedbackInlineSemantics; TestFeedbackMarkdownBlocksAndWidth
// Impact: python -B scripts/code-atlas.py show Client/CLI/mdrender/feedback_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package mdrender

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
)

func plainSpans(spans []Span) string {
	var b strings.Builder
	for _, s := range spans {
		b.WriteString(s.Text)
	}
	return b.String()
}

func TestFeedbackInlineSemantics(t *testing.T) {
	for _, tc := range []struct{ source, plain string }{
		{"**外层 *斜体* 结束**", "外层 斜体 结束"},
		{"*外层 **重点** 结束*", "外层 重点 结束"},
		{"***重点斜体***", "重点斜体"},
		{"__重点 _嵌套___", "重点 嵌套"},
		{"_斜体_ file_name_v2", "斜体 file_name_v2"},
		{"~~删除 **重点**~~", "删除 重点"},
		{"**含 `*字面*` 代码**", "含 *字面* 代码"},
		{"\\*字面\\* **未闭合", "*字面* **未闭合"},
		{"[**说明**](https://example.test)", "说明 https://example.test"},
	} {
		if got := plainSpans(parseInline(tc.source, styleText)); got != tc.plain {
			t.Errorf("%q => %q, want %q", tc.source, got, tc.plain)
		}
	}
	spans := parseInline("普通 **重点 *嵌套*** ~~删除~~", styleText)
	var nested, strike bool
	for _, s := range spans {
		if strings.Contains(s.Text, "普通") && s.Style.GetBold() {
			t.Fatal("agent base text is globally bold")
		}
		if s.Text == "嵌套" {
			nested = s.Style.GetBold() && s.Style.GetItalic()
		}
		if s.Text == "删除" {
			strike = s.Style.GetStrikethrough()
		}
	}
	if !nested || !strike {
		t.Fatalf("missing semantic styles nested=%v strike=%v", nested, strike)
	}
}

func TestFeedbackMarkdownBlocksAndWidth(t *testing.T) {
	source := "## 标题 `code`\n\n- [x] **完成**\n- [ ] _待办_\n  - 嵌套 👩‍💻 é\n\n| **项目** | 结果 |\n| --- | --- |\n| `中文` | ~~旧值~~ |\n\n> 引用 **重点**\n\n```go\n\tfmt.Println(\"👩‍💻 é\")\n```"
	for _, width := range []int{1, 2, 3, 8, 24, 40, 100} {
		lines := RenderMarkdown(source, width)
		for _, l := range lines {
			if got := ansi.StringWidth(RenderLine(l)); got > width {
				t.Fatalf("width=%d got=%d text=%q", width, got, plainSpans(l))
			}
		}
		if width >= 40 {
			plain := ansi.Strip(LinesToString(lines))
			for _, want := range []string{"☑ 完成", "☐ 待办", "标题 code", "👩‍💻 é", "中文", "旧值"} {
				if !strings.Contains(plain, want) {
					t.Errorf("width %d missing %q: %q", width, want, plain)
				}
			}
			if strings.Contains(plain, "**") || strings.Contains(plain, "~~") || strings.Contains(plain, "`中文`") {
				t.Fatalf("unrendered markup: %q", plain)
			}
		}
	}
}
