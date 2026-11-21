// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestShellTTYPowerShellReadsChineseInput
// Impact: python -B scripts/code-atlas.py show Core/shell_tty_encoding_windows_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build windows

package CORE

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// 交互终端里 PowerShell 读控制台输入时，中文必须原样到达（AIDEBUG terminal-history：[Console]::ReadLine 读到 ����42）。
// 同时覆盖 Windows PowerShell 5.1，它的 .NET Framework 对输入编码的处理不同。
func TestShellTTYPowerShellReadsChineseInput(t *testing.T) {
	m := shellTestManager(t)
	zero := 0
	legacy := ""
	if path, err := exec.LookPath("powershell.exe"); err == nil {
		legacy = path
	}
	cases := []struct{ shell, reader string }{{"", "[Console]::ReadLine()"}, {"", "Read-Host"}, {legacy, "[Console]::ReadLine()"}}
	for i, c := range cases {
		t.Run(fmt.Sprintf("%d %s", i, c.reader), func(t *testing.T) {
			out := filepath.Join(m.root, fmt.Sprintf("tty-%d.txt", i))
			r := m.start(context.Background(), ShellCommand{Cmd: "$x = " + c.reader + "\nSet-Content -LiteralPath '" + out + "' -Value $x -Encoding utf8", Shell: c.shell, TTY: true, YieldTimeMS: &zero})
			if !r.OK || r.State != "running" {
				t.Fatalf("start: %+v", r)
			}
			r = shellDone(t, m, m.input(context.Background(), ShellInput{SessionID: r.SessionID, Chars: "中文确认42", PressEnter: true}))
			data, err := os.ReadFile(out)
			if err != nil || strings.TrimSpace(strings.TrimPrefix(string(data), string(rune(0xFEFF)))) != "中文确认42" {
				t.Fatalf("shell %q read %q (%v); exit %v output %q", r.Shell, data, err, r.ExitCode, r.Output)
			}
		})
	}
}
