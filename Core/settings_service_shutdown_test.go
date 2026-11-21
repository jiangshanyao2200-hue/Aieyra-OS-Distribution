// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: settingsShutdownFixture; trace; mode; TestSettingsServiceOwnedShutdown; TestSettingsProcessDelayedWaitReceipt; TestSettingsServiceExternalShutdownKeepsServer
// Impact: python -B scripts/code-atlas.py show Core/settings_service_shutdown_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aieyra/aieyra-os/CORE/platform"
)

// 真实子进程把 EOF、清理完成和退出写入文件；返回 Close 不能冒充已经退出。
func settingsShutdownFixture(t *testing.T, runtime, mode string) (*SettingsService, func() string) {
	t.Helper()
	root := t.TempDir()
	launcher := platform.ElectronPath(root)
	if err := os.MkdirAll(filepath.Dir(launcher), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(runtime, launcher); err != nil {
		t.Fatal(err)
	}
	trace := filepath.Join(root, "exit.jsonl")
	traceJSON, _ := json.Marshal(trace)
	modeJSON, _ := json.Marshal(mode)
	script := `const fs = require('node:fs');
const trace = ` + string(traceJSON) + `;
const mode = ` + string(modeJSON) + `;
function record(event, code) {
  fs.appendFileSync(trace, JSON.stringify({event, code, pid: process.pid, time: new Date().toISOString()}) + '\n');
}
process.on('exit', code => record('exit', code));
process.stdin.resume();
process.stdin.once('end', () => {
  record('eof');
  if (mode === 'hang') { setInterval(() => {}, 1000); return; }
  setTimeout(() => { record('drained'); process.exit(mode === 'error' ? 7 : 0); }, 120);
});
record('started');
if (mode !== 'startup') process.stdout.write(JSON.stringify({url: 'http://127.0.0.1:1/' + 'a'.repeat(64) + '/renderer/index.html'}) + '\n');
`
	entry := filepath.Join(root, "Client/Desktop", "src", "terminal-server.cjs")
	if err := os.MkdirAll(filepath.Dir(entry), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(entry, []byte(script), 0600); err != nil {
		t.Fatal(err)
	}
	client := &SettingsService{root: root, config: filepath.Join(root, "isolated-config.json")}
	read := func() string { raw, _ := os.ReadFile(trace); return string(raw) }
	t.Cleanup(func() { client.Close(); t.Logf("helper trace: %s", read()) })
	return client, read
}

func TestSettingsServiceOwnedShutdown(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("local Node runtime unavailable")
	}
	// 只复制一次本地 Node；各子场景使用同卷硬链接，不拉起 GUI 或访问模型。
	runtime := filepath.Join(t.TempDir(), filepath.Base(node))
	if err := os.Link(node, runtime); err != nil {
		in, err := os.Open(node)
		if err != nil {
			t.Fatal(err)
		}
		out, err := os.OpenFile(runtime, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0700)
		if err != nil {
			in.Close()
			t.Fatal(err)
		}
		_, err = io.Copy(out, in)
		in.Close()
		closeErr := out.Close()
		if err != nil || closeErr != nil {
			t.Fatal("runtime copy failed", err, closeErr)
		}
	}
	start := func(t *testing.T, client *SettingsService) {
		t.Helper()
		// Allow a cold Windows/antivirus launch at BelowNormal priority. The
		// separate EOF/drain/exit assertions still enforce real termination.
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if _, err := client.address(ctx); err != nil {
			t.Fatal(err)
		}
	}
	assertExit := func(t *testing.T, read func() string, code int) {
		t.Helper()
		if !strings.Contains(read(), `"event":"exit","code":`+strconv.Itoa(code)) {
			t.Fatalf("Close returned without the expected child exit %d: %s", code, read())
		}
	}
	t.Run("EOF", func(t *testing.T) {
		client, read := settingsShutdownFixture(t, runtime, "normal")
		start(t, client)
		client.Close()
		assertExit(t, read, 0)
		if _, err := client.address(context.Background()); err == nil {
			t.Fatal("closed service accepted restart")
		}
	})
	t.Run("concurrent", func(t *testing.T) {
		client, read := settingsShutdownFixture(t, runtime, "normal")
		start(t, client)
		var callers sync.WaitGroup
		returned := make(chan string, 4)
		for range 4 {
			callers.Add(1)
			go func() { defer callers.Done(); client.Close(); returned <- read() }()
		}
		callers.Wait()
		close(returned)
		for trace := range returned {
			if !strings.Contains(trace, `"event":"exit","code":0`) {
				t.Errorf("a concurrent closer returned before child exit: %s", trace)
			}
		}
	})
	t.Run("cancelled-startup", func(t *testing.T) {
		client, read := settingsShutdownFixture(t, runtime, "startup")
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		done := make(chan error, 1)
		go func() { _, err := client.address(ctx); done <- err }()
		deadline := time.Now().Add(5 * time.Second)
		for !strings.Contains(read(), `"event":"started"`) && time.Now().Before(deadline) {
			time.Sleep(10 * time.Millisecond)
		}
		if !strings.Contains(read(), `"event":"started"`) {
			t.Fatal("startup child did not run")
		}
		cancel()
		select {
		case err := <-done:
			if err == nil {
				t.Fatal("cancelled caller reported ready")
			}
		case <-time.After(2 * time.Second):
			t.Fatal("cancelled caller kept waiting")
		}
		// 一个调用者的时限结束不能杀掉共享启动，后来者等同一个进程，不重启。
		if strings.Contains(read(), `"event":"exit"`) {
			t.Fatalf("caller deadline killed the shared startup: %s", read())
		}
		again, stop := context.WithTimeout(context.Background(), 300*time.Millisecond)
		defer stop()
		if _, err := client.address(again); err == nil {
			t.Fatal("pending startup reported ready")
		}
		if n := strings.Count(read(), `"event":"started"`); n != 1 {
			t.Fatalf("a later caller relaunched the service (%d starts): %s", n, read())
		}
		client.Close()
		assertExit(t, read, 0)
	})
	t.Run("close-during-startup", func(t *testing.T) {
		client, read := settingsShutdownFixture(t, runtime, "startup")
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		started := make(chan error, 1)
		go func() { _, err := client.address(ctx); started <- err }()
		deadline := time.Now().Add(5 * time.Second)
		for !strings.Contains(read(), `"event":"started"`) && time.Now().Before(deadline) {
			time.Sleep(10 * time.Millisecond)
		}
		if !strings.Contains(read(), `"event":"started"`) {
			t.Fatal("startup child did not run")
		}
		closed := make(chan struct{})
		go func() { client.Close(); close(closed) }()
		select {
		case <-closed:
		case <-time.After(2 * time.Second):
			t.Error("Close did not interrupt the pending readiness handshake")
			cancel()
			<-closed
		}
		if err := <-started; err == nil {
			t.Fatal("closed startup reported ready")
		}
		assertExit(t, read, 0)
	})
	t.Run("after-station-finish", func(t *testing.T) {
		finishing, release := make(chan struct{}, 1), make(chan struct{})
		w := collaborationFixture(t, func(rw http.ResponseWriter, _ *http.Request) {
			fixtureAnswer(rw, "helper-order", "completed", nil)
		}, func(_ context.Context, child *Workspace, action string) (workspaceMembership, error) {
			if action == "finish" {
				finishing <- struct{}{}
				<-release
			}
			return confirmedStation(child, action), nil
		})
		t.Cleanup(func() { close(release) })
		child := createTestSplit(t, w, "helper-order", "helper-order-assignment")
		waitSplitRecord(t, child)
		client, read := settingsShutdownFixture(t, runtime, "normal")
		start(t, client)
		w.host.service.Close()
		w.host.service = client
		done := w.host.beginShutdown()
		select {
		case <-finishing:
		case <-time.After(3 * time.Second):
			t.Fatal("station finish did not start")
		}
		if strings.Contains(read(), `"event":"eof"`) {
			t.Fatal("settings closed before station finish")
		}
		select {
		case <-done:
			t.Fatal("shutdown returned before station finish")
		default:
		}
		release <- struct{}{}
		select {
		case <-done:
		case <-time.After(7 * time.Second):
			t.Fatal("host did not wait for settings exit")
		}
		assertExit(t, read, 0)
	})
	for _, mode := range []string{"error", "hang"} {
		t.Run(mode, func(t *testing.T) {
			client, read := settingsShutdownFixture(t, runtime, mode)
			start(t, client)
			host := &WorkspaceHost{service: client}
			t.Cleanup(host.Close)
			done := host.beginShutdown()
			select {
			case <-done:
			case <-time.After(8 * time.Second):
				t.Fatal("helper shutdown exceeded its bound")
			}
			want := "settings_service_stop_failed"
			if mode == "hang" {
				want = "settings_service_stop_timeout"
			}
			if code := host.shutdownStatus()["failures"].(map[string]string)["settings_service"]; code != want {
				t.Fatalf("helper failure was hidden: got %q, want %q", code, want)
			}
			if mode == "error" {
				assertExit(t, read, 7)
			}
			client.Close()
			if code := host.shutdownStatus()["failures"].(map[string]string)["settings_service"]; code != want {
				t.Fatal("duplicate close changed the shutdown result")
			}
		})
	}
}

func TestSettingsProcessDelayedWaitReceipt(t *testing.T) {
	cmd := exec.Command(os.Args[0], "-test.run=^$")
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	err := waitSettingsProcess(done, func() error {
		killErr := cmd.Process.Kill()
		if killErr == nil {
			t.Fatal("already reaped process accepted kill")
		}
		done <- nil
		return killErr
	}, time.Millisecond)
	if err != nil {
		t.Fatalf("delayed successful wait receipt was discarded: %v", err)
	}
	err = waitSettingsProcess(done, func() error {
		done <- nil
		return nil
	}, time.Millisecond)
	if err != nil {
		t.Fatalf("successful exit receipt was discarded after a termination request: %v", err)
	}
}

func TestSettingsServiceExternalShutdownKeepsServer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	defer server.Close()
	client := &SettingsService{endpoint: server.URL + "/renderer/index.html"}
	client.Close()
	client.Close()
	response, err := http.Get(server.URL)
	if err != nil {
		t.Fatal("external service was stopped", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatal("external service changed")
	}
}
