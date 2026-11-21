// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: BenchmarkMarkdownPhaseSplit
// Impact: python -B scripts/code-atlas.py show Client/CLI/mdrender/benchmark_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package mdrender

import (
	"strings"
	"testing"
)

// BenchmarkMarkdownPhaseSplit 把「解析」与「渲染」分开量，确定优化该往哪打。
func BenchmarkMarkdownPhaseSplit(b *testing.B) {
	unit := "这是一段回答内容，含 `代码` 与 **强调**，还有 \\(x^2\\)。\n\n"
	text := strings.Repeat(unit, 160) // ~5.6KB

	b.Run("parse only", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			parseMarkdown(text)
		}
	})
	b.Run("render only", func(b *testing.B) {
		blocks := parseMarkdown(text)
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			for _, blk := range blocks {
				renderBlock(blk, 66)
			}
		}
	})
	b.Run("full", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			RenderMarkdownStable(text, 66)
		}
	})
}
