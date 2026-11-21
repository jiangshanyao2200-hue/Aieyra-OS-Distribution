// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestCLIConfiguredModelConPTY
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/configured_model_windows_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build windows

package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
	"unsafe"

	agent "github.com/aieyra/aieyra-os/CORE"
	"golang.org/x/sys/windows"
)

// Explicit opt-in only. The AIDEBUG launcher creates a private fixture from the
// selected provider; ordinary go test never reads personal credentials or calls it.
func TestCLIConfiguredModelConPTY(t *testing.T) {
	if os.Getenv("AIEYRA_REAL_MODEL_ACCEPTANCE") != "1" {
		t.Skip("explicit configured-model acceptance only")
	}
	exe, cfg, project, out := os.Getenv("AIEYRA_CLI_TEST_EXE"), os.Getenv("AIEYRA_REAL_FIXTURE_CONFIG"), os.Getenv("AIEYRA_REAL_PROJECT"), os.Getenv("AIEYRA_REAL_OUT")
	for _, p := range []string{exe, cfg, project, out} {
		if !filepath.IsAbs(p) {
			t.Fatal("explicit absolute executable, fixture, project and output required")
		}
	}
	if filepath.Dir(cfg) != out || filepath.Dir(project) != out {
		t.Fatal("configuration and project must belong to the private fixture")
	}
	screens := filepath.Join(out, "screens")
	if err := os.Mkdir(screens, 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AIEYRA_CLI_TEST_ENTRY", "cli")
	t.Setenv("AIEYRA_CLI_SCREEN_DIR", screens)
	t.Setenv("AIEYRA_CONTROL_DISABLED", "1")
	t.Setenv("TERM", "xterm-256color")
	checks := []map[string]any{}
	check := func(name string, pass bool, detail any) {
		t.Helper()
		checks = append(checks, map[string]any{"name": name, "pass": pass, "detail": detail})
		if !pass {
			t.Fatal(name, detail)
		}
	}
	defer func() {
		b, _ := json.MarshalIndent(map[string]any{"ok": !t.Failed(), "checks": checks, "real_provider": true, "finished": time.Now().UTC(), "limits": []string{"Native cells and timestamps; no human visual or physical IME claim", "Visible duration sampled at approximately 70ms; exact 2500ms policy covered by presentation unit tests"}}, "", "  ")
		if err := os.WriteFile(filepath.Join(out, "native-result.json"), b, 0600); err != nil {
			t.Error(err)
		}
	}()
	var ir, iw, or, ow windows.Handle
	if err := windows.CreatePipe(&ir, &iw, nil, 0); err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(ir)
	if err := windows.CreatePipe(&or, &ow, nil, 0); err != nil {
		windows.CloseHandle(iw)
		t.Fatal(err)
	}
	defer windows.CloseHandle(ow)
	input, output := os.NewFile(uintptr(iw), "configured-input"), os.NewFile(uintptr(or), "configured-output")
	defer input.Close()
	defer output.Close()
	var pc windows.Handle
	if err := windows.CreatePseudoConsole(windows.Coord{X: 100, Y: 30}, ir, ow, 0, &pc); err != nil {
		t.Fatal(err)
	}
	attrs, err := windows.NewProcThreadAttributeList(1)
	if err != nil {
		windows.ClosePseudoConsole(pc)
		t.Fatal(err)
	}
	defer attrs.Delete()
	ok, _, err := windows.NewLazySystemDLL("kernel32.dll").NewProc("UpdateProcThreadAttribute").Call(uintptr(unsafe.Pointer(attrs.List())), 0, windows.PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, uintptr(pc), unsafe.Sizeof(pc), 0, 0)
	if ok == 0 {
		windows.ClosePseudoConsole(pc)
		t.Fatal(err)
	}
	si := windows.StartupInfoEx{ProcThreadAttributeList: attrs.List()}
	si.Cb = uint32(unsafe.Sizeof(si))
	bridge, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	command, _ := windows.UTF16PtrFromString(syscall.EscapeArg(bridge) + " -test.run=^TestCLIConPTYBridge$ -- cli-conpty " + syscall.EscapeArg(exe) + " " + syscall.EscapeArg(cfg) + " " + syscall.EscapeArg(project))
	cwd, _ := windows.UTF16PtrFromString(project)
	pi, job := startCLIProcess(t, command, cwd, &si.StartupInfo)
	defer windows.CloseHandle(pi.Thread)
	var mu sync.Mutex
	var ansi strings.Builder
	done := make(chan struct{})
	go func() {
		defer close(done)
		buf := make([]byte, 16384)
		for {
			n, err := output.Read(buf)
			if n > 0 {
				mu.Lock()
				ansi.Write(buf[:n])
				mu.Unlock()
			}
			if err != nil {
				return
			}
		}
	}()
	readANSI := func() string { mu.Lock(); defer mu.Unlock(); return ansi.String() }
	defer func() {
		windows.TerminateJobObject(job, 0)
		windows.ClosePseudoConsole(pc)
		windows.CloseHandle(pi.Process)
		windows.CloseHandle(job)
		output.Close()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Error("owned ConPTY reader did not exit")
		}
		if err := os.WriteFile(filepath.Join(out, "windows-conpty.ansi"), []byte(readANSI()), 0600); err != nil {
			t.Error(err)
		}
	}()
	send := func(s string) {
		t.Helper()
		if _, err := io.WriteString(input, s); err != nil {
			t.Fatal(err)
		}
	}
	var core *client
	until := time.Now().Add(20 * time.Second)
	for time.Now().Before(until) {
		files, _ := filepath.Glob(filepath.Join(out, "matrix-api", "*.json"))
		if len(files) == 1 {
			b, _ := os.ReadFile(files[0])
			var descriptor map[string]any
			if json.Unmarshal(b, &descriptor) == nil && descriptor["url"] != nil && descriptor["token"] != nil && descriptor["session_id"] != nil {
				core = newClient(descriptor)
				break
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	check("owned-core-discovery", core != nil, nil)
	type role struct {
		Role, State, Error string
		Generation         int
		Activity           struct{ Items []agent.AgentActivity }
	}
	type snapshot struct {
		Greeting struct{ State, Text, Error string }
		Roles    []role
		Live     map[string]agent.WorkspaceLive
	}
	type screen struct {
		Text       string
		Width      int
		Height     int
		CapturedAt time.Time `json:"captured_at"`
	}
	sequence := 0
	phase := "startup"
	timeline, err := os.OpenFile(filepath.Join(out, "timeline.jsonl"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer timeline.Close()
	sample := func() (snapshot, role, screen) {
		t.Helper()
		var state snapshot
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		err := core.call(ctx, "workspace.snapshot", nil, &state)
		cancel()
		if err != nil {
			t.Fatal(err)
		}
		var primary role
		for _, r := range state.Roles {
			if r.Role == "matrix" {
				primary = r
			}
		}
		sequence++
		label := fmt.Sprintf("%06d-%s", sequence, phase)
		if err := os.WriteFile(filepath.Join(screens, "request"), []byte(label), 0600); err != nil {
			t.Fatal(err)
		}
		var frame screen
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			data, err := os.ReadFile(filepath.Join(screens, label+".json"))
			if err == nil && json.Unmarshal(data, &frame) == nil {
				if err := json.NewEncoder(timeline).Encode(map[string]any{"phase": phase, "screen": label, "frame": frame, "core": state}); err != nil {
					t.Fatal(err)
				}
				return state, primary, frame
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatal("native screen timeout")
		return state, primary, frame
	}
	for until = time.Now().Add(60 * time.Second); ; {
		s, _, f := sample()
		if s.Greeting.State == "online" && strings.Contains(f.Text, "就绪") {
			check("startup-greeting", s.Greeting.Text != "", nil)
			break
		}
		if time.Now().After(until) {
			t.Fatal("startup greeting did not become ready", s.Greeting.State)
		}
		time.Sleep(50 * time.Millisecond)
	}
	paste := func(s string) { send("\x1b[200~" + s + "\x1b[201~\r") }
	completed := func(r role, generation int) bool {
		return r.Generation > generation && (r.State == "completed" || r.State == "cancelled" || r.State == "failed")
	}
	phase = "greeting"
	_, before, _ := sample()
	paste("你好，只回复 CLI_HELLO_OK，不使用工具。")
	var firstUser, lastUser time.Time
	thoughtFrames, bodyFrames, maxThoughtRows := 0, 0, 0
	for until = time.Now().Add(90 * time.Second); ; {
		s, r, f := sample()
		if strings.Contains(f.Text, "● 你好，只回复") {
			if firstUser.IsZero() {
				firstUser = f.CapturedAt
			}
			lastUser = f.CapturedAt
		}
		thought := strings.Join(strings.Fields(s.Live["matrix"].Thought), " ")
		thoughtRows := 0
		body := false
		for _, line := range strings.Split(f.Text, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "○ ") {
				content := strings.TrimPrefix(line, "○ ")
				if len(content) >= 20 && strings.Contains(thought, content) {
					thoughtRows++
				}
				if content == "CLI_HELLO_OK" {
					body = true
				}
			}
		}
		maxThoughtRows = max(maxThoughtRows, thoughtRows)
		if thoughtRows > 0 && !body {
			thoughtFrames++
		}
		if body {
			bodyFrames++
		}
		if completed(r, before.Generation) && body && !lastUser.IsZero() && !strings.Contains(f.Text, "● 你好，只回复") {
			check("greeting-core-completed", r.State == "completed", r.State)
			break
		}
		if time.Now().After(until) {
			t.Fatal("greeting presentation timeout", r.State)
		}
		time.Sleep(50 * time.Millisecond)
	}
	check("user-native-visible-duration", lastUser.Sub(firstUser) >= 2400*time.Millisecond, lastUser.Sub(firstUser).Milliseconds())
	check("one-line-thought-before-body", thoughtFrames > 0 && maxThoughtRows == 1 && bodyFrames > 0, map[string]int{"thought_frames": thoughtFrames, "max_thought_rows": maxThoughtRows, "body_frames": bodyFrames})
	phase = "tool"
	_, before, _ = sample()
	paste("使用 exec_command 执行 PowerShell 命令：Set-Content -LiteralPath pelican.txt -Value 'PELICAN_OK' -NoNewline; Write-Output CLI_TOOL_OK。完成后只答 CLI_TASK_DONE。")
	receipt, toolVisible, bodyVisible := false, false, false
	for until = time.Now().Add(120 * time.Second); ; {
		_, r, f := sample()
		for _, item := range r.Activity.Items {
			if item.Generation == r.Generation && item.Tool == "exec_command" && item.State == "completed" && item.Exit != nil && *item.Exit == 0 {
				receipt = true
			}
		}
		for _, line := range strings.Split(f.Text, "\n") {
			if strings.HasPrefix(strings.TrimSpace(line), "· 我") {
				toolVisible = true
			}
			if strings.TrimSpace(line) == "○ CLI_TASK_DONE" {
				bodyVisible = true
			}
		}
		if completed(r, before.Generation) && bodyVisible {
			check("tool-core-completed", r.State == "completed", r.State)
			break
		}
		if time.Now().After(until) {
			t.Fatal("tool task timeout", r.State, r.Error)
		}
		time.Sleep(50 * time.Millisecond)
	}
	data, err := os.ReadFile(filepath.Join(project, "pelican.txt"))
	check("actual-file-content", err == nil && string(data) == "PELICAN_OK", nil)
	check("real-exec-receipt", receipt, nil)
	check("tool-visible-in-native-cells", toolVisible, nil)
	for _, size := range []windows.Coord{{X: 52, Y: 18}, {X: 120, Y: 36}, {X: 80, Y: 24}} {
		started := time.Now()
		if err := windows.ResizePseudoConsole(pc, size); err != nil {
			t.Fatal(err)
		}
		// Idle presentation polls size every 250ms. Observe the complete repaint,
		// not ConPTY's intermediate reflow of the previous viewport at 200ms.
		stable := 0
		for stable < 2 && time.Since(started) < time.Second {
			_, _, f := sample()
			if f.Width == int(size.X) && f.Height == int(size.Y) && strings.Contains(f.Text, "CLI_TASK_DONE") && strings.Count(f.Text, "就绪") == 1 {
				stable++
			} else {
				stable = 0
			}
			time.Sleep(40 * time.Millisecond)
		}
		check(fmt.Sprintf("resize-%dx%d", size.X, size.Y), stable == 2, map[string]any{"settled_ms": time.Since(started).Milliseconds(), "stable_samples": stable})
	}
	phase = "cancel"
	_, before, _ = sample()
	paste("立刻用 exec_command 执行 PowerShell：Start-Sleep -Seconds 20; Write-Output CANCEL_LATE。等待命令结束再回复。")
	for until = time.Now().Add(60 * time.Second); ; {
		_, r, _ := sample()
		running := false
		for _, item := range r.Activity.Items {
			if r.Generation > before.Generation && item.Generation == r.Generation && item.Tool == "exec_command" && item.State == "running" {
				running = true
			}
		}
		if running {
			check("cancel-during-executing-tool", true, nil)
			break
		}
		if completed(r, before.Generation) || time.Now().After(until) {
			t.Fatal("did not observe an executing cancellation tool", r.State)
		}
		time.Sleep(50 * time.Millisecond)
	}
	started := time.Now()
	send("\x1b")
	for {
		_, r, f := sample()
		if completed(r, before.Generation) && strings.Contains(f.Text, "就绪") {
			check("esc-cancels-core", r.State == "cancelled", r.State)
			check("cancel-latency", time.Since(started) < 5*time.Second, time.Since(started).Milliseconds())
			break
		}
		if time.Since(started) > 5*time.Second {
			t.Fatal("Esc cancellation timeout", r.State)
		}
		time.Sleep(50 * time.Millisecond)
	}
	phase = "next"
	_, before, _ = sample()
	for _, r := range "Only reply CLI_NEXT_OK; no tools." {
		send(string(r))
		time.Sleep(5 * time.Millisecond)
	}
	send("\r")
	for until = time.Now().Add(90 * time.Second); ; {
		_, r, f := sample()
		if completed(r, before.Generation) && strings.Contains(f.Text, "○ CLI_NEXT_OK") {
			check("natural-input-after-cancel", r.State == "completed", r.State)
			break
		}
		if time.Now().After(until) {
			t.Fatal("next input failed", r.State)
		}
		time.Sleep(50 * time.Millisecond)
	}
	send("\x11")
	for until = time.Now().Add(10 * time.Second); ; {
		text := readANSI()
		if strings.Contains(text, "CONSOLE_MODES_RESTORED") && strings.Contains(text, "CONSOLE_BUFFER_RESTORED") {
			check("graceful-exit-and-console-restoration", true, nil)
			break
		}
		if time.Now().After(until) {
			t.Fatal("console restoration timeout")
		}
		time.Sleep(50 * time.Millisecond)
	}
}
