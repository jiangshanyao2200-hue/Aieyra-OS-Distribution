// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: lifetimeTestEnv; TestWorkspaceLifetimeProcessTree
// Impact: python -B scripts/code-atlas.py show Core/host/workspace_windows_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build windows

package host

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func lifetimeTestEnv(role, marker string) []string {
	var env []string
	for _, item := range os.Environ() {
		if !strings.HasPrefix(item, "AIEYRA_LIFETIME_TEST_") {
			env = append(env, item)
		}
	}
	return append(env, "AIEYRA_LIFETIME_TEST_ROLE="+role, "AIEYRA_LIFETIME_TEST_MARKER="+marker)
}

// Runs actual Windows processes: the child has no parent watcher, as when
// Electron fails before loading the desktop entry and its lifecycle code.
func TestWorkspaceLifetimeProcessTree(t *testing.T) {
	role := os.Getenv("AIEYRA_LIFETIME_TEST_ROLE")
	marker := os.Getenv("AIEYRA_LIFETIME_TEST_MARKER")
	if role == "child" {
		if err := os.WriteFile(marker, []byte(strconv.Itoa(os.Getpid())), 0600); err != nil {
			os.Exit(2)
		}
		for {
			time.Sleep(time.Second)
		}
	}
	if role == "parent" {
		release, err := ownWorkspaceLifetime()
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		child := exec.Command(os.Args[0], "-test.run=^TestWorkspaceLifetimeProcessTree$")
		child.Env = lifetimeTestEnv("child", marker)
		if err := child.Start(); err != nil {
			release()
			os.Exit(3)
		}
		_, _ = io.Copy(io.Discard, os.Stdin)
		_ = child.Process.Kill()
		_ = child.Wait()
		release()
		os.Exit(0)
	}
	for _, abrupt := range []bool{false, true} {
		t.Run(fmt.Sprintf("abrupt=%v", abrupt), func(t *testing.T) {
			marker := filepath.Join(t.TempDir(), "child.pid")
			parent := exec.Command(os.Args[0], "-test.run=^TestWorkspaceLifetimeProcessTree$")
			parent.Env = lifetimeTestEnv("parent", marker)
			input, err := parent.StdinPipe()
			if err != nil {
				t.Fatal(err)
			}
			parent.Stderr = os.Stderr
			if err = parent.Start(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = parent.Process.Kill(); _ = input.Close() })
			var pid int
			deadline := time.Now().Add(10 * time.Second)
			for time.Now().Before(deadline) {
				data, _ := os.ReadFile(marker)
				pid, _ = strconv.Atoi(string(data))
				if pid > 0 {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			if pid == 0 {
				t.Fatal("owned child did not start")
			}
			child, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_TERMINATE, false, uint32(pid))
			if err != nil {
				t.Fatal(err)
			}
			defer windows.CloseHandle(child)
			defer windows.TerminateProcess(child, 1)
			if abrupt {
				err = parent.Process.Kill()
			} else {
				err = input.Close()
			}
			if err != nil {
				t.Fatal(err)
			}
			err = parent.Wait()
			if !abrupt && err != nil {
				t.Fatalf("normal release terminated Core: %v", err)
			}
			status, err := windows.WaitForSingleObject(child, 10000)
			if err != nil || status != windows.WAIT_OBJECT_0 {
				t.Fatalf("orphan native child remains: status=%d err=%v", status, err)
			}
		})
	}
}
