// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: readClipboardCmd
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/clipboard_other.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Presentation extracted from the original Core/ui; no legacy executor.
//go:build !windows

package terminal

import (
	"fmt"
	tea "github.com/charmbracelet/bubbletea"
)

func readClipboardCmd() tea.Cmd {
	return func() tea.Msg { return clipboardTextMsg{err: fmt.Errorf("请使用终端的粘贴快捷键")} }
}
