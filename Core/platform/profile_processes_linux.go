// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/platform/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: profileProcesses
// Impact: python -B scripts/code-atlas.py show Core/platform/profile_processes_linux.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build linux

package platform

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func profileProcesses() ([]profileProcess, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, err
	}
	var out []profileProcess
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil || pid == os.Getpid() {
			continue
		}
		base := filepath.Join("/proc", e.Name())
		data, err := os.ReadFile(filepath.Join(base, "cmdline"))
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		exe, _ := os.Readlink(filepath.Join(base, "exe"))
		out = append(out, profileProcess{PID: pid, Executable: exe, Command: strings.ReplaceAll(string(data), "\x00", " ")})
	}
	return out, nil
}
