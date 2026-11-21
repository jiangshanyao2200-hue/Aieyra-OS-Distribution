// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ShellCommand; ShellInput; ShellRead; ShellError; ShellResult; Pending; shellFailure; shellJob; ShellManager; NewShellManager; Environment; BackgroundNotice; Workdir; shellBudgetKey; WithShellOutputBudget; limitShellBudget; Execute; decodeShellArgs; shellTokens; shellYield; start; releaseProcess; run; stop; job; input; wait; Snapshots; TrySnapshots; snapshots; CancelAll; Close; persist; shellEnvironment; powerShellEncoding; shellArgs; shellArgsWithScript
// Impact: python -B scripts/code-atlas.py show Core/shell.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// Shell 的进程与日志归执行器所有；UI 只读取不可变快照，不能由子进程直接写终端。
import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/aieyra/aieyra-os/CORE/platform"
	"github.com/aieyra/aieyra-os/CORE/tools"
	terminaltool "github.com/aieyra/aieyra-os/tool/base/official/terminal"
	terminalcontract "github.com/aieyra/aieyra-os/tool/base/official/terminal/contract"
)

const (
	ShellDefaultTokens       = 8000
	ShellMaxTokens           = 32000
	ShellDispatchLimit       = 4
	ShellMaxProcesses        = 16
	shellLogLimit      int64 = 100 << 20
	shellSessionLimit  int64 = 1 << 30
	shellTailLimit           = 128 << 10
)

type ShellCommand = terminalcontract.Command
type ShellInput = terminalcontract.Input
type ShellRead = terminalcontract.Read

// Keep the established host type for persisted/display envelopes and positional
// construction; the public wire fields are owned by the terminal contract.
type ShellError terminalcontract.Error

type ShellResult struct {
	System            *ToolboxResult    `json:"system,omitempty"`
	Exec              *ExecResult       `json:"exec,omitempty"`
	Image             *ImageResult      `json:"image,omitempty"`
	File              *LegacyFileResult `json:"file,omitempty"`
	OK                bool              `json:"ok"`
	SessionID         int               `json:"session_id,omitempty"`
	Generation        int               `json:"generation,omitempty"`
	PrivateOutput     bool              `json:"private_output,omitempty"`
	InputID           string            `json:"input_id,omitempty"`
	InputState        string            `json:"input_state,omitempty"`
	InputClient       string            `json:"input_client,omitempty"`
	InputSequence     int               `json:"input_sequence,omitempty"`
	Columns           int               `json:"columns,omitempty"`
	Rows              int               `json:"rows,omitempty"`
	TerminalOutput    string            `json:"terminal_output,omitempty"`
	State             string            `json:"state"`
	ExitCode          *int              `json:"exit_code,omitempty"`
	Cmd               string            `json:"cmd,omitempty"`
	CmdNotice         string            `json:"cmd_notice,omitempty"`
	Description       string            `json:"description,omitempty"`
	Workdir           string            `json:"workdir,omitempty"`
	Shell             string            `json:"shell,omitempty"`
	TTY               bool              `json:"tty,omitempty"`
	Background        bool              `json:"background,omitempty"`
	StartedAt         time.Time         `json:"started_at,omitempty"`
	DurationMS        int64             `json:"duration_ms"`
	Output            string            `json:"output,omitempty"`
	OutputRef         string            `json:"output_ref,omitempty"`
	OutputBytes       int64             `json:"output_bytes"`
	LoggedBytes       int64             `json:"logged_bytes"`
	NextOffset        int64             `json:"next_offset"`
	Truncated         bool              `json:"truncated,omitempty"`
	LogIncomplete     bool              `json:"log_incomplete,omitempty"`
	OutputTokenBudget int               `json:"output_token_budget,omitempty"`
	BudgetReduced     bool              `json:"budget_reduced,omitempty"`
	InputNotice       string            `json:"input_notice,omitempty"`
	Error             *ShellError       `json:"error,omitempty"`
}

// 已请求取消/超时仍须等退出收据；未启动就取消的调用没有进程可等。
func (r ShellResult) Pending() bool {
	return r.State == "starting" || r.State == "running" ||
		r.SessionID > 0 && r.ExitCode == nil && (r.State == "cancelled" || r.State == "timed_out")
}

func shellFailure(code, message string) ShellResult {
	if len(message) > 4096 {
		message = message[:4096] + "…"
	}
	return ShellResult{State: "rejected", Error: &ShellError{code, message}}
}

type shellJob struct {
	mu               sync.Mutex
	inputMu          sync.Mutex
	result           ShellResult
	process          platform.Process
	log              *os.File
	tail             []byte
	displayTail      string
	displayTailValid bool
	cursor           int64
	done             chan struct{}
	changed          chan struct{}
	manager          *ShellManager
	uiInputs         map[string]bool // Only request IDs; never retain user input text.
	uiSequences      map[string]int  // Bounded client high-water marks for direct PTY input.
}

type ShellManager struct {
	execution  *executionRuntime
	imageMu    sync.Mutex
	mu         sync.Mutex
	jobs       map[int]*shellJob
	root, dir  string
	config     string              // The owning user's registry; empty only for standalone tool tests.
	relocate   func(string) string // Bound profile mapping; durable tool arguments remain unchanged.
	closed     bool
	active     int
	quotaMu    sync.Mutex
	logBytes   int64
	generation int // Bound under mu before each model turn; receipts keep their original generation.
}

func NewShellManager(root, dir string) (*ShellManager, error) {
	if root == "" {
		root, _ = os.Getwd()
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	dir, err = filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	m := &ShellManager{root: root, dir: dir, jobs: map[int]*shellJob{}}
	files, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil {
		return nil, err
	}
	for _, file := range files {
		data, e := os.ReadFile(file)
		if e != nil {
			return nil, e
		}
		var r ShellResult
		if e = json.Unmarshal(data, &r); e != nil || r.SessionID <= 0 {
			return nil, fmt.Errorf("Shell 执行记录损坏：%s", filepath.Base(file))
		}
		r.OutputRef = filepath.Join(dir, fmt.Sprintf("%d.log", r.SessionID))
		if r.Pending() {
			r.State, r.OK = "interrupted_unknown", false
			r.Error = &ShellError{"interrupted_unknown", "上次进程已中断，执行结果不确定；先检查日志和实际文件，不自动重跑"}
		}
		if r.InputState == "pending" {
			r.InputState = "unknown"
		}
		logBytes := r.LoggedBytes
		var recoveredTail []byte
		if r.State == "interrupted_unknown" {
			recoveredTail, logBytes = restoreShellOutput(&r)
		}
		j := &shellJob{result: r, done: make(chan struct{}), changed: make(chan struct{}, 1), manager: m}
		close(j.done)
		if r.State == "interrupted_unknown" {
			j.tail = recoveredTail
		} else if tail, e := os.ReadFile(filepath.Join(dir, fmt.Sprintf("%d.tail", r.SessionID))); e == nil {
			j.tail = tail
		}
		m.jobs[r.SessionID] = j
		m.logBytes += logBytes
	}
	m.execution, err = newExecutionRuntime(m)
	if err != nil {
		return nil, err
	}
	return m, nil
}

func (m *ShellManager) Environment() string {
	shell, _ := platform.DefaultShell()
	info := formatPromptText(runtimePrompt("Matrix/辅助指令/命令环境.txt"), runtime.GOOS, shell, m.root) + bundledShellToolsNotice()
	if desktop := platform.DesktopDirectory(); filepath.IsAbs(desktop) {
		info += "\nDesktop directory resolved by Windows: " + string(rawJSON(desktop))
	}
	return info
}

// 动态状态放在请求尾部，避免破坏固定合同的缓存前缀；不带输出和用户输入。
func (m *ShellManager) BackgroundNotice() string {
	type retained struct {
		SessionID     int    `json:"session_id"`
		Generation    int    `json:"generation"`
		State         string `json:"state"`
		TTY           bool   `json:"tty"`
		ExitCode      *int   `json:"exit_code,omitempty"`
		PrivateOutput bool   `json:"private_output,omitempty"`
		InputState    string `json:"input_state,omitempty"`
	}
	var active, ended []retained
	for _, row := range m.Snapshots() {
		if !row.Background {
			continue
		}
		value := retained{row.SessionID, row.Generation, row.State, row.TTY, row.ExitCode, row.PrivateOutput, row.InputState}
		if row.Pending() {
			active = append(active, value)
		} else {
			ended = append(ended, value)
		}
	}
	if len(active) == 0 && len(ended) == 0 {
		return ""
	}
	if len(ended) > 16 {
		ended = ended[len(ended)-16:]
	}
	rows := append(active, ended...)
	sort.Slice(rows, func(i, j int) bool { return rows[i].SessionID < rows[j].SessionID })
	data, _ := json.Marshal(rows)
	return runtimePrompt("Matrix/辅助指令/保留的后台会话.txt") + string(data)
}

func (m *ShellManager) Workdir() string { return m.root }

type shellBudgetKey struct{}

func WithShellOutputBudget(ctx context.Context, tokens int) context.Context {
	return context.WithValue(ctx, shellBudgetKey{}, max(1, min(tokens, ShellMaxTokens)))
}

func limitShellBudget(ctx context.Context, n *int) bool {
	limit, ok := ctx.Value(shellBudgetKey{}).(int)
	if !ok || *n < 0 || *n > ShellMaxTokens {
		return false
	}
	requested := *n
	if requested == 0 {
		requested = ShellDefaultTokens
	}
	if requested > limit {
		*n = limit
		return true
	}
	return false
}

// The tool validates and dispatches; this host owns authorized processes and logs.
func (m *ShellManager) Execute(ctx context.Context, call ToolCall) ShellResult {
	if m.config != "" {
		ctx = context.WithValue(ctx, officialToolConfigKey{}, m.config)
	}
	if err := admitOfficialToolCall(ctx, call); err != nil {
		return shellFailure("tool_package_disabled", err.Error())
	}
	r, err := terminaltool.Execute(ctx, call, terminaltool.Service[ShellResult]{
		Start: func(ctx context.Context, req ShellCommand) ShellResult {
			reduced := limitShellBudget(ctx, &req.MaxOutputTokens)
			r := m.start(ctx, req)
			r.BudgetReduced = reduced
			return r
		},
		Input: func(ctx context.Context, req ShellInput) ShellResult {
			reduced := limitShellBudget(ctx, &req.MaxOutputTokens)
			r := m.input(ctx, req)
			r.BudgetReduced = reduced
			return r
		},
		Read: func(_ context.Context, req ShellRead) ShellResult {
			reduced := limitShellBudget(ctx, &req.MaxOutputTokens)
			r := m.read(req)
			r.BudgetReduced = reduced
			return r
		},
	})
	if err != nil {
		code := "invalid_arguments"
		if !terminaltool.IsTool(call.Function.Name) {
			code = "unknown_tool"
		}
		return shellFailure(code, err.Error())
	}
	r.Cmd, r.Description = "", ""
	return r
}

func decodeShellArgs(data string, out any) error { return terminaltool.DecodeArguments(data, out) }

func shellTokens(n int) (int, error) {
	if n == 0 {
		return ShellDefaultTokens, nil
	}
	if n < 1 || n > ShellMaxTokens {
		return 0, fmt.Errorf("max_output_tokens 应在 1–32000 之间")
	}
	return n, nil
}
func shellYield(n *int, fallback int) (time.Duration, error) {
	ms := fallback
	if n != nil {
		ms = *n
	}
	if ms < 0 {
		return 0, fmt.Errorf("yield_time_ms 不能为负；等待结束不会杀死进程")
	}
	// 超过上限按 30 秒等待：等待只决定多久返回输出，进程继续运行，可再 wait。
	ms = min(ms, 30000)
	return time.Duration(ms) * time.Millisecond, nil
}

func (m *ShellManager) start(ctx context.Context, req ShellCommand) ShellResult {
	// 后台常驻的进程一律在交互式终端里运行（UI设计知识库 形态 §15 K2）：界面上后台终端和 PTY 是同一种终端，
	// 用户随时可以接手输入；模型照常用 write_stdin / read_shell_output。
	if req.Background {
		req.TTY = true
	}
	if strings.TrimSpace(req.Cmd) == "" || len(req.Cmd) > 256<<10 || strings.ContainsRune(req.Cmd, 0) {
		return shellFailure("invalid_command", "cmd 必须是非空命令，最多 256 KiB，且不能含 NUL")
	}
	tokens, err := shellTokens(req.MaxOutputTokens)
	if err != nil {
		return shellFailure("invalid_arguments", err.Error())
	}
	// 普通命令默认最多等 10 秒，先结束就先返回；常驻/交互进程仍 1 秒交还控制权。
	defaultYield := 10000
	if req.Background || req.TTY {
		defaultYield = 1000
	}
	yield, err := shellYield(req.YieldTimeMS, defaultYield)
	if err != nil {
		return shellFailure("invalid_arguments", err.Error())
	}
	timeout := 30 * time.Minute
	if req.TimeoutMS != nil {
		if *req.TimeoutMS < 0 || *req.TimeoutMS > 7*24*60*60*1000 {
			return shellFailure("invalid_arguments", "timeout_ms 应在 0–604800000 之间；0 表示持续运行")
		}
		timeout = time.Duration(*req.TimeoutMS) * time.Millisecond
	}
	cwd := req.Workdir
	if m.relocate != nil {
		cwd = m.relocate(cwd)
	}
	if cwd == "" {
		cwd = m.root
	} else if !filepath.IsAbs(cwd) {
		cwd = filepath.Join(m.root, cwd)
	}
	cwd, err = filepath.Abs(cwd)
	if err != nil {
		return shellFailure("invalid_workdir", err.Error())
	}
	if st, e := os.Stat(cwd); e != nil || !st.IsDir() {
		return shellFailure("invalid_workdir", "工作目录不存在或不是目录："+cwd)
	}
	shell := req.Shell
	if shell == "" {
		shell, err = platform.DefaultShell()
	} else {
		shell, err = exec.LookPath(shell)
	}
	if err != nil {
		return shellFailure("shell_unavailable", "Shell 不可用，请指定实际安装的 shell 路径")
	}
	cmdNotice := ""
	if script, ok := unwrapSelfShell(shell, req.Cmd); ok {
		req.Cmd = script
		cmdNotice = "cmd 又套了一层同样的 PowerShell -Command；外层会先展开双引号里的 $变量。已直接在当前 Shell 运行其中的脚本，以后直接写脚本即可。"
	}
	guardVars := map[string]string{}
	for key, value := range req.Env {
		guardVars[strings.ToLower(key)] = value
	}
	if reason := tools.CatastrophicCommandWithEnv(req.Cmd, cwd, m.root, guardVars); reason != "" {
		r := shellFailure("catastrophic_command", reason+"；命令未执行")
		r.State, r.Cmd, r.Description, r.Workdir, r.Shell = "blocked", req.Cmd, req.Description, cwd, shell
		return r
	}
	for k, v := range req.Env {
		if k == "" || strings.ContainsAny(k, "=\x00") || strings.ContainsRune(v, 0) {
			return shellFailure("invalid_environment", "环境变量名称和值不能含 NUL，名称不能含等号")
		}
	}
	if ctx.Err() != nil {
		return shellFailure("cancelled", "执行已取消，命令未启动")
	}
	m.mu.Lock()
	if ctx.Err() != nil {
		m.mu.Unlock()
		return shellFailure("cancelled", "执行已取消，命令未启动")
	}
	if m.closed {
		m.mu.Unlock()
		return shellFailure("closed", "Shell 会话已关闭")
	}
	if m.active >= ShellMaxProcesses {
		m.mu.Unlock()
		return shellFailure("process_limit", fmt.Sprintf("已有 %d 个活跃执行，请等待或停止一个已有 session；不要重发已有命令", ShellMaxProcesses))
	}
	var id int
	for {
		var b [4]byte
		if _, err = rand.Read(b[:]); err != nil {
			m.mu.Unlock()
			return shellFailure("internal_error", err.Error())
		}
		id = int(binary.LittleEndian.Uint32(b[:]) & 0x7fffffff)
		if id > 0 && m.jobs[id] == nil {
			break
		}
	}
	path := filepath.Join(m.dir, fmt.Sprintf("%d.log", id))
	log, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		m.mu.Unlock()
		return shellFailure("log_unavailable", err.Error())
	}
	j := &shellJob{result: ShellResult{OK: true, SessionID: id, Generation: m.generation, State: "starting", Cmd: req.Cmd, Description: req.Description, Workdir: cwd, Shell: shell, TTY: req.TTY, Background: req.Background, StartedAt: time.Now(), OutputRef: path}, log: log, done: make(chan struct{}), changed: make(chan struct{}, 1), manager: m}
	m.jobs[id] = j
	if req.TTY {
		j.result.Columns, j.result.Rows = 120, 30
	}
	m.active++
	j.mu.Lock()
	m.mu.Unlock()
	// 注册并占好进程名额后释放管理锁；刷盘和 Windows 启动不能串行挡住其他任务。
	failStart := func(code, message string) ShellResult {
		j.result.OK, j.result.State, j.result.Error = false, "spawn_failed", &ShellError{code, message}
		log.Close()
		j.log = nil
		if code != "persistence_failed" {
			_ = j.persist()
		}
		m.releaseProcess()
		close(j.done)
		j.mu.Unlock()
		return j.snapshot(tokens, false)
	}
	// 先保存执行身份，再创建进程。失败时仍保留可查询记录。
	if err = j.persist(); err != nil {
		return failStart("persistence_failed", "执行记录无法保存，命令未启动："+err.Error())
	}
	req.Workdir, req.Shell = cwd, shell
	scriptPath := ""
	if runtime.GOOS == "windows" && len(req.Cmd) > 8000 && (platform.ShellWordName(shell) == "pwsh" || platform.ShellWordName(shell) == "powershell") {
		scriptPath = filepath.Join(m.dir, fmt.Sprintf("%d.ps1", id))
		// Windows 的命令行长度有限；长脚本保存到本执行日志目录，不改用户工作文件。
		text := "\ufeff" + powerShellEncoding(req.TTY) + "\n" + req.Cmd + "\nif (-not $?) { exit 1 }\n"
		if err = os.WriteFile(scriptPath, []byte(text), 0600); err != nil {
			return failStart("script_unavailable", err.Error())
		}
	}
	if ctx.Err() != nil {
		return failStart("cancelled", "执行已取消，命令未启动")
	}
	process, err := platform.StartShellProcess(platform.ProcessRequest{Shell: req.Shell, Args: shellArgsWithScript(req, scriptPath), Environment: shellEnvironment(req.Env), Workdir: req.Workdir, Command: req.Cmd, TTY: req.TTY}, j)
	if err != nil {
		return failStart("spawn_failed", err.Error())
	}
	j.process = process
	j.result.State = "running"
	j.mu.Unlock()
	go j.run(timeout)
	// 说明只随第一次结果给模型一次，后续 write_stdin 不重复占用上下文。
	r := j.wait(ctx, yield, tokens, false)
	r.CmdNotice = cmdNotice
	return r
}

func (m *ShellManager) releaseProcess() {
	m.mu.Lock()
	m.active--
	m.mu.Unlock()
}

func (j *shellJob) run(timeout time.Duration) {
	var timer *time.Timer
	if timeout > 0 {
		timer = time.AfterFunc(timeout, func() { j.stop("timed_out") })
	}
	code, err := j.process.Wait()
	if timer != nil {
		timer.Stop()
	}
	j.mu.Lock()
	j.result.ExitCode = &code
	j.result.DurationMS = time.Since(j.result.StartedAt).Milliseconds()
	if j.result.State == "running" {
		j.result.State = "exited"
		if err != nil {
			j.result.OK = false
			j.result.Error = &ShellError{"wait_failed", err.Error()}
		}
	}
	if j.log != nil {
		if err = j.log.Sync(); err != nil {
			j.result.LogIncomplete = true
		}
		j.log.Close()
		j.log = nil
	}
	if err = os.WriteFile(filepath.Join(j.manager.dir, fmt.Sprintf("%d.tail", j.result.SessionID)), j.tail, 0600); err != nil {
		j.result.LogIncomplete = true
	}
	if err = j.persist(); err != nil {
		j.result.OK = false
		j.result.Error = &ShellError{"persistence_failed", "进程已经结束，但状态保存失败：" + err.Error()}
	}
	j.process.Close()
	j.manager.releaseProcess()
	close(j.done)
	j.mu.Unlock()
	select {
	case j.changed <- struct{}{}:
	default:
	}
}

func (j *shellJob) stop(state string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.result.State != "running" {
		return
	}
	j.result.State = state
	// 与 run 的结果收尾互斥，防止 Stop 使用已被 Close 回收的进程句柄。
	if j.process != nil {
		_ = j.process.Stop()
	}
}

func (m *ShellManager) job(id int) *shellJob { m.mu.Lock(); defer m.mu.Unlock(); return m.jobs[id] }

func (m *ShellManager) input(ctx context.Context, req ShellInput) ShellResult {
	tokens, err := shellTokens(req.MaxOutputTokens)
	if err != nil {
		return shellFailure("invalid_arguments", err.Error())
	}
	yield, err := shellYield(req.YieldTimeMS, 5000)
	if err != nil {
		return shellFailure("invalid_arguments", err.Error())
	}
	j := m.job(req.SessionID)
	if j == nil {
		return shellFailure("session_missing", "session_id 不存在；请使用 exec_command 返回的编号")
	}
	if len(req.Chars) > 64<<10 {
		return shellFailure("input_too_large", "单次输入最多 64 KiB")
	}
	if ctx.Err() != nil {
		j.stop("cancelled")
		return j.snapshot(tokens, true)
	}
	if req.Terminate {
		j.stop("cancelled")
	} else if req.Chars != "" || req.PressEnter {
		// stdin 管道可能填满；取消必须能中断 Write，不能等写完才开始监听。
		stopCancel := context.AfterFunc(ctx, func() { j.stop("cancelled") })
		defer stopCancel()
		j.inputMu.Lock()
		if ctx.Err() != nil {
			j.inputMu.Unlock()
			j.stop("cancelled")
			return j.snapshot(tokens, true)
		}
		j.mu.Lock()
		running := j.result.State == "running"
		tty := j.result.TTY
		p := j.process
		j.mu.Unlock()
		if !running || p == nil {
			j.inputMu.Unlock()
			return shellFailure("process_ended", "进程已结束，无法写入；可以继续读取保存的输出")
		}
		if req.PressEnter && !tty {
			j.inputMu.Unlock()
			return shellFailure("invalid_arguments", "press_enter 仅适用于 tty=true 的交互终端；管道输入请用 chars 明确指定字节")
		}
		input := req.Chars
		if req.PressEnter {
			// 明确的按键意图，不推断/反转义 chars；字面文本仍逐字节保留。
			input += "\r"
		}
		_, err = p.Write([]byte(input))
		j.inputMu.Unlock()
		if ctx.Err() != nil {
			j.stop("cancelled")
			return j.snapshot(tokens, true)
		}
		if err != nil {
			return shellFailure("stdin_closed", err.Error())
		}
	}
	result := j.wait(ctx, yield, tokens, true)
	if result.TTY && !req.Terminate && !req.PressEnter && !strings.Contains(req.Chars, "\r") &&
		(strings.Contains(req.Chars, `\r`) || strings.Contains(req.Chars, `\u000D`) || strings.Contains(req.Chars, `\u000d`)) {
		// 只解释实际收到的字节，不猜用户意图，也不把字面文本偷偷改成按键。
		result.InputNotice = runtimePrompt("Matrix/工具说明/终端输入回车.txt")
	}
	return result
}

func (j *shellJob) wait(ctx context.Context, d time.Duration, tokens int, newOutput bool) ShellResult {
	if ctx.Err() != nil {
		j.stop("cancelled")
		return j.snapshot(tokens, true)
	}
	if d > 0 {
		timer := time.NewTimer(d)
		defer timer.Stop()
		var quiet, burst *time.Timer
		var quietC, burstC <-chan time.Time
		defer func() {
			if quiet != nil {
				quiet.Stop()
				burst.Stop()
			}
		}()
		for {
			j.mu.Lock()
			ready := newOutput && j.result.OutputBytes > j.cursor
			j.mu.Unlock()
			if ready {
				// 合并同一阵连续输出，避免一小块日志触发一次模型往返；退出即时返回。
				if quiet == nil {
					quiet, burst = time.NewTimer(75*time.Millisecond), time.NewTimer(250*time.Millisecond)
					quietC, burstC = quiet.C, burst.C
				}
			}
			select {
			case <-j.done:
				return j.snapshot(tokens, true)
			case <-ctx.Done():
				j.stop("cancelled")
				return j.snapshot(tokens, true)
			case <-timer.C:
				return j.snapshot(tokens, true)
			case <-quietC:
				return j.snapshot(tokens, true)
			case <-burstC:
				return j.snapshot(tokens, true)
			case <-j.changed:
				if quiet != nil {
					quiet.Reset(75 * time.Millisecond)
				}
			}
		}
	}
	return j.snapshot(tokens, true)
}

func (m *ShellManager) Snapshots() []ShellResult {
	out, _ := m.snapshots(false)
	return out
}

// UI 节拍不能等工作线程的磁盘或进程锁。忙时沿用上一帧，下一节拍再取。
func (m *ShellManager) TrySnapshots() ([]ShellResult, bool) { return m.snapshots(true) }

func (m *ShellManager) snapshots(nonblocking bool) ([]ShellResult, bool) {
	if nonblocking {
		if !m.mu.TryLock() {
			return nil, false
		}
	} else {
		m.mu.Lock()
	}
	jobs := make([]*shellJob, 0, len(m.jobs))
	for _, j := range m.jobs {
		jobs = append(jobs, j)
	}
	m.mu.Unlock()
	out := make([]ShellResult, 0, len(jobs))
	for _, j := range jobs {
		if nonblocking {
			if !j.mu.TryLock() {
				return nil, false
			}
		} else {
			j.mu.Lock()
		}
		r := j.result
		if r.State == "running" {
			r.DurationMS = time.Since(r.StartedAt).Milliseconds()
		}
		if !j.displayTailValid {
			j.displayTail = CleanShellText(string(j.tail[max(0, len(j.tail)-2048):]))
			j.displayTailValid = true
		}
		r.Output = j.displayTail
		j.mu.Unlock()
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt.Before(out[j].StartedAt) })
	return out, true
}

func (m *ShellManager) CancelAll() {
	if m.execution != nil {
		m.execution.stopAll(false)
	}
	m.mu.Lock()
	jobs := make([]*shellJob, 0, len(m.jobs))
	for _, j := range m.jobs {
		jobs = append(jobs, j)
	}
	m.mu.Unlock()
	for _, j := range jobs {
		j.stop("cancelled")
	}
}
func (m *ShellManager) Close() {
	if m.execution != nil {
		m.execution.stopAll(true)
	}
	m.mu.Lock()
	m.closed = true
	jobs := make([]*shellJob, 0, len(m.jobs))
	for _, j := range m.jobs {
		jobs = append(jobs, j)
	}
	m.mu.Unlock()
	for _, j := range jobs {
		j.stop("cancelled")
	}
	for _, j := range jobs {
		select {
		case <-j.done:
		case <-time.After(3 * time.Second):
		}
	}
}

func (j *shellJob) persist() error {
	data, err := json.Marshal(j.result)
	if err != nil {
		return err
	}
	path := filepath.Join(j.manager.dir, fmt.Sprintf("%d.json", j.result.SessionID))
	f, err := os.CreateTemp(j.manager.dir, ".shell-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(tmp, path)
}

func shellEnvironment(overrides map[string]string) []string {
	// 模型执行的子进程不需要传输层临时凭据；避免环境枚举泄漏调试Key。
	env := make([]string, 0, len(os.Environ()))
	for _, pair := range os.Environ() {
		key, _, _ := strings.Cut(pair, "=")
		if !strings.HasPrefix(strings.ToUpper(key), "AIEYRA_RUNTIME_") {
			env = append(env, pair)
		}
	}
	if runtime.GOOS == "windows" {
		// Python uses the Windows ANSI code page for redirected streams by default.
		if _, configured := os.LookupEnv("PYTHONIOENCODING"); !configured {
			env = append(env, "PYTHONIOENCODING=utf-8")
		}
	}
	if dir := bundledShellToolDir(); dir != "" {
		for i, pair := range env {
			key, value, _ := strings.Cut(pair, "=")
			if strings.EqualFold(key, "PATH") {
				env[i] = key + "=" + dir + string(os.PathListSeparator) + value
				break
			}
		}
	}
	for key, value := range overrides {
		found := false
		for i, pair := range env {
			k, _, _ := strings.Cut(pair, "=")
			if k == key || runtime.GOOS == "windows" && strings.EqualFold(k, key) {
				env[i] = key + "=" + value
				found = true
				break
			}
		}
		if !found {
			env = append(env, key+"="+value)
		}
	}
	return env
}

// PowerShell 的输入输出编码。输出统一 UTF-8。交互终端的输入改用 UTF-16：.NET 只有这样才用 ReadConsoleW 读控制台；
// 设成 UTF-8 时 [Console]::ReadLine 走字节读取，控制台在 65001 代码页下把每个中文字读成 NUL（AIDEBUG terminal-history 实测）。
// 管道输入不受影响，仍按 UTF-8 解码 CORE 写入的字节。
func powerShellEncoding(tty bool) string {
	input := "[Text.UTF8Encoding]::new($false)"
	if tty {
		input = "[Text.Encoding]::Unicode"
	}
	return "[Console]::InputEncoding=" + input + "; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding;"
}

func shellArgs(req ShellCommand) []string { return shellArgsWithScript(req, "") }

func shellArgsWithScript(req ShellCommand, scriptPath string) []string {
	name := strings.ToLower(strings.TrimSuffix(filepath.Base(req.Shell), ".exe"))
	switch name {
	case "pwsh", "powershell":
		args := []string{"-NoLogo"}
		if !req.Login {
			args = append(args, "-NoProfile")
		}
		if scriptPath != "" {
			return append(args, "-ExecutionPolicy", "Bypass", "-File", scriptPath)
		}
		// 统一中文和外部程序的输出编码，保留脚本自己设置错误策略的权利。
		return append(args, "-Command", powerShellEncoding(req.TTY)+" "+req.Cmd)
	case "cmd":
		return []string{"/d", "/s", "/c", req.Cmd}
	case "wsl":
		return []string{"--cd", req.Workdir, "--exec", "bash", map[bool]string{true: "-lc", false: "-c"}[req.Login], req.Cmd}
	default:
		flag := "-c"
		if req.Login {
			flag = "-lc"
		}
		return []string{flag, req.Cmd}
	}
}
