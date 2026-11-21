// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: prepare
// Impact: python -B scripts/code-atlas.py show Core/host/linkclient/process_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package linkclient

import (
	"os/exec"
	"syscall"
)

func prepare(command *exec.Cmd) {
	// 保留标准流；Windows不支持向普通子进程发Interrupt，取消只终止此句柄。
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000}
}
