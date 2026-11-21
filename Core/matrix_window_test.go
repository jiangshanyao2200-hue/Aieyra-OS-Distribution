// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestMatrixTaskWindowRealBridge
// Impact: python -B scripts/code-atlas.py show Core/matrix_window_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

// 明确启用才展示自建专项窗口，不触碰已有实例。
func TestMatrixTaskWindowRealBridge(t *testing.T) {
	out := os.Getenv("AIEYRA_MATRIX_WINDOW_INTEGRATION")
	if out == "" {
		t.Skip("explicit foreground window integration opt-in")
	}
	if !filepath.IsAbs(out) {
		t.Fatal("absolute lab directory required")
	}
	if err := os.MkdirAll(out, 0700); err != nil {
		t.Fatal(err)
	}
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) { t.Error("unexpected model request") })
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	c, err := NewMatrixControl(m)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	w := c.TaskWindow()
	defer w.Close()
	if err = w.Open(); err != nil {
		t.Fatal(err)
	}
	w.mu.Lock()
	pid := w.cmd.Process.Pid
	exe := w.cmd.Path
	w.mu.Unlock()
	if err = WriteMatrixJSON(filepath.Join(out, "foreground-lease.json"), map[string]any{"targets": []any{map[string]any{"pid": pid, "path": exe}}}); err != nil {
		t.Fatal(err)
	}
	if err = w.Open(); err != nil {
		t.Fatal(err)
	}
	w.mu.Lock()
	same := w.cmd.Process.Pid == pid
	w.mu.Unlock()
	if !same {
		t.Fatal("duplicate task window")
	}
	assertWindow := func(visible, display bool) {
		t.Helper()
		script := `const {createComputer}=require(process.argv[1]);const c=createComputer(process.argv[2]);c.call('window-test',{action:'list',pid:Number(process.argv[3])}).then(r=>{console.log(JSON.stringify(r));}).finally(()=>c.close());`
		data, err := exec.Command("node", "-e", script, filepath.Join(mustProjectRoot(t), "Client/Desktop", "src", "agent-computer.cjs"), filepath.Join(out, "capture-config.json"), strconv.Itoa(pid)).Output()
		if err != nil {
			t.Fatal(err)
		}
		var result struct {
			OK      bool `json:"ok"`
			Windows []struct {
				Title string `json:"title"`
				State struct {
					Foreground  bool `json:"foreground"`
					NoActivate  bool `json:"no_activate"`
					Passthrough bool `json:"mouse_passthrough"`
				} `json:"window_state"`
			} `json:"windows"`
		}
		if json.Unmarshal(data, &result) != nil || !result.OK {
			t.Fatal("cannot inspect owned task window")
		}
		found := false
		for _, v := range result.Windows {
			if v.Title == "Matrix" {
				found = true
				if v.State.Foreground || v.State.NoActivate != display || v.State.Passthrough != display {
					t.Fatalf("unexpected native task window state: %+v", v.State)
				}
			}
		}
		if found != visible {
			t.Fatalf("window visibility: got %v want %v", found, visible)
		}
	}
	assertWindow(true, true)
	if err = w.Open("interactive"); err != nil {
		t.Fatal(err)
	}
	assertWindow(true, false)
	if err = w.Hide(); err != nil {
		t.Fatal(err)
	}
	assertWindow(false, false)
	if err = w.Open(); err != nil {
		t.Fatal(err)
	}
	assertWindow(true, false)
	if err = w.Open("display"); err != nil {
		t.Fatal(err)
	}
	assertWindow(true, true)
	// 模拟主进程退出：仅断开生命周期连接，不能先Kill子进程掩盖窗口清理缺陷。
	w.mu.Lock()
	connection := w.connection
	w.mu.Unlock()
	if err = connection.Close(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(8 * time.Second)
	exited := false
	for time.Now().Before(deadline) {
		w.mu.Lock()
		exited = w.cmd == nil
		w.mu.Unlock()
		if exited {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	if !exited {
		t.Fatal("task window did not exit when its parent bridge disconnected")
	}
	if err = w.Open(); err != nil {
		t.Fatal(err)
	}
	w.mu.Lock()
	pid, connection = w.cmd.Process.Pid, w.connection
	w.mu.Unlock()
	if err = WriteMatrixJSON(filepath.Join(out, "foreground-lease.json"), map[string]any{"targets": []any{map[string]any{"pid": pid, "path": exe}}}); err != nil {
		t.Fatal(err)
	}
	// Terminal/父进程被关闭可能发送RST；readline的错误同样必须被处理。
	if err = connection.(*net.TCPConn).SetLinger(0); err != nil {
		t.Fatal(err)
	}
	if err = connection.Close(); err != nil {
		t.Fatal(err)
	}
	exited = false
	deadline = time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		w.mu.Lock()
		exited = w.cmd == nil
		w.mu.Unlock()
		if exited {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	if !exited {
		t.Fatal("task window did not exit after parent TCP reset; possible unhandled readline error dialog")
	}
	if err = WriteMatrixJSON(filepath.Join(out, "report.json"), map[string]any{"ok": true, "checks": []string{"Go launches real Desktop Electron entry", "authenticated loopback startup receives visible ready", "repeated open reuses owned process", "default display has native noactivate and mouse passthrough", "explicit interactive enables input without activating window", "hide and reopen reuse the current mode", "display restores native input protection", "parent bridge disconnect exits owned Electron without a process kill", "parent TCP reset exits owned Electron without an unhandled error dialog"}}); err != nil {
		t.Fatal(err)
	}
}
