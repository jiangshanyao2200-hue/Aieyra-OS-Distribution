// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: readClipboardCmd
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/clipboard_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Presentation extracted from the original Core/ui; no legacy executor.
//go:build windows

package terminal

import (
	"github.com/atotto/clipboard"
	tea "github.com/charmbracelet/bubbletea"
)

// Ctrl+V 走 Win32 剪贴板，一次取到完整正文，不依赖逐字符到达时间。
func readClipboardCmd() tea.Cmd {
	return func() tea.Msg {
		text, err := clipboard.ReadAll()
		return clipboardTextMsg{text, err}
	}
}
