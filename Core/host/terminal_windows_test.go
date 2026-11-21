// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestIntegratedFirstLaunchCanOpenSettingsBeforeConfigExists; TestPrepareTerminalConsolePreservesPipes
// Impact: python -B scripts/code-atlas.py show Core/host/terminal_windows_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build windows

package host

import (
	"os"
	"path/filepath"
	"testing"
)

func TestIntegratedFirstLaunchCanOpenSettingsBeforeConfigExists(t *testing.T) {
	file := filepath.Join(t.TempDir(), "config.json")
	t.Setenv("AIEYRA_TERMINAL", "1")
	t.Setenv("AIEYRA_CONFIG_FILE", file)
	settings, err := LoadChatSettings("")
	if err != nil || settings.Path() != file {
		t.Fatalf("首次设置前界面无法打开: %v", err)
	}
	if _, err = os.Stat(file); !os.IsNotExist(err) {
		t.Fatal("聊天入口不应自动写配置")
	}
	if _, err = LoadChatSettings(file); err == nil {
		t.Fatal("显式错误路径应该报错")
	}
}

func TestPrepareTerminalConsolePreservesPipes(t *testing.T) {
	input, inputWriter, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	defer inputWriter.Close()
	outputReader, output, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer outputReader.Close()
	defer output.Close()
	oldIn, oldOut := os.Stdin, os.Stdout
	os.Stdin, os.Stdout = input, output
	defer func() { os.Stdin, os.Stdout = oldIn, oldOut }()
	restore, err := PrepareTerminalConsole()
	if err != nil {
		t.Fatal(err)
	}
	if os.Stdin != input || os.Stdout != output {
		t.Fatal("redirected streams replaced")
	}
	restore()
	if os.Stdin != input || os.Stdout != output {
		t.Fatal("cleanup replaced caller streams")
	}
}
