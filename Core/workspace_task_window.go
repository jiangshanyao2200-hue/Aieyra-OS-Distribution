// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: openTaskWindow; hideTaskWindow
// Impact: python -B scripts/code-atlas.py show Core/workspace_task_window.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "fmt"

func (h *WorkspaceHost) openTaskWindow(c *MatrixControl, id, mode string) error {
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		return fmt.Errorf("OS host closed")
	}
	window := h.taskWindows[id]
	if window == nil {
		window = c.TaskWindow()
		window.task, window.session = id, c.manager.owner
		h.taskWindows[id] = window
	}
	h.mu.Unlock()
	if mode == "" {
		return window.Open()
	}
	return window.Open(mode)
}
func (h *WorkspaceHost) hideTaskWindow(id string) error {
	h.mu.Lock()
	window := h.taskWindows[id]
	h.mu.Unlock()
	if window == nil {
		return fmt.Errorf("task window unavailable")
	}
	return window.Hide()
}
