// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: LaunchControlGUI
// Impact: python -B scripts/code-atlas.py show Core/host/control_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build windows

package host

import "fmt"

// Independent Control windows are retired; the OS entry handles -control.
func LaunchControlGUI() error {
	return fmt.Errorf("请从 Aieyra OS 的指挥中心入口打开 Control")
}
