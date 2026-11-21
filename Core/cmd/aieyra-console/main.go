// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/cmd/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: main
// Impact: python -B scripts/code-atlas.py show Core/cmd/aieyra-console/main.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Command aieyra-console 是 Terminal/ConPTY 内部入口，不独立打开窗口。
// Windows 不会把 GUI 子系统的程序自动附着到 ConPTY；控制台父进程
// 持有宿主连接，根 GUI EXE 再 AttachConsole，避免启动器闪出空控制台。
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func main() {
	host, err := os.Executable()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	root := filepath.Join(filepath.Dir(host), "..", "..", "..", "..", "Aieyra OS.exe")
	cmd := exec.Command(root, os.Args[1:]...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		if code, ok := err.(*exec.ExitError); ok {
			os.Exit(code.ExitCode())
		}
		fmt.Fprintln(os.Stderr, "对话启动失败：", err)
		os.Exit(1)
	}
}
