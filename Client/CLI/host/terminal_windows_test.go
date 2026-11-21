// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestCLIExecutableConPTY; TestCLIExecutableConPTYFeedback; TestCLIAPIExecutableConPTY; TestOSTUIExecutableConPTY; TestConfigTUIExecutableConPTY; runCLIExecutableConPTY; TestCLIConPTYBridge; captureCLIScreens; startCLIProcess
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/terminal_windows_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build windows

package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
	"unsafe"

	agent "github.com/aieyra/aieyra-os/CORE"
	"golang.org/x/sys/windows"
)

// Tests own the complete ConPTY process tree; no personal console or provider.
func TestCLIExecutableConPTY(t *testing.T) {
	runCLIExecutableConPTY(t, false, "cli")
}

func TestCLIExecutableConPTYFeedback(t *testing.T) {
	runCLIExecutableConPTY(t, true, "cli")
}

func TestCLIAPIExecutableConPTY(t *testing.T) {
	runCLIExecutableConPTY(t, false, "cli-api")
}

func TestOSTUIExecutableConPTY(t *testing.T) {
	runCLIExecutableConPTY(t, false, "os")
}

func TestConfigTUIExecutableConPTY(t *testing.T) {
	for _, state := range []string{"valid", "missing", "malformed", "invalid-prompts"} {
		t.Run(state, func(t *testing.T) {
			t.Setenv("AIEYRA_CONFIG_TEST_STATE", state)
			runCLIExecutableConPTY(t, false, "config")
		})
	}
}

func runCLIExecutableConPTY(t *testing.T, feedback bool, entry string) {
	variable := map[string]string{"cli": "AIEYRA_CLI_TEST_EXE", "cli-api": "AIEYRA_CLI_TEST_EXE", "os": "AIEYRA_OS_TUI_TEST_EXE", "config": "AIEYRA_CONFIG_TUI_TEST_EXE"}[entry]
	exe := os.Getenv(variable)
	if exe == "" {
		t.Skip("set " + variable + " to the built executable")
	}
	t.Setenv("AIEYRA_CLI_TEST_ENTRY", entry)
	t.Setenv("TERM", "xterm-256color")
	abs, err := filepath.Abs(exe)
	if err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	var startupCalls atomic.Int32
	var baseContractChecks atomic.Int32
	var catalogCalls atomic.Int32
	defer func() {
		if dir := os.Getenv("AIEYRA_CLI_TEST_OUT"); dir != "" {
			if err := os.MkdirAll(dir, 0700); err != nil {
				t.Error(err)
				return
			}
			name := "conpty-result.json"
			if feedback {
				name = "conpty-feedback-result.json"
			}
			if entry != "cli" {
				name = strings.ReplaceAll(t.Name(), "/", "-") + "-result.json"
			}
			taskRequests, probeRequests := calls.Load(), int32(0)
			if entry == "cli-api" {
				taskRequests, probeRequests = 0, calls.Load()
			}
			data, err := json.MarshalIndent(map[string]any{"passed": !t.Failed(), "startup_requests": startupCalls.Load(), "task_requests": taskRequests, "probe_requests": probeRequests, "catalog_requests": catalogCalls.Load(), "base_terminal_contract_checks": baseContractChecks.Load(), "real_provider_calls": 0}, "", "  ")
			if err != nil {
				t.Error(err)
				return
			}
			if err := os.WriteFile(filepath.Join(dir, name), data, 0600); err != nil {
				t.Error(err)
			}
		}
	}()
	release := make(chan struct{})
	secondTool := make(chan struct{})
	finishTools := make(chan struct{})
	var releaseOnce sync.Once
	var secondOnce, finishOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	unblockSecond := func() { secondOnce.Do(func() { close(secondTool) }) }
	unblockFinal := func() { finishOnce.Do(func() { close(finishTools) }) }
	defer unblock()
	defer unblockSecond()
	defer unblockFinal()
	screenDir := t.TempDir()
	t.Setenv("AIEYRA_CLI_SCREEN_DIR", screenDir)
	payload := "\tif 中文 {\n\t\t👩‍💻 é ❤️ 🐈\n}\n" + strings.Repeat("粘贴 payload\n", 20)
	requests := make(chan string, 16)
	allRequests := make(chan string, 16)
	cfg, project := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		if entry == "cli-api" {
			handleCLIAPINativeFixture(t, w, r, &startupCalls, &calls, &catalogCalls)
			return
		}
		var request struct {
			Tools []struct{ Name string } `json:"tools"`
			Input []struct {
				Role    string          `json:"role"`
				Content json.RawMessage `json:"content"`
			} `json:"input"`
		}
		if e := json.NewDecoder(r.Body).Decode(&request); e != nil {
			t.Error(e)
		}
		var latest string
		for _, item := range request.Input {
			if item.Role == "user" {
				latest = ""
				if json.Unmarshal(item.Content, &latest) != nil {
					var parts []struct {
						Text string `json:"text"`
					}
					if e := json.Unmarshal(item.Content, &parts); e != nil {
						t.Error(e)
					}
					for _, c := range parts {
						latest += c.Text
					}
				}
			}
		}
		if strings.Contains(latest, "[Startup connection greeting; no tools or task execution.]") {
			startupCalls.Add(1)
			answer(w, "startup", "STARTUP_READY", nil)
			return
		}
		// The old split-task section below drives trusted local host RPC, not
		// model delegation. Check the actual primary requests on the real CLI.
		if entry == "cli" && !strings.Contains(latest, "SPLIT_") {
			allowed := map[string]bool{"terminal": true, "apply_patch": true, "update_plan": true}
			for _, tool := range request.Tools {
				if tool.Name == "web_search" {
					continue
				}
				if !allowed[tool.Name] {
					t.Error("actual CLI advertised non-base capability", tool.Name)
				}
				delete(allowed, tool.Name)
			}
			if len(allowed) != 0 {
				t.Error("actual CLI omitted base tools", allowed)
			}
			encoded, _ := json.Marshal(request.Input)
			if !strings.Contains(string(encoded), "in the Aieyra CLI terminal") || strings.Contains(string(encoded), "aieyra_toolbox_catalogue") {
				t.Error("actual CLI did not use the base terminal contract")
			}
			baseContractChecks.Add(1)
		}
		requests <- latest
		n := calls.Add(1)
		if !feedback && strings.Contains(latest, "SPLIT_HOLD_") {
			select {
			case <-release:
			case <-r.Context().Done():
			}
			return
		}
		if feedback {
			data, _ := json.Marshal(request)
			allRequests <- string(data)
			if n == 1 {
				select {
				case <-release:
				case <-r.Context().Done():
					return
				}
				callTool(w, "feedback-tool", "apply_patch", map[string]any{"description": "我现在开始编辑反馈文件", "patch": "*** Begin Patch\n*** Add File: feedback.txt\n+FEEDBACK_TOOL_OUTPUT\n" + strings.Repeat("+中文 👩‍💻 é sustained detail\n", 120) + "*** End Patch"})
			} else if n == 2 {
				select {
				case <-secondTool:
				case <-r.Context().Done():
					return
				}
				callTool(w, "feedback-tool-2", "apply_patch", map[string]any{"description": "我来补齐第二项检查", "patch": "*** Begin Patch\n*** Add File: feedback-second.txt\n+FEEDBACK_SECOND_OUTPUT\n*** End Patch"})
			} else {
				select {
				case <-finishTools:
				case <-r.Context().Done():
					return
				}
				answer(w, fmt.Sprint(n), "## 检查结果 HEADING\n\nPLAIN_BODY 已保留 **EMPHASIS 原目标 _和补充_**。\n\n- [x] 中文 👩‍💻\n- [ ] `FEEDBACK_FINAL`\n\n```go\nfmt.Println(\"完成\")\n```", nil)
			}
			return
		}
		if n == 3 {
			callTool(w, "native-detail", "apply_patch", map[string]any{"patch": "*** Begin Patch\n*** Add File: native-receipt.txt\n+NATIVE_TOOL_DETAIL\n*** End Patch"})
			return
		}
		var body strings.Builder
		for i := 0; i < 120; i++ {
			fmt.Fprintf(&body, "NATIVE-%d-%03d 窗口 history\n", n, i)
		}
		answer(w, fmt.Sprint(n), body.String(), nil)
	})
	if entry == "cli-api" {
		prepareCLIAPINativeFixture(t, cfg)
	}
	if entry == "config" {
		switch os.Getenv("AIEYRA_CONFIG_TEST_STATE") {
		case "missing":
			if err := os.Remove(cfg); err != nil {
				t.Fatal(err)
			}
		case "malformed":
			if err := os.WriteFile(cfg, []byte("{invalid fixture"), 0600); err != nil {
				t.Fatal(err)
			}
		case "invalid-prompts":
			s, err := agent.Load(cfg)
			if err != nil {
				t.Fatal(err)
			}
			s.PromptDir = filepath.Join(filepath.Dir(cfg), "absent-prompts")
			if err := s.Save(); err != nil {
				t.Fatal(err)
			}
		}
	}
	configBefore, configBeforeErr := os.ReadFile(cfg)
	var ir, iw, or, ow windows.Handle
	if err = windows.CreatePipe(&ir, &iw, nil, 0); err != nil {
		t.Fatal(err)
	}
	if err = windows.CreatePipe(&or, &ow, nil, 0); err != nil {
		t.Fatal(err)
	}
	input, output := os.NewFile(uintptr(iw), "cli-test-input"), os.NewFile(uintptr(or), "cli-test-output")
	defer input.Close()
	defer output.Close()
	var pc windows.Handle
	if err = windows.CreatePseudoConsole(windows.Coord{X: 100, Y: 30}, ir, ow, 0, &pc); err != nil {
		t.Fatal(err)
	}
	windows.CloseHandle(ir)
	windows.CloseHandle(ow)
	attrs, err := windows.NewProcThreadAttributeList(1)
	if err != nil {
		t.Fatal(err)
	}
	defer attrs.Delete()
	ok, _, err := windows.NewLazySystemDLL("kernel32.dll").NewProc("UpdateProcThreadAttribute").Call(uintptr(unsafe.Pointer(attrs.List())), 0, windows.PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, uintptr(pc), unsafe.Sizeof(pc), 0, 0)
	if ok == 0 {
		t.Fatal(err)
	}
	si := windows.StartupInfoEx{ProcThreadAttributeList: attrs.List()}
	si.Cb = uint32(unsafe.Sizeof(si))
	bridge, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd, _ := windows.UTF16PtrFromString(syscall.EscapeArg(bridge) + " -test.run=^TestCLIConPTYBridge$ -- cli-conpty " + syscall.EscapeArg(abs) + " " + syscall.EscapeArg(cfg) + " " + syscall.EscapeArg(project))
	cwd, _ := windows.UTF16PtrFromString(project)
	pi, job := startCLIProcess(t, cmd, cwd, &si.StartupInfo)
	defer windows.CloseHandle(pi.Thread)
	var mu sync.Mutex
	var log strings.Builder
	stageEnd := 0
	done := make(chan struct{})
	go func() {
		defer close(done)
		buf := make([]byte, 16384)
		for {
			n, e := output.Read(buf)
			if n > 0 {
				mu.Lock()
				log.Write(buf[:n])
				mu.Unlock()
			}
			if e != nil {
				return
			}
		}
	}()
	text := func() string { mu.Lock(); defer mu.Unlock(); return log.String() }
	markNativeStage := func() {
		mu.Lock()
		defer mu.Unlock()
		if stageEnd == 0 {
			stageEnd = log.Len()
		}
	}
	defer func() {
		windows.TerminateJobObject(job, 0)
		windows.ClosePseudoConsole(pc)
		windows.CloseHandle(pi.Process)
		windows.CloseHandle(job)
		select {
		case <-done:
		case <-time.After(2 * time.Second):
		}
		if dir := os.Getenv("AIEYRA_CLI_TEST_OUT"); dir != "" {
			_ = os.MkdirAll(dir, 0700)
			name := "windows-conpty.ansi"
			if feedback {
				name = "windows-conpty-feedback.ansi"
			}
			if entry != "cli" {
				name = strings.ReplaceAll(t.Name(), "/", "-") + ".ansi"
			}
			_ = os.WriteFile(filepath.Join(dir, name), []byte(text()), 0600)
			stage, _ := json.MarshalIndent(map[string]any{"cols": 100, "rows": 30, "end_offset": stageEnd, "scope": "actual ConPTY output before first resize", "ansi": name}, "", "  ")
			_ = os.WriteFile(filepath.Join(dir, name+".stage.json"), stage, 0600)
		}
	}()
	wait := func(mark string, after int) {
		t.Helper()
		until := time.Now().Add(10 * time.Second)
		for time.Now().Before(until) {
			s := text()
			if len(s) > after && strings.Contains(s[after:], mark) {
				return
			}
			time.Sleep(20 * time.Millisecond)
		}
		s := text()
		t.Fatalf("missing %q; tail %q", mark, s[max(0, len(s)-2500):])
	}
	send := func(s string) {
		t.Helper()
		if _, e := io.WriteString(input, s); e != nil {
			t.Fatal(e)
		}
	}
	if entry == "config" {
		wait("Eyra API", 0)
		if os.Getenv("AIEYRA_CONFIG_TEST_STATE") == "malformed" {
			wait("无法解析共享 OS 配置，请修复原文件后重试；未覆盖配置", 0)
		} else {
			wait("与 Aieyra OS 共用配置", 0)
		}
		send("\x1b")
		wait("CONSOLE_MODES_RESTORED", 0)
		wait("CONSOLE_MAIN_BUFFER_EXITED", 0)
		if !strings.Contains(text(), "CLI_SHELL_BUFFER_BEFORE") {
			t.Fatal("ConPTY lost original shell stream")
		}
		configAfter, configAfterErr := os.ReadFile(cfg)
		if string(configBefore) != string(configAfter) || os.IsNotExist(configBeforeErr) != os.IsNotExist(configAfterErr) {
			t.Fatal("closing settings changed the original configuration")
		}
		if calls.Load() != 0 || startupCalls.Load() != 0 {
			t.Fatal("settings-only entry called a model")
		}
		if files, _ := filepath.Glob(filepath.Join(filepath.Dir(cfg), "matrix-api", "*.json")); len(files) != 0 {
			t.Fatal("settings-only entry started a core")
		}
		return
	}
	wait("FIXTURE", 0)
	wait("STARTUP_READY", 0)
	if feedback {
		var native struct {
			Text                   string
			Characters, Attributes [][]uint16
		}
		capture := func(label string) string {
			t.Helper()
			if e := os.WriteFile(filepath.Join(screenDir, "request"), []byte(label), 0600); e != nil {
				t.Fatal(e)
			}
			until := time.Now().Add(3 * time.Second)
			for time.Now().Before(until) {
				if data, e := os.ReadFile(filepath.Join(screenDir, label+".json")); e == nil {
					if dir := os.Getenv("AIEYRA_CLI_TEST_OUT"); dir != "" {
						_ = os.MkdirAll(dir, 0700)
						_ = os.WriteFile(filepath.Join(dir, label+".json"), data, 0600)
					}
					if json.Unmarshal(data, &native) != nil {
						t.Fatal("bad native snapshot")
					}
					return native.Text
				}
				time.Sleep(20 * time.Millisecond)
			}
			t.Fatal("native screen snapshot timed out")
			return ""
		}
		foreground := func(token string) uint16 {
			t.Helper()
			for y, row := range native.Characters {
				for x := 0; x+len(token) <= len(row); x++ {
					match := true
					for i := range token {
						match = match && row[x+i] == uint16(token[i])
					}
					if match {
						return native.Attributes[y][x] & 15
					}
				}
			}
			t.Fatalf("native style token missing: %s", token)
			return 0
		}
		for _, r := range "FAST_ORIGINAL" {
			send(string(r))
			time.Sleep(5 * time.Millisecond)
		}
		send("\r")
		select {
		case got := <-requests:
			if got != "FAST_ORIGINAL" {
				t.Errorf("ordinary input changed: %q", got)
			}
		case <-time.After(2 * time.Second):
			t.Error("fast first message was not delivered")
			capture("first-send-failure")
			send("\x15\x1b[200~FAST_ORIGINAL\x1b[201~\r")
			select {
			case <-requests:
			case <-time.After(4 * time.Second):
				t.Fatal("bracketed rescue failed")
			}
		}
		time.Sleep(150 * time.Millisecond)
		firstFrame := capture("feedback-user-style")
		if !strings.Contains(firstFrame, "● FAST_ORIGINAL") {
			t.Error("user circle or original text missing", firstFrame)
		}
		if foreground("FAST_ORIGINAL")&8 == 0 {
			t.Error("native user text lost emphasis")
		}
		time.Sleep(150 * time.Millisecond)
		send("\x1b[200~SUPPLEMENT_KEEP_ORIGINAL\x1b[201~\r")
		time.Sleep(200 * time.Millisecond)
		frame := capture("midtask-supplement")
		if strings.Contains(frame, "当前任务仍在执行") {
			t.Error("busy supplement was rejected")
		}
		if strings.Count(frame, "工作中") > 1 || !strings.Contains(frame, "SUPPLEMENT_KEEP_ORIGINAL") {
			t.Errorf("old display or repeated status: %q", frame)
		}
		unblock()
		wait("编辑反馈文件", 0)
		wait("sustained detail", 0)
		frame = capture("feedback-tool-details")
		if !strings.Contains(frame, "✓ 编辑反馈文件") || !strings.Contains(frame, "输入") || !strings.Contains(frame, "sustained detail") {
			t.Error("actual tool details lost their brief", frame)
		}
		if strings.Contains(frame, `"kind"`) || strings.Contains(frame, `"new"`) {
			t.Error("actual tool details still show raw patch JSON", frame)
		}
		// A busy provider keeps the same task alive while the real tool's typed
		// details finish, fold and survive resizing without accumulating status.
		for i, size := range []windows.Coord{{X: 52, Y: 18}, {X: 120, Y: 36}, {X: 80, Y: 24}} {
			markNativeStage()
			if err = windows.ResizePseudoConsole(pc, size); err != nil {
				t.Fatal(err)
			}
			time.Sleep(300 * time.Millisecond)
			frame = capture(fmt.Sprintf("feedback-busy-resize-%d", i))
			if strings.Count(frame, "工作中") > 1 || strings.Count(frame, "编辑反馈文件") != 1 {
				t.Error("resize duplicated status or old display", frame)
			}
		}
		// A receipt now includes its real input as well as output. Wait for the
		// actual preview dwell to end; a fixed delay races long animated input.
		folded := false
		foldUntil := time.Now().Add(8 * time.Second)
		for i := 0; time.Now().Before(foldUntil); i++ {
			frame = capture(fmt.Sprintf("feedback-fold-%02d", i))
			if !strings.Contains(frame, "sustained detail") && !strings.Contains(frame, "输入  patch") {
				folded = true
				break
			}
			time.Sleep(150 * time.Millisecond)
		}
		if !folded {
			t.Fatal("actual input/output preview did not fold within its bounded dwell", frame)
		}
		for i := 0; i < 12; i++ {
			frame = capture(fmt.Sprintf("feedback-steady-%02d", i))
			if strings.Count(frame, "工作中") != 1 || strings.Count(frame, "编辑反馈文件") != 1 || strings.Contains(frame, "sustained detail") {
				t.Error("steady state flooded or failed to fold", frame)
				break
			}
			time.Sleep(100 * time.Millisecond)
		}
		unblockSecond()
		wait("补齐第二项检查", 0)
		time.Sleep(250 * time.Millisecond)
		frame = capture("feedback-second-tool")
		if !strings.Contains(frame, "补齐第二项检查") || strings.Contains(frame, "我来补齐") {
			t.Error("new tool disappeared from information flow", frame)
		}
		for name, content := range map[string]string{"feedback.txt": "FEEDBACK_TOOL_OUTPUT\n" + strings.Repeat("中文 👩‍💻 é sustained detail\n", 120), "feedback-second.txt": "FEEDBACK_SECOND_OUTPUT\n"} {
			if data, e := os.ReadFile(filepath.Join(project, name)); e != nil || string(data) != content {
				t.Errorf("actual patch %s failed: %v bytes=%d", name, e, len(data))
			}
		}
		unblockFinal()
		wait("FEEDBACK_FINAL", 0)
		time.Sleep(250 * time.Millisecond)
		frame = capture("feedback-final-preview")
		if strings.Count(frame, "就绪") > 1 {
			t.Errorf("final frame retains old state: %q", frame)
		}
		// Patch input legitimately contains "*** Begin Patch" while its preview
		// finishes. Check Markdown in the body, not stars belonging to tool input.
		if strings.Contains(frame, "我现在开始编辑") || strings.Contains(frame, "我来补齐") || strings.Contains(frame, "FEEDBACK_TOOL_OUTPUT") || strings.Contains(frame, "**EMPHASIS**") || strings.Contains(frame, "[x] 中文") || strings.Contains(frame, "## 检查结果") || !strings.Contains(frame, "☑ 中文") {
			t.Error("completion retained tool display or unrendered markdown", frame)
		}
		plain := foreground("PLAIN_BODY")
		if plain&8 != 0 || foreground("EMPHASIS") == plain || foreground("HEADING") == plain {
			t.Error("native Markdown lacks normal body and distinct semantic highlights")
		}
		// ReadConsoleOutputW reduces 256-color ANSI to a 16-color attribute.
		// Code 147 and body 252 may share that attribute; assert their emitted
		// colors directly, allowing ConPTY to split combined SGR sequences.
		for token, color := range map[string]int{"PLAIN_BODY": 252, "EMPHASIS": 159, "FEEDBACK_FINAL": 147} {
			pattern := fmt.Sprintf(`\x1b\[38;5;%dm(?:\x1b\[[0-9;]*m)*%s`, color, regexp.QuoteMeta(token))
			if !regexp.MustCompile(pattern).MatchString(text()) {
				t.Errorf("ConPTY Markdown color missing: %s color=%d", token, color)
			}
		}
		// ReadConsoleOutputW is BMP-cell evidence and can replace non-BMP glyphs.
		// Verify the actual ConPTY UTF-8 stream separately for intact graphemes.
		if !strings.Contains(text(), "👩‍💻") || strings.Contains(text(), "�") {
			t.Error("ConPTY output corrupted Unicode")
		}
		// Final tool previews also finish once, then become adjacent briefs.
		finalFolded := false
		finalUntil := time.Now().Add(8 * time.Second)
		for i := 0; time.Now().Before(finalUntil); i++ {
			frame = capture(fmt.Sprintf("feedback-final-fold-%02d", i))
			if !strings.Contains(frame, "输入  patch") && !strings.Contains(frame, "FEEDBACK_SECOND_OUTPUT") {
				finalFolded = true
				break
			}
			time.Sleep(150 * time.Millisecond)
		}
		if !finalFolded {
			t.Fatal("final input/output preview did not fold", frame)
		}
		frame = capture("feedback-final")
		if !strings.Contains(frame, "✓ 编辑反馈文件\n✓ 补齐第二项检查") || !strings.Contains(frame, "FEEDBACK_FINAL") {
			t.Error("folded tool briefs lost order/compact spacing or final body", frame)
		}
		send("\x1b1")
		time.Sleep(200 * time.Millisecond)
		frame = capture("feedback-no-completed-history")
		if strings.Contains(frame, "FEEDBACK_TOOL_OUTPUT") || !strings.Contains(frame, "FEEDBACK_FINAL") {
			t.Error("completed tool reopened as history", frame)
		}
		first := <-allRequests
		second := <-allRequests
		if !strings.Contains(first, "FAST_ORIGINAL") || !strings.Contains(second, "FAST_ORIGINAL") || !strings.Contains(second, "SUPPLEMENT_KEEP_ORIGINAL") {
			t.Errorf("same task retained original=%t supplement=%t", strings.Contains(second, "FAST_ORIGINAL"), strings.Contains(second, "SUPPLEMENT_KEEP_ORIGINAL"))
		}
		if strings.Count(second, "SUPPLEMENT_KEEP_ORIGINAL") != 1 {
			t.Error("supplement absent or duplicated")
		}
		if calls.Load() != 3 {
			t.Errorf("unexpected provider calls %d", calls.Load())
		}
		send("\x11")
		wait("CONSOLE_MODES_RESTORED", 0)
		wait("CONSOLE_MAIN_BUFFER_EXITED", 0)
		if !strings.Contains(text(), "CLI_SHELL_BUFFER_BEFORE") {
			t.Fatal("ConPTY lost original shell stream")
		}
		if !t.Failed() {
			t.Log("actual executable: rapid Enter, busy steering, same objective, two actual tool writes, details/fold/retirement, sustained bounded status, three resizes, Markdown and native console restoration passed; synthetic provider only")
		}
		return
	}
	captureFlow := func(label string) string {
		t.Helper()
		if e := os.WriteFile(filepath.Join(screenDir, "request"), []byte(label), 0600); e != nil {
			t.Fatal(e)
		}
		until := time.Now().Add(3 * time.Second)
		for time.Now().Before(until) {
			if data, e := os.ReadFile(filepath.Join(screenDir, label+".json")); e == nil {
				if dir := os.Getenv("AIEYRA_CLI_TEST_OUT"); dir != "" {
					os.MkdirAll(dir, 0700)
					os.WriteFile(filepath.Join(dir, label+".json"), data, 0600)
				}
				var frame struct{ Text string }
				if json.Unmarshal(data, &frame) != nil {
					t.Fatal("bad native flow frame")
				}
				return frame.Text
			}
			time.Sleep(20 * time.Millisecond)
		}
		t.Fatal("native flow capture timed out")
		return ""
	}
	if entry == "cli-api" {
		runCLIAPINativeObservations(t, cfg, send, text, wait, captureFlow, func(size windows.Coord) {
			markNativeStage()
			if err := windows.ResizePseudoConsole(pc, size); err != nil {
				t.Fatal(err)
			}
		}, &calls, &startupCalls, &catalogCalls, pi.ProcessId)
		result, err := windows.WaitForSingleObject(pi.Process, 10000)
		if err != nil || result != windows.WAIT_OBJECT_0 {
			t.Fatal("API CLI did not exit", result, err)
		}
		var code uint32
		windows.GetExitCodeProcess(pi.Process, &code)
		if code != 0 {
			t.Fatal("API CLI exit", code)
		}
		return
	}
	send("/")
	wait("Eyra · idle", 0)
	time.Sleep(150 * time.Millisecond)
	bareSlash := captureFlow("flow-bare-slash")
	if !strings.Contains(bareSlash, "任务 ·") || !strings.Contains(bareSlash, "Eyra · idle") || strings.Contains(bareSlash, "Eyra API ·") {
		t.Fatal("bare slash did not retain the task menu", bareSlash)
	}
	// Native arrows/Tab select the single primary. API requires the full command.
	send("\x1b[B\t")
	time.Sleep(150 * time.Millisecond)
	for _, r := range "/api" {
		send(string(r))
		time.Sleep(80 * time.Millisecond)
	}
	send("\r")
	wait("与 Aieyra OS 共用配置", 0)
	send("\x1b")
	time.Sleep(100 * time.Millisecond)
	send("\x15")
	send("\x1b[200~" + payload + "\x1b[201~")
	wait("已粘贴", 0)
	if calls.Load() != 0 {
		t.Fatal("paste automatically submitted")
	}
	send("\r")
	wait("NATIVE-1-119", 0)
	if got := <-requests; got != payload {
		t.Fatalf("paste changed: got %q want %q", got, payload)
	}
	send("\x1b[5~\x1b[5~")
	time.Sleep(250 * time.Millisecond)
	frame := captureFlow("flow-scrolled")
	if !strings.Contains(frame, "正在回看") || !strings.Contains(frame, "NATIVE-1-") || strings.Contains(frame, "NATIVE-1-119") {
		t.Fatal("native main flow failed to page", frame)
	}
	send("\x1b[200~DRAFT_NATIVE 中文\x1b[201~")
	time.Sleep(120 * time.Millisecond)
	frame = captureFlow("flow-pinned-composer")
	rows := strings.Split(frame, "\n")
	if !strings.Contains(strings.Join(rows[max(0, len(rows)-4):], "\n"), "DRAFT_NATIVE") || !strings.Contains(frame, "正在回看") {
		t.Fatal("native composer scrolled with history", frame)
	}
	send("\x15\x1b[1;5F")
	time.Sleep(250 * time.Millisecond)
	frame = captureFlow("flow-latest")
	if !strings.Contains(frame, "NATIVE-1-119") || strings.Contains(frame, "正在回看") {
		t.Fatal("native return to latest failed", frame)
	}
	for _, size := range []windows.Coord{{X: 52, Y: 18}, {X: 120, Y: 36}, {X: 80, Y: 24}} {
		before := len(text())
		markNativeStage()
		if err = windows.ResizePseudoConsole(pc, size); err != nil {
			t.Fatal(err)
		}
		wait("NATIVE-1-119", before)
	}
	before := len(text())
	send("second")
	send("\n") // Ctrl+J must insert a newline, never submit.
	time.Sleep(100 * time.Millisecond)
	if calls.Load() != 1 {
		t.Fatal("Ctrl+J submitted")
	}
	second := "second\n\tUnicode 中文 👩‍💻 é ❤️\n"
	send("\x1b[200~\tUnicode 中文 👩‍💻 é ❤️\n\x1b[201~\r")
	wait("NATIVE-2-119", before)
	if got := <-requests; got != second {
		t.Fatalf("immediate Enter paste changed: got %q want %q", got, second)
	}
	before = len(text())
	// Injected whole-line text is a paste, not physical per-key typing. Keep
	// its explicit boundaries so the legacy unbracketed-paste guard cannot
	// treat this Enter as a newline within an in-progress paste.
	send("\x1b[200~native receipt test\x1b[201~\r")
	wait("NATIVE-4-119", before)
	for i := 0; i < 2; i++ {
		if got := <-requests; got != "native receipt test" {
			t.Fatalf("tool continuation changed prompt: %q", got)
		}
	}
	if data, err := os.ReadFile(filepath.Join(project, "native-receipt.txt")); err != nil || string(data) != "NATIVE_TOOL_DETAIL\n" {
		t.Fatal("native patch was not executed", string(data), err)
	}
	send("\x1bh")
	time.Sleep(200 * time.Millisecond)
	frame = captureFlow("flow-process-reopened")
	if !strings.Contains(frame, "过程") || !strings.Contains(frame, "修改文件 · 完成") {
		t.Fatal("native completed process failed to reopen", frame)
	}
	send("\x1br")
	time.Sleep(250 * time.Millisecond)
	frame = captureFlow("flow-original-receipt")
	if !strings.Contains(frame, "NATIVE_TOOL_DETAIL") {
		t.Fatal("native historical tool receipt failed", frame)
	}
	send("\x1b")
	time.Sleep(120 * time.Millisecond)
	send("\x1b")
	time.Sleep(120 * time.Millisecond)
	frame = captureFlow("flow-after-inspection")
	if !strings.Contains(frame, "NATIVE-4-119") || strings.Contains(frame, "当前没有运行中的任务") || calls.Load() != 4 {
		t.Fatal("inspection changed execution/cancelled", frame, calls.Load())
	}
	// Exercise the real executable's supervised children, then select them through
	// native terminal keys. The discovery token never enters test output.
	discovery, err := filepath.Glob(filepath.Join(filepath.Dir(cfg), "matrix-api", "*.json"))
	if err != nil || len(discovery) != 1 {
		t.Fatal("expected one primary core discovery", err, len(discovery))
	}
	data, err := os.ReadFile(discovery[0])
	if err != nil {
		t.Fatal(err)
	}
	var descriptor map[string]any
	if err = json.Unmarshal(data, &descriptor); err != nil {
		t.Fatal(err)
	}
	core := newClient(descriptor)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	create := func(title, task string) agent.AgentRecord {
		t.Helper()
		var record agent.AgentRecord
		if err := core.call(ctx, "agents.create", map[string]any{"request_id": title, "model_id": "test-model", "task": task, "title": title, "workdir": project, "tools": []string{}}, &record); err != nil {
			t.Fatal(err)
		}
		return record
	}
	child := create("SPLIT_ALPHA", "SPLIT_INITIAL")
	var finished agent.AgentRecord
	if err = core.call(ctx, "agents.wait", map[string]any{"id": child.ID, "timeout_ms": 5000}, &finished); err != nil || finished.State != "completed" {
		t.Fatal("split did not complete", err, finished.State)
	}
	if got := <-requests; got != "SPLIT_INITIAL" {
		t.Fatal("split received wrong initial task", got)
	}
	before = len(text())
	send("/")
	wait("SPLIT_ALPHA", before)
	send("\x1b[B\r")
	wait("NATIVE-5-119", before)
	before = len(text())
	send("\x1b[200~SPLIT_FOLLOWUP\x1b[201~\r")
	wait("NATIVE-6-119", before)
	if got := <-requests; got != "SPLIT_FOLLOWUP" {
		t.Fatal("split continuation went to wrong input", got)
	}
	if err = core.call(ctx, "agents.status", map[string]any{"id": child.ID}, &finished); err != nil || finished.Generation != 2 {
		t.Fatal("split generation did not advance", err, finished.Generation)
	}
	before = len(text())
	send("/")
	wait("SPLIT_ALPHA", before)
	send("\x1b[A\r")
	wait("NATIVE-4-119", before)
	hold := create("SPLIT_BETA", "SPLIT_HOLD_B")
	sibling := create("SPLIT_GAMMA", "SPLIT_HOLD_C")
	for range 2 {
		select {
		case <-requests:
		case <-ctx.Done():
			t.Fatal("split requests never started")
		}
	}
	before = len(text())
	send("/")
	wait("SPLIT_GAMMA", before)
	send("\x1b[B\x1b[B\r")
	time.Sleep(200 * time.Millisecond)
	send("\x1b")
	if err = core.call(ctx, "agents.wait", map[string]any{"id": hold.ID, "timeout_ms": 5000}, &finished); err != nil || finished.State != "cancelled" {
		t.Fatal("selected split was not cancelled", err, finished.State)
	}
	if err = core.call(ctx, "agents.status", map[string]any{"id": sibling.ID}, &finished); err != nil || finished.State != "running" {
		t.Fatal("cancelling selected split affected sibling", err, finished.State)
	}
	if err = core.call(ctx, "agents.cancel", map[string]any{"id": sibling.ID, "generation": 1}, nil); err != nil {
		t.Fatal(err)
	}
	var primary struct{ Messages []struct{ Text string } }
	if err = core.call(ctx, "workspace.snapshot", nil, &primary); err != nil {
		t.Fatal(err)
	}
	for _, item := range primary.Messages {
		if strings.Contains(item.Text, "SPLIT_") {
			t.Fatal("split conversation leaked into primary")
		}
	}
	before = len(text())
	send("/")
	wait("SPLIT_BETA", before)
	send("\x1b[A\x1b[A\r")
	wait("NATIVE-4-119", before)
	// Completed calls have retired; Alt+1 cannot reopen their historical detail.
	send("\x1b1")
	before = len(text())
	// Also cover ordinary typed slash commands, at physical key cadence.
	for _, r := range "/api" {
		send(string(r))
		time.Sleep(80 * time.Millisecond)
	}
	send("\r")
	wait("与 Aieyra OS 共用配置", before)
	send("\x1b")
	time.Sleep(100 * time.Millisecond)
	send("\x15")
	send("\x11")
	result, err := windows.WaitForSingleObject(pi.Process, 10000)
	if err != nil || result != windows.WAIT_OBJECT_0 {
		t.Fatal("CLI did not exit", result, err)
	}
	var code uint32
	windows.GetExitCodeProcess(pi.Process, &code)
	if code != 0 {
		t.Fatal("exit", code)
	}
	if calls.Load() != 8 {
		t.Fatal("unexpected provider requests", calls.Load())
	}
	wait("CONSOLE_MODES_RESTORED", 0)
	// Validate preserved shell content and restored modes in the native bridge.
	wait("CONSOLE_MAIN_BUFFER_EXITED", 0)
	if !strings.Contains(text(), "CLI_SHELL_BUFFER_BEFORE") {
		t.Fatal("ConPTY lost original shell stream")
	}
	files, err := filepath.Glob(filepath.Join(filepath.Dir(cfg), "cli", "workspaces", "*", "workspace.json"))
	if err != nil || len(files) != 0 {
		t.Fatal("ordinary CLI history was persisted", files, err)
	}
	_, _, err = runTest(t, []string{"sessions", "--config", cfg}, "")
	if err == nil || !strings.Contains(err.Error(), "retired") {
		t.Fatal("ordinary saved-session menu survived", err)
	}
	if startupCalls.Load() != 1 {
		t.Fatal("startup was not exactly once", startupCalls.Load())
	}
	t.Log("real CLI: shared primary and split tasks, explicit /api, exact Unicode/tab/multiline paste, Ctrl+J, immediate Enter, actual patch, long replies, resizes, anchored flow scrolling, pinned composer, reopened process/original receipt, graceful exit and console restoration; synthetic provider only")
}

// Connect the owned shell to ConPTY before launching the real CLI. A test parent
// has redirected handles; inheriting them would bypass ConPTY altogether.
func TestCLIConPTYBridge(t *testing.T) {
	a := os.Args
	if len(a) < 5 || a[len(a)-4] != "cli-conpty" {
		t.Skip("internal ConPTY shell helper")
	}
	in, err := os.OpenFile("CONIN$", os.O_RDWR, 0)
	if err != nil {
		os.Exit(91)
	}
	out, err := os.OpenFile("CONOUT$", os.O_RDWR, 0)
	if err != nil {
		os.Exit(92)
	}
	args := []string{"chat", "--config", a[len(a)-2], "--workdir", a[len(a)-1]}
	switch os.Getenv("AIEYRA_CLI_TEST_ENTRY") {
	case "os":
		args = []string{"-direct-tui", "-config", a[len(a)-2], "-workdir", a[len(a)-1]}
	case "config":
		args = []string{"-tui", "-config", a[len(a)-2]}
	}
	cmd := exec.Command(a[len(a)-3], args...)
	var inputMode, outputMode uint32
	if windows.GetConsoleMode(windows.Handle(in.Fd()), &inputMode) != nil || windows.GetConsoleMode(windows.Handle(out.Fd()), &outputMode) != nil {
		os.Exit(94)
	}
	cmd.Stdin, cmd.Stdout, cmd.Stderr = in, out, out
	const shellMarker = "CLI_SHELL_BUFFER_BEFORE"
	if _, err := fmt.Fprintln(out, shellMarker); err != nil {
		os.Exit(96)
	}
	readShellMarker := func() string {
		buf := make([]uint16, len(shellMarker))
		var count uint32
		ok, _, _ := windows.NewLazySystemDLL("kernel32.dll").NewProc("ReadConsoleOutputCharacterW").Call(
			out.Fd(), uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)), 0, uintptr(unsafe.Pointer(&count)))
		if ok == 0 {
			os.Exit(97)
		}
		return windows.UTF16ToString(buf[:count])
	}
	if readShellMarker() != shellMarker {
		os.Exit(98)
	}
	if dir := os.Getenv("AIEYRA_CLI_SCREEN_DIR"); dir != "" {
		go captureCLIScreens(dir)
	}
	if err := cmd.Run(); err != nil {
		fmt.Fprintln(out, err)
		os.Exit(93)
	}
	var inputAfter, outputAfter uint32
	if windows.GetConsoleMode(windows.Handle(in.Fd()), &inputAfter) != nil || windows.GetConsoleMode(windows.Handle(out.Fd()), &outputAfter) != nil || inputAfter != inputMode || outputAfter != outputMode {
		fmt.Fprintf(out, "console modes before %x/%x after %x/%x\n", inputMode, outputMode, inputAfter, outputAfter)
		os.Exit(95)
	}
	// ConPTY's server exposes only its live viewport through console APIs.
	// Scrolled rows live in the terminal frontend, not at coordinate (0,0).
	// The parent verifies the preserved shell stream; the independent hidden
	// classic-console test verifies actual scrollback cells and scrollbar range.
	fmt.Fprintln(out, "CONSOLE_MODES_RESTORED")
	fmt.Fprintln(out, "CONSOLE_MAIN_BUFFER_EXITED")
	os.Exit(0)
}

func captureCLIScreens(dir string) {
	last := ""
	for {
		time.Sleep(20 * time.Millisecond)
		data, e := os.ReadFile(filepath.Join(dir, "request"))
		if e != nil || string(data) == last {
			continue
		}
		label := string(data)
		if filepath.Base(label) != label {
			continue
		}
		active, e := os.OpenFile("CONOUT$", os.O_RDWR, 0)
		if e != nil {
			continue
		}
		h := windows.Handle(active.Fd())
		var n windows.ConsoleScreenBufferInfo
		if windows.GetConsoleScreenBufferInfo(h, &n) != nil {
			active.Close()
			continue
		}
		var cursorInfo struct {
			Size    uint32
			Visible int32
		}
		var cursorVisible *bool
		if ok, _, _ := windows.NewLazySystemDLL("kernel32.dll").NewProc("GetConsoleCursorInfo").Call(uintptr(h), uintptr(unsafe.Pointer(&cursorInfo))); ok != 0 {
			visible := cursorInfo.Visible != 0
			cursorVisible = &visible
		}
		var rows []string
		var attributes, characters [][]uint16
		valid := true
		for y := n.Window.Top; y <= n.Window.Bottom; y++ {
			// 逐行按原生 cell 读取；宽字符不能用整屏 UTF-16 字符数切行。
			type charInfo struct {
				Char       uint16
				Attributes uint16
			}
			width := int(n.Window.Right - n.Window.Left + 1)
			cells := make([]charInfo, width)
			region := windows.SmallRect{Left: n.Window.Left, Top: y, Right: n.Window.Right, Bottom: y}
			ok, _, _ := windows.NewLazySystemDLL("kernel32.dll").NewProc("ReadConsoleOutputW").Call(uintptr(h), uintptr(unsafe.Pointer(&cells[0])), uintptr(uint32(width)|1<<16), 0, uintptr(unsafe.Pointer(&region)))
			if ok == 0 {
				valid = false
				break
			}
			var chars []uint16
			var attrs, raw []uint16
			for _, cell := range cells {
				attrs = append(attrs, cell.Attributes)
				raw = append(raw, cell.Char)
				if cell.Attributes&0x0200 == 0 || cell.Char >= 0xdc00 && cell.Char <= 0xdfff {
					chars = append(chars, cell.Char)
				}
			}
			rows = append(rows, strings.TrimRight(windows.UTF16ToString(chars), " "))
			attributes = append(attributes, attrs)
			characters = append(characters, raw)
		}
		active.Close()
		if !valid {
			continue
		}
		encoded, _ := json.MarshalIndent(map[string]any{"text": strings.Join(rows, "\n"), "width": n.Size.X, "height": n.Size.Y, "viewport": n.Window, "cursor": n.CursorPosition, "cursor_visible": cursorVisible, "characters": characters, "attributes": attributes, "captured_at": time.Now().UTC()}, "", "  ")
		tmp := filepath.Join(dir, label+".tmp")
		if os.WriteFile(tmp, encoded, 0600) == nil {
			if os.Rename(tmp, filepath.Join(dir, label+".json")) == nil {
				last = label
			}
		}
	}
}

func startCLIProcess(t *testing.T, command, cwd *uint16, startup *windows.StartupInfo) (windows.ProcessInformation, windows.Handle) {
	t.Helper()
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	limits := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err = windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&limits)), uint32(unsafe.Sizeof(limits))); err != nil {
		windows.CloseHandle(job)
		t.Fatal(err)
	}
	var pi windows.ProcessInformation
	err = windows.CreateProcess(nil, command, nil, nil, false, windows.EXTENDED_STARTUPINFO_PRESENT|windows.CREATE_SUSPENDED, nil, cwd, startup, &pi)
	if err == nil {
		err = windows.AssignProcessToJobObject(job, pi.Process)
	}
	if err == nil {
		_, err = windows.ResumeThread(pi.Thread)
	}
	if err != nil {
		if pi.Process != 0 {
			windows.TerminateProcess(pi.Process, 1)
			windows.CloseHandle(pi.Process)
			windows.CloseHandle(pi.Thread)
		}
		windows.CloseHandle(job)
		t.Fatal(err)
	}
	return pi, job
}
