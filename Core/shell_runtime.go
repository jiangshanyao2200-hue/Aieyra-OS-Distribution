// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: bundledShellToolDir; shellToolDirBeside; bundledShellToolsNotice
// Impact: python -B scripts/code-atlas.py show Core/shell_runtime.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"os"
	"path/filepath"
	"runtime"
)

// 随项目携带的检索工具只加入 Shell 子进程 PATH，不改用户系统设置。
func bundledShellToolDir() string {
	exe, err := os.Executable()
	if err != nil || runtime.GOOS != "windows" {
		return ""
	}
	return shellToolDirBeside(exe)
}

func shellToolDirBeside(exe string) string {
	dir := filepath.Join(filepath.Dir(exe), "Core", "tools", "runtime", "ripgrep")
	if info, err := os.Stat(filepath.Join(dir, "rg.exe")); err == nil && !info.IsDir() {
		return dir
	}
	return ""
}

func bundledShellToolsNotice() string {
	if bundledShellToolDir() == "" {
		return ""
	}
	return runtimePrompt("Matrix/工具说明/源码搜索.txt")
}
