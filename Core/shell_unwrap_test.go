// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestUnwrapSelfShell; TestExecuteUnwrapsRedundantPowerShell; TestBackgroundCommandRunsInTerminal
// Impact: python -B scripts/code-atlas.py show Core/shell_unwrap_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/platform"
)

func TestUnwrapSelfShell(t *testing.T) {
	pwsh := "C:/example/PowerShell/7/pwsh.exe"
	for _, c := range []struct {
		shell, cmd, want string
		ok               bool
	}{
		// AIDEBUG 真实 DeepSeek 任务里的原样命令：外层会把 $p、$_ 展开成空。
		{pwsh, `& 'C:/example/PowerShell/7/pwsh.exe' -NoProfile -Command "$p='milestone-note.md'; Get-Content -LiteralPath $p | ForEach-Object { '['+$_+']' }"`, `$p='milestone-note.md'; Get-Content -LiteralPath $p | ForEach-Object { '['+$_+']' }`, true},
		{pwsh, "pwsh -NoLogo -NoProfile -c \"Write-Output \"\"a`$b\"\" `\"q`\"\"", "Write-Output \"a$b\" \"q\"", true},
		{pwsh, `pwsh.exe -Command 'Write-Output ''it''s'''`, `Write-Output 'it's'`, true},
		{pwsh, "pwsh -Command \"a`nb\"", "a\nb", true},
		{pwsh, "pwsh -Command \"`u{263A}\"", "\u263a", true},
		{"C:/example/WindowsPowerShell/v1.0/powershell.exe", `powershell -NoProfile -Command "Get-Date"`, "Get-Date", true},
		// 不同引擎、带其他参数、脚本不是完整引号串、外层不是 PowerShell：都原样运行。
		{pwsh, `powershell -NoProfile -Command "Get-Date"`, "", false},
		{pwsh, `pwsh -ExecutionPolicy Bypass -Command "./build.ps1"`, "", false},
		{pwsh, `pwsh -File build.ps1`, "", false},
		{pwsh, `pwsh -Command "Get-Date"; Get-Item x`, "", false},
		{pwsh, `pwsh -Command Get-Date`, "", false},
		{pwsh, `pwsh -Command ""`, "", false},
		{pwsh, "pwsh -Command \"`0\"", "", false},
		{pwsh, `Get-ChildItem -Name`, "", false},
		{"C:/example/Windows/System32/cmd.exe", `pwsh -Command "Get-Date"`, "", false},
		{"/bin/bash", `pwsh -c "echo hi"`, "", false},
	} {
		got, ok := unwrapSelfShell(c.shell, c.cmd)
		if ok != c.ok || got != c.want {
			t.Errorf("unwrapSelfShell(%q) = %q, %v; want %q, %v", c.cmd, got, ok, c.want, c.ok)
		}
	}
}

// 真实执行：同样的嵌套写法现在读回文件内容，而不是 ParserError；说明只出现在第一次结果里。
func TestExecuteUnwrapsRedundantPowerShell(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("PowerShell 外壳只在 Windows 默认 Shell 下出现")
	}
	shell, err := platform.DefaultShell()
	if err != nil || platform.ShellWordName(shell) != "pwsh" && platform.ShellWordName(shell) != "powershell" {
		t.Skip("默认 Shell 不是 PowerShell")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("一\n二\n"), 0600); err != nil {
		t.Fatal(err)
	}
	manager, err := NewShellManager(root, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	cmd := "& '" + shell + `' -NoProfile -Command "$p='note.md'; Get-Content -LiteralPath $p -Encoding UTF8 | ForEach-Object { '['+$_+']' }"`
	result := manager.Execute(context.Background(), executionCall("exec_command", map[string]any{"cmd": cmd, "yield_time_ms": 30000}))
	if !result.OK || result.ExitCode == nil || *result.ExitCode != 0 {
		t.Fatalf("exit %v error %v output %q", result.ExitCode, result.Error, result.Output)
	}
	if !strings.Contains(result.Output, "[一]") || !strings.Contains(result.Output, "[二]") || result.CmdNotice == "" || strings.Contains(result.Cmd, "-Command") {
		t.Fatalf("output %q notice %q cmd %q", result.Output, result.CmdNotice, result.Cmd)
	}
}

func TestBackgroundCommandRunsInTerminal(t *testing.T) {
	manager, err := NewShellManager(t.TempDir(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	result := manager.Execute(context.Background(), executionCall("exec_command", map[string]any{"cmd": "echo ready", "background": true, "yield_time_ms": 3000, "timeout_ms": 20000}))
	if !result.OK || !result.TTY || !result.Background {
		t.Fatalf("ok %v tty %v background %v error %v", result.OK, result.TTY, result.Background, result.Error)
	}
}
