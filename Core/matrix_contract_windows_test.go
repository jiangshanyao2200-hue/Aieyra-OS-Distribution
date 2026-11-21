// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMatrixDeliveryRejectsEscapingDirectoryJunction
// Impact: python -B scripts/code-atlas.py show Core/matrix_contract_windows_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build windows

package CORE

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMatrixDeliveryRejectsEscapingDirectoryJunction(t *testing.T) {
	root, outside := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "artifact.txt"), []byte("outside-data"), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "link")
	shell, err := NewShellManager(root, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer shell.Close()
	quote := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
	result := shell.Execute(context.Background(), executionCall("exec_command", map[string]any{"cmd": "New-Item -ItemType Junction -Path " + quote(link) + " -Target " + quote(outside) + " -ErrorAction Stop | Out-Null", "yield_time_ms": 30000}))
	if !result.OK || result.ExitCode == nil || *result.ExitCode != 0 {
		t.Fatal("junction fixture failed", result.Error)
	}
	t.Cleanup(func() {
		if err := os.Remove(link); err != nil {
			t.Error(err)
		}
	})
	delivery := collectAgentDelivery(AgentSpec{Workdir: root, Contract: &AgentContract{Acceptance: []string{"x"}, Deliverables: []string{"link/artifact.txt"}}}, 1)
	if delivery.Artifacts[0].SHA256 != "" || delivery.Artifacts[0].Error == "" {
		t.Fatal("outside junction was accepted")
	}
}
