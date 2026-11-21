// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/platform/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: profileProcesses
// Impact: python -B scripts/code-atlas.py show Core/platform/profile_processes_windows.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build windows

package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"time"
)

func profileProcesses() ([]profileProcess, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId,ExecutablePath,CommandLine) | ConvertTo-Json -Compress`)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	data, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("cannot verify whether older profile processes have exited")
	}
	var rows []struct {
		ProcessId                   int
		ExecutablePath, CommandLine string
	}
	if json.Unmarshal(data, &rows) != nil {
		return nil, fmt.Errorf("invalid process inventory")
	}
	var out []profileProcess
	for _, p := range rows {
		if p.ProcessId != os.Getpid() && p.ProcessId != cmd.Process.Pid {
			out = append(out, profileProcess{PID: p.ProcessId, Executable: p.ExecutablePath, Command: p.CommandLine})
		}
	}
	return out, nil
}
