// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/platform/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ShellWordName; Process; TerminalProcess; ProcessRequest
// Impact: python -B scripts/code-atlas.py show Core/platform/process.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package platform owns OS process and installation primitives.
package platform

import (
	"path"
	"strings"
)

// ShellWordName normalizes a shell executable path for process selection.
func ShellWordName(s string) string {
	return strings.ToLower(strings.TrimSuffix(path.Base(strings.ReplaceAll(s, "\\", "/")), ".exe"))
}

type Process interface {
	Wait() (int, error)
	Write([]byte) (int, error)
	Stop() error
	Close()
}

// TerminalProcess is implemented by native PTY processes. Pipes deliberately
// do not pretend to support a terminal viewport.
type TerminalProcess interface {
	Resize(columns, rows int) error
}
type ProcessRequest struct {
	Shell       string
	Args        []string
	Environment []string
	Workdir     string
	Command     string
	TTY         bool
}
