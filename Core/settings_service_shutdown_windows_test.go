// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestSettingsServiceNativeShutdown
// Impact: python -B scripts/code-atlas.py show Core/settings_service_shutdown_windows_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build windows

package CORE

import (
	"context"
	"encoding/json"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/aieyra/aieyra-os/CORE/platform"
	"golang.org/x/sys/windows"
)

// 独立内核句柄观察真正的 Electron Node helper，不能以父进程返回当子进程退出。
func TestSettingsServiceNativeShutdown(t *testing.T) {
	root, err := filepath.Abs("..")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(platform.ElectronPath(root)); err != nil {
		t.Skip("bundled Electron unavailable")
	}
	for _, mode := range []string{"normal", "concurrent", "appearance"} {
		t.Run(mode, func(t *testing.T) {
			file := filepath.Join(t.TempDir(), "config.json")
			settings := Defaults()
			settings.APIKey = "sk-shutdown-fixture"
			settings.SetPath(file)
			if err := settings.Save(); err != nil {
				t.Fatal(err)
			}
			original, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			client := &SettingsService{config: file, root: root}
			t.Cleanup(client.Close)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			address, err := client.address(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if mode == "appearance" {
				// Exercise the same service as opening/saving the normal settings
				// page. Startup-only shutdown misses live HTTP keep-alive clients.
				call := func(action string, args any) map[string]any {
					t.Helper()
					raw, err := json.Marshal(args)
					if err != nil {
						t.Fatal(err)
					}
					out, err := client.Call(ctx, "shutdown-appearance", action, raw)
					if err != nil {
						t.Fatal(err)
					}
					var result map[string]any
					if err := json.Unmarshal(out, &result); err != nil || result["ok"] != true {
						t.Fatalf("%s: %s (%v)", action, out, err)
					}
					return result
				}
				current := call("os_appearance_read", map[string]any{})
				call("os_appearance_update", map[string]any{
					"expected_version": current["version"],
					"patch": map[string]any{"regions": map[string]any{
						"assistant": map[string]any{"size": 21.5},
						"status":    map[string]any{"size": 21.5},
					}},
				})
				call("os_appearance_read", map[string]any{})
			}
			client.mu.Lock()
			pid := uint32(client.cmd.Process.Pid)
			client.mu.Unlock()
			handle, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
			if err != nil {
				t.Fatal(err)
			}
			defer windows.CloseHandle(handle)
			var created, exited, kernel, user windows.Filetime
			if err := windows.GetProcessTimes(handle, &created, &exited, &kernel, &user); err != nil {
				t.Fatal(err)
			}
			var callers sync.WaitGroup
			returns := make(chan uint32, 4)
			n := 1
			if mode == "concurrent" {
				n = 4
			}
			for range n {
				callers.Add(1)
				go func() {
					defer callers.Done()
					client.Close()
					state, err := windows.WaitForSingleObject(handle, 0)
					if err != nil {
						t.Error(err)
					}
					returns <- state
				}()
			}
			callers.Wait()
			close(returns)
			state, err := windows.WaitForSingleObject(handle, 5000)
			if err != nil || state != windows.WAIT_OBJECT_0 {
				t.Fatal("owned process survived close", state, err)
			}
			var code uint32
			if err := windows.GetExitCodeProcess(handle, &code); err != nil {
				t.Fatal(err)
			}
			t.Logf("native receipt pid=%d created=%s exit=%d", pid, time.Unix(0, created.Nanoseconds()).UTC().Format(time.RFC3339Nano), code)
			if code != 0 {
				t.Errorf("normal EOF was force-killed or failed: exit=%d", code)
			}
			for state := range returns {
				if state != windows.WAIT_OBJECT_0 {
					t.Errorf("Close returned before child exit: kernel wait=%d", state)
				}
			}
			client.Close()
			u, err := url.Parse(address)
			if err != nil {
				t.Fatal(err)
			}
			connection, err := net.DialTimeout("tcp", u.Host, time.Second)
			if err == nil {
				connection.Close()
				t.Error("settings listener survived process exit")
			}
			current, err := os.ReadFile(file)
			if err != nil || string(current) != string(original) {
				t.Fatal("shutdown modified isolated config", err)
			}
		})
	}
}
