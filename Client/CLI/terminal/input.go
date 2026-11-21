// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: terminalInput; terminalInputMsg
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/input.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import tea "github.com/charmbracelet/bubbletea"

// Input commands own their decoder state and return immutable events. All UI
// updates still happen on the program's single event loop.
type terminalInput interface {
	read() tea.Msg
	close()
}

type terminalInputMsg struct {
	events []tea.Msg
	err    error
}
