// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: enableScreenOutput; nativeBrowsing; rememberLiveTop; returnToLive
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/screen_terminal_other.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Presentation extracted from the original Core/ui; no legacy executor.
//go:build !windows

package terminal

import "os"

func enableScreenOutput(_ *os.File) (func(), error) { return func() {}, nil }
func (s *screen) nativeBrowsing() bool              { return false }
func (s *screen) rememberLiveTop()                  {}
func (s *screen) returnToLive()                     { s.reset = true }
