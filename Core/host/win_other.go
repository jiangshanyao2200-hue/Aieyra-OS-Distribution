// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ConfigDirName; ElectronDir; LaunchConfigGUI; AttachParentConsole; EnsureConsoleUTF8; EnsureChatConsole; ReportStartupError; PrepareTerminalConsole
// Impact: python -B scripts/code-atlas.py show Core/host/win_other.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

// 非 Windows 平台的占位实现。
//
// 配置中心是以 Windows 桌面程序发布的 Electron 应用，这两个函数在别的平台上
// 没有对应物；保留同名签名是为了让 go build ./... 在任意平台都能通过。
package host

import (
	"fmt"
	"os"
)

// ConfigDirName 是仓库根目录下 Electron 配置中心的目录名。
const ConfigDirName = "Client/Desktop"

// ElectronDir 在非 Windows 平台不适用。
func ElectronDir() (string, error) {
	return "", fmt.Errorf("配置中心仅在 Windows 上提供")
}

// LaunchConfigGUI 在非 Windows 平台不可用。
func LaunchConfigGUI(string) error {
	return fmt.Errorf("配置中心仅在 Windows 上提供")
}

// AttachParentConsole 在非 Windows 平台无事可做。
func AttachParentConsole() {}

// EnsureConsoleUTF8 在非 Windows 平台无事可做。
func EnsureConsoleUTF8() {}

func EnsureChatConsole() error { return nil }

func ReportStartupError(err error) { fmt.Fprintln(os.Stderr, "错误：", err) }

func PrepareTerminalConsole() (func(), error) { return func() {}, nil }
