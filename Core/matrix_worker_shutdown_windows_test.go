// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestModelWorkerKernelShutdown
// Impact: python -B scripts/code-atlas.py show Core/matrix_worker_shutdown_windows_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build windows

package CORE

import (
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

// 内核句柄保留创建时间与真实退出码，验证清零PID和函数返回的边界。
func TestModelWorkerKernelShutdown(t *testing.T) {
	for _, mode := range []string{"normal", "cancel", "exit-error", "hang"} {
		t.Run(mode, func(t *testing.T) {
			var handle windows.Handle
			var pid uint32
			var created windows.Filetime
			var clearedState uint32
			runModelShutdownCase(t, mode, func(value int) {
				if value != 0 {
					pid = uint32(value)
					var err error
					handle, err = windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
					if err != nil {
						t.Error(err)
						return
					}
					var exited, kernel, user windows.Filetime
					if err = windows.GetProcessTimes(handle, &created, &exited, &kernel, &user); err != nil {
						t.Error(err)
					}
				} else if handle != 0 {
					var err error
					clearedState, err = windows.WaitForSingleObject(handle, 0)
					if err != nil {
						t.Error(err)
					}
				}
			})
			if handle == 0 {
				t.Fatal("kernel identity unavailable")
			}
			defer windows.CloseHandle(handle)
			state, err := windows.WaitForSingleObject(handle, 0)
			if err != nil || state != windows.WAIT_OBJECT_0 {
				t.Errorf("parent returned before kernel process exit: %d %v", state, err)
			}
			if clearedState != windows.WAIT_OBJECT_0 {
				t.Errorf("worker PID cleared before kernel process exit: %d", clearedState)
			}
			var code uint32
			if err = windows.GetExitCodeProcess(handle, &code); err != nil {
				t.Fatal(err)
			}
			t.Logf("worker kernel receipt mode=%s pid=%d created=%s exit=%d cleared_wait=%d returned_wait=%d", mode, pid, time.Unix(0, created.Nanoseconds()).UTC().Format(time.RFC3339Nano), code, clearedState, state)
			want := uint32(0)
			if mode == "exit-error" {
				want = 7
			}
			if mode == "hang" {
				want = 1
			}
			if code != want {
				t.Errorf("unexpected process exit %d, want %d", code, want)
			}
		})
	}
}
