// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: viewportSize
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/winsize_other.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Presentation extracted from the original Core/ui; no legacy executor.
//go:build !windows

package terminal

// 非 Windows 消息已是可视窗口尺寸，但仍限制异常值，避免失控布局。
func viewportSize(msgW, msgH int) (int, int) {
	if msgW < 1 {
		msgW = 1
	}
	if msgW > 2000 {
		msgW = 2000
	}
	if msgH < 1 {
		msgH = 1
	}
	if msgH > 1000 {
		msgH = 1000
	}
	return msgW, msgH
}
