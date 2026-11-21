// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: HostMode; SetMode; SetControl; Mode; unified; workspaceDirectory; managerDirectory; ListCLIWorkspaces; listSessions; CloseSession
// Impact: python -B scripts/code-atlas.py show Core/workspace_mode.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"fmt"
	"path/filepath"
)

// HostMode describes lifecycle, not a second execution engine or configuration.
type HostMode string

const (
	HostLegacy HostMode = ""
	HostCLI    HostMode = "cli"
	HostOS     HostMode = "os"
)

func (h *WorkspaceHost) SetMode(mode HostMode) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.workspaces) != 0 || (mode != HostLegacy && mode != HostCLI && mode != HostOS) {
		return fmt.Errorf("host mode must be configured before opening a session")
	}
	h.mode = mode
	return nil
}

// CLI participation is explicit; the authenticated local API remains available
// for Link even when no Control station is registered.
func (h *WorkspaceHost) SetControl(enabled bool) { h.control = enabled }

func (w *Workspace) Mode() HostMode {
	if w != nil && w.host != nil {
		return w.host.mode
	}
	return HostLegacy
}

// Both product hosts share one primary identity and global memory. The legacy
// mode exists only for old archives and compatibility tools, never for new chat.
func (mode HostMode) unified() bool { return mode == HostOS || mode == HostCLI }

func workspaceDirectory(config, id string, mode HostMode) string {
	switch mode {
	case HostCLI:
		return filepath.Join(PrivatePaths(config).Runtime, "cli", id)
	case HostOS:
		return filepath.Join(PrivatePaths(config).Runtime, "os", id)
	default:
		return filepath.Join(PrivatePaths(config).Workspaces, id)
	}
}

func managerDirectory(config, id string, mode HostMode) string {
	root := PrivatePaths(config).Tasks
	switch mode {
	case HostCLI:
		return filepath.Join(root, "cli-tasks", id)
	case HostOS:
		return filepath.Join(root, "os-tasks", id)
	default:
		return filepath.Join(root, id)
	}
}

func ListCLIWorkspaces(config string) (any, error) {
	return listWorkspaceDirectory(PrivatePaths(config).CLIWorkspaces)
}

func (w *Workspace) listSessions() (any, error) {
	switch w.Mode() {
	case HostOS, HostCLI:
		return []any{}, nil
	default:
		return ListWorkspaces(w.config)
	}
}

func (h *WorkspaceHost) CloseSession(id string) error {
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		return fmt.Errorf("core is closing")
	}
	w, c := h.workspaces[id], h.controls[id]
	if w == nil {
		h.mu.Unlock()
		return fmt.Errorf("session is not open")
	}
	delete(h.workspaces, id)
	delete(h.controls, id)
	delete(h.splits, id)
	h.mu.Unlock()
	c.Close()
	w.Close()
	return nil
}
