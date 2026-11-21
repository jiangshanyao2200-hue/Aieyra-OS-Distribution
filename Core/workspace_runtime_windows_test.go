// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestOSRuntimeCleanupPreservesWindowsJunction
// Impact: python -B scripts/code-atlas.py show Core/workspace_runtime_windows_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestOSRuntimeCleanupPreservesWindowsJunction(t *testing.T) {
	m, project := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected provider call") })
	w := modeWorkspace(t, m.config, project, HostOS)
	target := t.TempDir()
	for name, value := range map[string]string{".ephemeral-os": "aieyra-os-ephemeral/1\n", "keep.txt": "outside runtime"} {
		if err := os.WriteFile(filepath.Join(target, name), []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	junction := filepath.Join(filepath.Dir(w.dir), workspaceID())
	cmd := exec.Command("cmd.exe", "/d", "/c", "mklink", "/J", junction, target)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("create owned junction: %v %s", err, out)
	}
	t.Cleanup(func() { _ = os.Remove(junction) })
	if ordinaryRuntimeDirectory(junction) {
		t.Fatal("junction accepted as ordinary runtime")
	}
	modeWorkspace(t, m.config, project, HostOS)
	if _, err := os.Lstat(junction); err != nil {
		t.Fatal("junction removed", err)
	}
	if b, err := os.ReadFile(filepath.Join(target, "keep.txt")); err != nil || string(b) != "outside runtime" {
		t.Fatal("external directory changed", err)
	}
}
