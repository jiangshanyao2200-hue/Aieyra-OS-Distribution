// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: BenchmarkShellSearchSnapshots; TestShellHelper; TestShellWaitTimeoutGuidancePreservesExecution; shellTestManager; shellTestCommand; shellDone; TestShellRealExitEncodingAndStreams; TestShellWindowsPythonPreservesUnicodeOutput; TestShellOutputBudgetAndReadWithoutRerun; TestShellSummaryPreservesUTF8AndExactOmittedOffsets; TestShellYieldInputTimeoutAndCancellation; TestShellCallReplayAndInterruptedRecovery; TestShellCatastrophicBoundary; TestShellOutputControlSequencesAndQuota; TestShellInteractiveTerminalAndIndependentCancel; TestShellTTYJSONCarriageReturnAndLiteralEscape; TestShellExplicitEnterPreservesCharsAndRejectsPipes; TestShellContextBudgetIsExplicit; TestShellReadCoalescesBurstWithoutWaitingForExit; TestShellFrameSnapshotNeverWaitsForWorkerLocks; TestShellUnsettledStopsRestoreAsInterrupted; TestShellSlotsReleaseAfterFailedStartAndConcurrentClose; TestShellLongScriptUsesOwnedFileAndDoesNotEchoArguments; TestShellLogPagesPreserveUTF8; TestBackgroundBudgetLeavesDispatchAvailable; TestShellYieldCapsLongWaits
// Impact: python -B scripts/code-atlas.py show Core/shell_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/CORE/tools"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/charmbracelet/x/term"
)

func BenchmarkShellSearchSnapshots(b *testing.B) {
	rg, err := exec.LookPath("rg")
	if err != nil {
		b.Skip("rg is required for the search fixture")
	}
	root := b.TempDir()
	if base := os.Getenv("AIEYRA_SEARCH_FIXTURE_ROOT"); base != "" {
		root, err = os.MkdirTemp(base, "search-snapshots-")
		if err != nil {
			b.Fatal(err)
		}
		b.Cleanup(func() { os.RemoveAll(root) })
	}
	for i := range 256 {
		ext := "txt"
		heading := "search_marker"
		if i%2 == 0 {
			ext = "log"
		}
		path := filepath.Join(root, fmt.Sprintf("fixture-%03d.%s", i, ext))
		if err := os.WriteFile(path, []byte(strings.Repeat(heading+" 中文 output\n", 32)), 0600); err != nil {
			b.Fatal(err)
		}
	}
	command := exec.Command(rg, "--no-config", "--sort", "path", "--color", "always", "-n", "-g", "*.txt", "search_marker", ".")
	command.Dir = root
	out, err := command.Output()
	if err != nil {
		b.Fatal(err)
	}
	if got := strings.Count(string(out), "search_marker"); got != 4096 {
		b.Fatalf("matches = %d, want 4096", got)
	}
	const jobs = 32
	m := &ShellManager{jobs: make(map[int]*shellJob, jobs)}
	for i := range jobs {
		m.jobs[i] = &shellJob{result: ShellResult{SessionID: i + 1, OutputBytes: int64(len(out)), StartedAt: time.Unix(int64(i), 0)}, tail: out}
	}
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		rows, ok := m.TrySnapshots()
		if !ok || len(rows) != jobs || rows[0].SessionID != 1 || rows[0].Output == "" {
			b.Fatal("invalid ordered snapshot")
		}
	}
}

// 只执行本次测试生成的子进程，绝不触碰用户窗口、剪贴板和个人目录。
func TestShellHelper(t *testing.T) {
	if os.Getenv("AIEYRA_SHELL_TEST_HELPER") != "1" {
		return
	}
	mode := os.Args[len(os.Args)-1]
	switch mode {
	case "output":
		fmt.Fprintln(os.Stdout, "stdout 中文 ✓")
		fmt.Fprintln(os.Stderr, "stderr diagnostic")
		os.Exit(7)
	case "large":
		fmt.Print("HEAD-DIAGNOSTIC\n" + strings.Repeat("payload line 中文\n", 20000) + "TAIL-DIAGNOSTIC\n")
		os.Exit(0)
	case "wait":
		fmt.Println("STARTED")
		time.Sleep(10 * time.Second)
		fmt.Println("FINISHED")
		os.Exit(0)
	case "burst":
		// 等待测试方一次输入后才连续输出，保证不会在 start 阶段被提前读取。
		var line string
		fmt.Scanln(&line)
		for i := 0; i < 5; i++ {
			fmt.Printf("part-%d\n", i)
			time.Sleep(10 * time.Millisecond)
		}
		time.Sleep(2 * time.Second)
		os.Exit(0)
	case "input":
		var line string
		fmt.Fprintln(os.Stdout, "READY")
		fmt.Scanln(&line)
		fmt.Println("INPUT=" + line)
		os.Exit(0)
	case "input_lines", "terminal_size":
		scanner := bufio.NewScanner(os.Stdin)
		for scanner.Scan() {
			line := scanner.Text()
			fmt.Println("INPUT=" + line)
			if mode == "terminal_size" {
				columns, rows, err := term.GetSize(os.Stdout.Fd())
				fmt.Printf("SIZE=%dx%d ERROR=%v TERM=%s\n", columns, rows, err, os.Getenv("TERM"))
			}
			if line == "quit" {
				os.Exit(0)
			}
		}
		os.Exit(0)
	case "parallel":
		id := os.Getenv("AIEYRA_PARALLEL_ID")
		if err := os.WriteFile(id+".started", []byte("started"), 0600); err != nil {
			os.Exit(12)
		}
		deadline := time.Now().Add(5 * time.Second)
		for {
			files, _ := filepath.Glob("*.started")
			if len(files) >= 4 {
				break
			}
			if time.Now().After(deadline) {
				os.Exit(13)
			}
			time.Sleep(10 * time.Millisecond)
		}
		if id == "0" {
			time.Sleep(200 * time.Millisecond)
		}
		fmt.Print("result-" + id)
		os.Exit(0)
	case "rolling":
		id := os.Getenv("AIEYRA_PARALLEL_ID")
		if err := os.WriteFile(id+".started", []byte("started"), 0600); err != nil {
			os.Exit(12)
		}
		// 第一项依赖第五项启动来放行：固定四项整批等待会在这里死等。
		if id == "0" {
			deadline := time.Now().Add(4 * time.Second)
			for {
				if _, err := os.Stat("4.started"); err == nil {
					break
				}
				if time.Now().After(deadline) {
					os.Exit(13)
				}
				time.Sleep(10 * time.Millisecond)
			}
		}
		fmt.Print("result-" + id)
		os.Exit(0)
	case "file":
		f, e := os.OpenFile("effect.txt", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
		if e != nil {
			os.Exit(2)
		}
		io.WriteString(f, "once\n")
		f.Close()
		fmt.Println("effect saved")
		os.Exit(0)
	default:
		os.Exit(3)
	}
}

func TestShellWaitTimeoutGuidancePreservesExecution(t *testing.T) {
	m := shellTestManager(t)
	zero := 0
	req := shellTestCommand(t, "input")
	req.YieldTimeMS = &zero
	r := m.start(context.Background(), req)
	if !r.OK || r.SessionID == 0 {
		t.Fatal("helper did not start", r)
	}
	call := func(args string) ShellResult {
		return m.Execute(context.Background(), ToolCall{Function: FunctionCall{Name: "write_stdin", Arguments: args}})
	}
	bad := call(fmt.Sprintf(`{"session_id":%d,"chars":"wrong\n","terminate":true,"timeout_ms":1000}`, r.SessionID))
	if bad.OK || bad.Error == nil || bad.Error.Code != "invalid_arguments" || !strings.Contains(bad.Error.Message, "yield_time_ms") || !strings.Contains(bad.Error.Message, "不要重新执行命令") {
		t.Fatalf("wait recovery guidance missing: %+v", bad)
	}
	waited := call(fmt.Sprintf(`{"session_id":%d,"yield_time_ms":0}`, r.SessionID))
	if !waited.OK || waited.State != "running" {
		t.Fatalf("rejected call affected existing execution: %+v", waited)
	}
	done := shellDone(t, m, call(fmt.Sprintf(`{"session_id":%d,"chars":"correct\n","yield_time_ms":1000}`, r.SessionID)))
	if done.ExitCode == nil || *done.ExitCode != 0 || !strings.Contains(done.Output, "INPUT=correct") || strings.Contains(done.Output, "wrong") {
		t.Fatalf("rejected call wrote input or stopped the process: %+v", done)
	}
}

func shellTestManager(t *testing.T) *ShellManager {
	t.Helper()
	dir := t.TempDir()
	m, err := NewShellManager(dir, filepath.Join(dir, "logs"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	return m
}
func shellTestCommand(t *testing.T, mode string) ShellCommand {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	quoted := "'" + strings.ReplaceAll(exe, "'", "''") + "'"
	cmd := "& " + quoted + " '-test.run=^TestShellHelper$' -- " + mode + "; exit $LASTEXITCODE"
	if runtime.GOOS != "windows" {
		cmd = quoted + " '-test.run=^TestShellHelper$' -- " + mode
	}
	return ShellCommand{Cmd: cmd, Env: map[string]string{"AIEYRA_SHELL_TEST_HELPER": "1"}}
}
func shellDone(t *testing.T, m *ShellManager, r ShellResult) ShellResult {
	t.Helper()
	deadline := time.Now().Add(12 * time.Second)
	var out strings.Builder
	out.WriteString(r.Output)
	for r.State == "running" || r.State == "starting" || r.ExitCode == nil && (r.State == "cancelled" || r.State == "timed_out") {
		if time.Now().After(deadline) {
			t.Fatal("execution did not settle", r)
		}
		wait := 1000
		r = m.input(context.Background(), ShellInput{SessionID: r.SessionID, YieldTimeMS: &wait})
		out.WriteString(r.Output)
	}
	r.Output = out.String()
	return r
}

func TestShellRealExitEncodingAndStreams(t *testing.T) {
	m := shellTestManager(t)
	r := shellDone(t, m, m.start(context.Background(), shellTestCommand(t, "output")))
	if !r.OK || r.ExitCode == nil || *r.ExitCode != 7 || !strings.Contains(r.Output, "stdout 中文 ✓") || !strings.Contains(r.Output, "stderr diagnostic") {
		t.Fatalf("result: %+v", r)
	}
	data, err := os.ReadFile(r.OutputRef)
	if err != nil || !strings.Contains(string(data), "stdout 中文") {
		t.Fatal("log", err, string(data))
	}
}

func TestShellWindowsPythonPreservesUnicodeOutput(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows redirected console encoding")
	}
	python, err := exec.LookPath("python.exe")
	if err != nil {
		t.Skip("Python is required for the encoding regression")
	}
	t.Setenv("PYTHONIOENCODING", "")
	if err := os.Unsetenv("PYTHONIOENCODING"); err != nil {
		t.Fatal(err)
	}
	m := shellTestManager(t)
	cmd := "& '" + strings.ReplaceAll(python, "'", "''") + "' -c "
	r := shellDone(t, m, m.start(context.Background(), ShellCommand{Cmd: cmd + `'import sys; print("\u9e48\u9e55.html"); print("\u81ea\u884c\u8f66", file=sys.stderr)'`}))
	if !r.OK || r.ExitCode == nil || *r.ExitCode != 0 || !strings.Contains(r.Output, "鹈鹕.html") || !strings.Contains(r.Output, "自行车") {
		t.Fatalf("Python Unicode output: %+v", r)
	}
	r = shellDone(t, m, m.start(context.Background(), ShellCommand{
		Cmd: cmd + `'import sys; print(sys.stdout.encoding)'`, Env: map[string]string{"PYTHONIOENCODING": "cp1252"},
	}))
	if !r.OK || r.ExitCode == nil || *r.ExitCode != 0 || strings.TrimSpace(r.Output) != "cp1252" {
		t.Fatalf("Python encoding override: %+v", r)
	}
}

func TestShellOutputBudgetAndReadWithoutRerun(t *testing.T) {
	m := shellTestManager(t)
	req := shellTestCommand(t, "large")
	req.MaxOutputTokens = 128
	wait := 30000
	req.YieldTimeMS = &wait
	r := m.start(context.Background(), req)
	if r.State != "exited" || !r.Truncated || !strings.Contains(r.Output, "HEAD-DIAGNOSTIC") || !strings.Contains(r.Output, "TAIL-DIAGNOSTIC") || len(r.Output) > 128*3 {
		t.Fatalf("budget: %+v", r)
	}
	page := m.read(ShellRead{SessionID: r.SessionID, Offset: 1000, MaxOutputTokens: 50})
	if !page.OK || page.NextOffset <= 1000 || page.NextOffset > 1150 || !page.Truncated || len(page.Output) > 150 || !utf8.ValidString(page.Output) {
		t.Fatalf("page: %+v", page)
	}
	again := m.input(context.Background(), ShellInput{SessionID: r.SessionID})
	if again.Output != "" || again.ExitCode == nil {
		t.Fatalf("poll duplicated output: %+v", again)
	}
}

func TestShellSummaryPreservesUTF8AndExactOmittedOffsets(t *testing.T) {
	text := "HEAD\n" + strings.Repeat("中文🙂abc\n", 7000) + "TAIL\n"
	file := filepath.Join(t.TempDir(), "stdout.log")
	if err := os.WriteFile(file, []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	j := &shellJob{result: ShellResult{OK: true, SessionID: 17, State: "exited", OutputRef: file, LoggedBytes: int64(len(text)), OutputBytes: int64(len(text))}}
	for _, tokens := range []int{100, 101, 102, 103, 104, 105, 106, 107, 8000} {
		r := j.snapshot(tokens, false)
		if !r.Truncated || !utf8.ValidString(r.Output) || strings.ContainsRune(r.Output, '�') || len(r.Output) > tokens*3 {
			t.Fatalf("tokens %d damaged the bounded summary: %q", tokens, r.Output)
		}
		parts := strings.SplitN(r.Output, "\n… omitted bytes ", 2)
		if len(parts) != 2 {
			t.Fatal("missing omitted range")
		}
		var first, last, session, offset int
		n, err := fmt.Sscanf(parts[1], "%d–%d; use read_shell_output(session_id=%d, offset=%d)", &first, &last, &session, &offset)
		if err != nil || n != 4 || session != 17 || offset != first || first <= 0 || last <= first || last >= len(text) {
			t.Fatalf("invalid omitted range: %q", parts[1])
		}
		if !utf8.RuneStart(text[first]) || !utf8.RuneStart(text[last]) || parts[0] != text[:first] || !strings.HasSuffix(r.Output, text[last:]) {
			t.Fatalf("tokens %d did not preserve the exact original prefix/suffix at %d/%d", tokens, first, last)
		}
	}
	data, err := os.ReadFile(file)
	if err != nil || string(data) != text {
		t.Fatal("summary changed the original stdout log", err)
	}
}

func TestShellYieldInputTimeoutAndCancellation(t *testing.T) {
	m := shellTestManager(t)
	zero := 0
	req := shellTestCommand(t, "input")
	req.YieldTimeMS = &zero
	r := m.start(context.Background(), req)
	if r.State != "running" || r.ExitCode != nil {
		t.Fatalf("yield: %+v", r)
	}
	r = shellDone(t, m, m.input(context.Background(), ShellInput{SessionID: r.SessionID, Chars: "hello\n"}))
	if !strings.Contains(r.Output, "INPUT=hello") || r.ExitCode == nil || *r.ExitCode != 0 {
		t.Fatalf("input: %+v", r)
	}
	req = shellTestCommand(t, "wait")
	req.YieldTimeMS = &zero
	r = m.start(context.Background(), req)
	r = shellDone(t, m, m.input(context.Background(), ShellInput{SessionID: r.SessionID, Terminate: true}))
	if r.State != "cancelled" {
		t.Fatalf("cancel: %+v", r)
	}
	limit := 250
	req = shellTestCommand(t, "wait")
	req.TimeoutMS = &limit
	r = shellDone(t, m, m.start(context.Background(), req))
	if r.State != "timed_out" {
		t.Fatalf("timeout: %+v", r)
	}
}

func TestShellCallReplayAndInterruptedRecovery(t *testing.T) {
	m := shellTestManager(t)
	req := shellTestCommand(t, "file")
	wait := 30000
	req.YieldTimeMS = &wait
	args, _ := json.Marshal(req)
	response := Message{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: "call-file", Function: FunctionCall{Name: "exec_command", Arguments: string(args)}}}}
	e := &PlanEngine{}
	var records []struct {
		kind  string
		value any
	}
	persist := func(kind string, value any) error {
		records = append(records, struct {
			kind  string
			value any
		}{kind, value})
		return nil
	}
	turn, err := ExecuteToolTurn(context.Background(), e, m, response, "response-file", persist)
	if err != nil {
		t.Fatal(err)
	}
	if len(turn.Receipts) != 1 {
		t.Fatal(turn)
	}
	replay, err := ExecuteToolTurn(context.Background(), e, m, response, "response-file", persist)
	if err != nil || !replay.Replayed {
		t.Fatal("replay", err, replay)
	}
	data, _ := os.ReadFile(filepath.Join(m.root, "effect.txt"))
	if string(data) != "once\n" {
		t.Fatal("duplicate effect", string(data))
	}
	config := filepath.Join(t.TempDir(), "config.json")
	archive, err := NewSessionArchive(config)
	if err != nil {
		t.Fatal(err)
	}
	if err = archive.Start("deepseek-flash"); err != nil {
		t.Fatal(err)
	}
	// 模拟收据已写但最终事务尚未提交的崩溃。
	for _, record := range records {
		if record.kind != "tool_turn" {
			if err = archive.Append(record.kind, record.value); err != nil {
				t.Fatal(err)
			}
		}
	}
	id := archive.ID()
	archive.Close()
	restored, state, err := RestoreSession(config, id)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	if state.RecoveredTool == nil || len(state.Messages) != 2 || len(state.Plan.Receipts) != 1 {
		t.Fatalf("recovery: %+v", state)
	}
	if err = ValidateToolTurn(*state.RecoveredTool); err != nil {
		t.Fatal(err)
	}
	unknown, err := interruptedToolTurn(ToolIntent{"uncertain", response}, nil)
	if err != nil || !strings.Contains(unknown.Messages[1].Content, "interrupted_unknown") {
		t.Fatal(unknown, err)
	}
}

func TestShellCatastrophicBoundary(t *testing.T) {
	root := t.TempDir()
	cwd := filepath.Join(root, "work")
	os.Mkdir(cwd, 0700)
	for _, command := range []string{`rm -rf /`, `rm -rf /*`, `rm -rf "$HOME"`, `Remove-Item -Recurse -Force C:\`, `cmd /c "rd /s /q C:\Users"`, `bash -c 'rm -rf /'`, `mkfs.ext4 /dev/sda`, `dd if=/dev/zero of=/dev/sda`, `format C:`, `Clear-Disk -Number 0`, `rm -rf .`, `rm -rf ./*`, `Remove-Item -Recurse -Force .\*.*`, `cd /; rm -rf .`} {
		if tools.CatastrophicCommand(command, root, root) == "" {
			t.Errorf("not blocked: %s", command)
		}
	}
	for _, command := range []string{`echo "rm -rf /"`, `rg 'rm -rf /' README.md`, `rm -rf ./build`, `Remove-Item -Recurse -Force .\node_modules`, `npm install`, `git reset --hard HEAD`, `python repair.py`, `curl https://example.com`, `dd if=/dev/zero of=./fixture.bin count=1`, `rm -rf ./cache*`} {
		if reason := tools.CatastrophicCommand(command, cwd, root); reason != "" {
			t.Errorf("false block: %s: %s", command, reason)
		}
	}
	for _, command := range []string{`rm -f *.tmp`, `Remove-Item -Force .\*.log`, `rm -rf ./*/build`, `rm -f ./[ab]*.tmp`} {
		if reason := tools.CatastrophicCommand(command, root, root); reason != "" {
			t.Errorf("targeted cleanup blocked in workspace: %s: %s", command, reason)
		}
	}
}

func TestShellOutputControlSequencesAndQuota(t *testing.T) {
	text := CleanShellText("safe\x1b]52;c;clipboard\a\x1b[2J\x1b[31mred\x1b[0m\rprogress\x00")
	if text != "safered\nprogress" {
		t.Fatalf("control leak %q", text)
	}
	m := shellTestManager(t)
	m.logBytes = shellSessionLimit
	r := shellDone(t, m, m.start(context.Background(), shellTestCommand(t, "output")))
	if !r.LogIncomplete || !strings.Contains(r.Output, "stdout 中文") || r.ExitCode == nil {
		t.Fatalf("quota blocked process: %+v", r)
	}
}

func TestShellInteractiveTerminalAndIndependentCancel(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows ConPTY")
	}
	m := shellTestManager(t)
	zero := 0
	req := shellTestCommand(t, "input")
	req.TTY = true
	req.YieldTimeMS = &zero
	r := m.start(context.Background(), req)
	if !r.OK || r.State != "running" {
		t.Fatalf("ConPTY start: %+v", r)
	}
	r = shellDone(t, m, m.input(context.Background(), ShellInput{SessionID: r.SessionID, Chars: "interactive\r"}))
	if r.ExitCode == nil || *r.ExitCode != 0 || !strings.Contains(r.Output, "INPUT=interactive") {
		t.Fatalf("ConPTY input: %+v", r)
	}
	req = shellTestCommand(t, "wait")
	req.YieldTimeMS = &zero
	a := m.start(context.Background(), req)
	b := m.start(context.Background(), req)
	m.input(context.Background(), ShellInput{SessionID: a.SessionID, Terminate: true})
	r = m.input(context.Background(), ShellInput{SessionID: b.SessionID, YieldTimeMS: &zero})
	if r.State != "running" {
		t.Fatalf("cancel affected independent process: %+v", r)
	}
}

func TestShellTTYJSONCarriageReturnAndLiteralEscape(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows ConPTY")
	}
	m := shellTestManager(t)
	zero := 0
	req := shellTestCommand(t, "input")
	req.TTY, req.YieldTimeMS = true, &zero
	r := m.start(context.Background(), req)
	call := func(charsJSON string) ShellResult {
		return m.Execute(context.Background(), ToolCall{Function: FunctionCall{Name: "write_stdin", Arguments: fmt.Sprintf(`{"session_id":%d,"chars":%s,"yield_time_ms":1000}`, r.SessionID, charsJSON)}})
	}
	// 双转义只发送原字节，不能被偷偷改成 Enter；观察提示解释实际输入。
	result := call(`"literal\\r"`)
	if !result.OK || result.State != "running" || result.InputNotice == "" {
		t.Fatalf("literal escape was changed or not explained: %+v", result)
	}
	result = shellDone(t, m, call(`"\u000d"`))
	if result.ExitCode == nil || *result.ExitCode != 0 || !strings.Contains(result.Output, `INPUT=literal\r`) || result.InputNotice != "" {
		t.Fatalf("JSON carriage return did not submit unchanged literal text: %+v", result)
	}
}

func TestShellExplicitEnterPreservesCharsAndRejectsPipes(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows ConPTY")
	}
	m := shellTestManager(t)
	zero := 0
	for _, tty := range []bool{false, true} {
		req := shellTestCommand(t, "input")
		req.TTY, req.YieldTimeMS = tty, &zero
		r := m.start(context.Background(), req)
		args, _ := json.Marshal(ShellInput{SessionID: r.SessionID, Chars: `literal\r`, PressEnter: true})
		result := m.Execute(context.Background(), ToolCall{Function: FunctionCall{Name: "write_stdin", Arguments: string(args)}})
		if !tty {
			if result.OK || result.Error == nil || result.Error.Code != "invalid_arguments" {
				t.Fatal("pipe accepted an implicit byte", result)
			}
			result = shellDone(t, m, m.input(context.Background(), ShellInput{SessionID: r.SessionID, Chars: "pipe\n"}))
			if !strings.Contains(result.Output, "INPUT=pipe") || strings.Contains(result.Output, "literal") {
				t.Fatal("rejected input had side effects", result)
			}
			continue
		}
		result = shellDone(t, m, result)
		if result.ExitCode == nil || *result.ExitCode != 0 || !strings.Contains(result.Output, `INPUT=literal\r`) {
			t.Fatal("explicit Enter changed chars or failed to submit", result)
		}
	}
	// 已经写入的文字只按 Enter，不重复输入。
	req := shellTestCommand(t, "input")
	req.TTY, req.YieldTimeMS = true, &zero
	r := m.start(context.Background(), req)
	m.input(context.Background(), ShellInput{SessionID: r.SessionID, Chars: "existing", YieldTimeMS: &zero})
	r = shellDone(t, m, m.input(context.Background(), ShellInput{SessionID: r.SessionID, PressEnter: true}))
	if !strings.Contains(r.Output, "INPUT=existing") {
		t.Fatal("Enter-only request did not submit existing input", r)
	}
}

func TestShellContextBudgetIsExplicit(t *testing.T) {
	m := shellTestManager(t)
	req := shellTestCommand(t, "large")
	wait := 30000
	req.YieldTimeMS = &wait
	args, _ := json.Marshal(req)
	r := m.Execute(WithShellOutputBudget(context.Background(), 100), ToolCall{Function: FunctionCall{Name: "exec_command", Arguments: string(args)}})
	if !r.BudgetReduced || r.OutputTokenBudget != 100 || len(r.Output) > 300 || !r.Truncated {
		t.Fatalf("context limit: %+v", r)
	}
}

func TestShellReadCoalescesBurstWithoutWaitingForExit(t *testing.T) {
	m := shellTestManager(t)
	req := shellTestCommand(t, "burst")
	zero := 0
	req.YieldTimeMS = &zero
	r := m.start(context.Background(), req)
	if !r.OK {
		t.Fatal(r)
	}
	r = m.input(context.Background(), ShellInput{SessionID: r.SessionID, Chars: "go\n"})
	if !r.OK || r.State != "running" || !strings.Contains(r.Output, "part-0") || !strings.Contains(r.Output, "part-4") {
		t.Fatalf("burst was split into tiny model polls or waited for exit: %+v", r)
	}
}

func TestShellFrameSnapshotNeverWaitsForWorkerLocks(t *testing.T) {
	m := shellTestManager(t)
	j := &shellJob{result: ShellResult{SessionID: 1, State: "running"}}
	m.jobs[1] = j
	defer delete(m.jobs, 1)
	for _, lock := range []*sync.Mutex{&m.mu, &j.mu} {
		lock.Lock()
		ready := make(chan bool, 1)
		go func() { _, ok := m.TrySnapshots(); ready <- ok }()
		select {
		case ok := <-ready:
			lock.Unlock()
			if ok {
				t.Fatal("busy worker lock returned a partial snapshot")
			}
		case <-time.After(time.Second):
			lock.Unlock()
			t.Fatal("UI snapshot blocked behind worker IO")
		}
	}
	if got, ok := m.TrySnapshots(); !ok || len(got) != 1 {
		t.Fatal("snapshot did not recover after worker unlocked")
	}
}

func TestShellUnsettledStopsRestoreAsInterrupted(t *testing.T) {
	dir := t.TempDir()
	for i, state := range []string{"starting", "running", "cancelled", "timed_out"} {
		data, _ := json.Marshal(ShellResult{OK: true, SessionID: i + 1, State: state})
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("%d.json", i+1)), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	m, err := NewShellManager(dir, dir)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	for _, r := range m.Snapshots() {
		if r.Pending() || r.State != "interrupted_unknown" || r.OK || r.Error == nil {
			t.Fatal("restored orphan appears active:", r)
		}
	}
}

func TestShellSlotsReleaseAfterFailedStartAndConcurrentClose(t *testing.T) {
	m := shellTestManager(t)
	invalid := filepath.Join(m.root, "invalid-shell.exe")
	if runtime.GOOS != "windows" {
		invalid = filepath.Join(m.root, "invalid-shell")
	}
	if err := os.WriteFile(invalid, []byte("not an executable"), 0700); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < ShellMaxProcesses+1; i++ {
		r := m.start(context.Background(), ShellCommand{Cmd: "fixture", Shell: invalid})
		if r.State != "spawn_failed" || r.SessionID == 0 {
			t.Fatal("failed process start leaked a slot:", r)
		}
	}
	var started sync.WaitGroup
	zero := 0
	req := shellTestCommand(t, "wait")
	req.YieldTimeMS = &zero
	if r := m.start(context.Background(), req); !r.OK || !r.Pending() {
		t.Fatal("could not start owned process before close:", r)
	}
	for i := 1; i < ShellMaxProcesses; i++ {
		started.Add(1)
		go func() {
			defer started.Done()
			m.start(context.Background(), req)
		}()
	}
	m.Close()
	started.Wait()
	m.mu.Lock()
	active, closed := m.active, m.closed
	m.mu.Unlock()
	if active != 0 || !closed {
		t.Fatalf("close leaked active reservations: %d, closed %t", active, closed)
	}
	for _, r := range m.Snapshots() {
		if r.Pending() {
			t.Fatal("close left an owned process running:", r)
		}
	}
}

func TestShellLongScriptUsesOwnedFileAndDoesNotEchoArguments(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows command line limit")
	}
	m := shellTestManager(t)
	req := shellTestCommand(t, "output")
	req.Cmd = strings.Repeat("# 长脚本参数保留原样\n", 3000) + req.Cmd
	wait := 30000
	req.YieldTimeMS = &wait
	args, _ := json.Marshal(req)
	r := m.Execute(context.Background(), ToolCall{Function: FunctionCall{Name: "exec_command", Arguments: string(args)}})
	if !r.OK || r.ExitCode == nil || *r.ExitCode != 7 || !strings.Contains(r.Output, "stdout 中文") || r.Cmd != "" {
		t.Fatalf("long script: %+v", r)
	}
	if len(m.Snapshots()[0].Cmd) != len(req.Cmd) {
		t.Fatal("saved command was truncated")
	}
}

func TestShellLogPagesPreserveUTF8(t *testing.T) {
	m := shellTestManager(t)
	r := shellDone(t, m, m.start(context.Background(), shellTestCommand(t, "output")))
	var text strings.Builder
	offset := int64(0)
	for offset < r.LoggedBytes {
		page := m.read(ShellRead{SessionID: r.SessionID, Offset: offset, MaxOutputTokens: 5})
		if !page.OK || page.NextOffset <= offset || !utf8.ValidString(page.Output) || strings.ContainsRune(page.Output, '�') {
			t.Fatalf("broken page: %+v", page)
		}
		text.WriteString(page.Output)
		offset = page.NextOffset
	}
	data, _ := os.ReadFile(r.OutputRef)
	if text.String() != CleanShellText(string(data)) {
		t.Fatalf("paging lost text: %q", text.String())
	}
}

func TestBackgroundBudgetLeavesDispatchAvailable(t *testing.T) {
	m := shellTestManager(t)
	zero := 0
	for i := 0; i < ShellDispatchLimit+1; i++ {
		req := shellTestCommand(t, "input_lines")
		req.YieldTimeMS = &zero
		r := m.start(context.Background(), req)
		if !r.OK || !r.Pending() {
			t.Fatalf("background %d: %+v", i, r)
		}
	}
	req := shellTestCommand(t, "file")
	wait := 5000
	req.YieldTimeMS = &wait
	r := m.start(context.Background(), req)
	if r.ExitCode == nil || *r.ExitCode != 0 {
		t.Fatalf("background blocked foreground: %+v", r)
	}
	if ShellMaxProcesses <= ShellDispatchLimit {
		t.Fatal("dispatch and persistent budget coupled")
	}
}

// R45：yield_time_ms 超上限曾直接拒绝、浪费一轮；等待只决定多久返回，按 30 秒封顶，负数仍拒绝。
func TestShellYieldCapsLongWaits(t *testing.T) {
	long, negative := 120000, -1
	if d, err := shellYield(&long, 1000); err != nil || d != 30*time.Second {
		t.Fatalf("超长等待应封顶 30s: %v %v", d, err)
	}
	if _, err := shellYield(&negative, 1000); err == nil {
		t.Fatal("负数等待应拒绝")
	}
	if d, _ := shellYield(nil, 5000); d != 5*time.Second {
		t.Fatalf("默认等待: %v", d)
	}
}
