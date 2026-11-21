// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: prepare
// Impact: python -B scripts/code-atlas.py show Core/host/linkclient/process_unix.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

package linkclient

import (
	"os"
	"os/exec"
)

func prepare(command *exec.Cmd) {
	// 给独立CLI处理取消的机会；WaitDelay到期仅兜底当前子进程。
	command.Cancel = func() error { return command.Process.Signal(os.Interrupt) }
}
