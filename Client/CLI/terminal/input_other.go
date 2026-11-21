// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: programInput; newTerminalInput
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/input_other.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

package terminal

import "io"

func programInput(in io.Reader) io.Reader               { return in }
func newTerminalInput(io.Reader) (terminalInput, error) { return nil, nil }
