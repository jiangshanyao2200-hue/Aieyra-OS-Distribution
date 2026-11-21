// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: orchestrationWorker; executionRuntime; executionCell; cellEvent; newExecutionRuntime; apply; append; execFailure; execute; wait; stop; finish; orchestrationHost; workerMessage; run; call; stopSession; stopAll; ExecutionSnapshots; TryExecutionSnapshots; executionSnapshots; utf8Prefix
// Impact: python -B scripts/code-atlas.py show Core/orchestration.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/aieyra/aieyra-os/CORE/platform"
	patchtool "github.com/aieyra/aieyra-os/tool/base/official/apply_patch"
	terminaltool "github.com/aieyra/aieyra-os/tool/base/official/terminal"
)

//go:embed orchestration_worker.cjs
var orchestrationWorker []byte

type executionRuntime struct {
	mu     sync.Mutex
	shell  *ShellManager
	cells  map[string]*executionCell
	store  map[string]json.RawMessage
	slots  chan struct{}
	closed bool
}

type executionCell struct {
	mu                          sync.Mutex
	pollMu                      sync.Mutex
	runtime                     *executionRuntime
	id, key, description, state string
	error                       *ShellError
	log                         *os.File
	outputs                     []ExecOutput
	images                      map[string]ImageAttachment
	records                     []NestedToolRecord
	owned                       map[int]bool
	cursor, outputBytes         int
	column                      int
	cancel                      context.CancelFunc
	done                        chan struct{}
}

type cellEvent struct {
	At          int64             `json:"at,omitempty"`
	Type        string            `json:"type"`
	Key         string            `json:"key,omitempty"`
	Description string            `json:"description,omitempty"`
	Request     *ExecRequest      `json:"request,omitempty"`
	Output      *ExecOutput       `json:"output,omitempty"`
	Image       *ImageAttachment  `json:"image,omitempty"`
	Record      *NestedToolRecord `json:"record,omitempty"`
	State       string            `json:"state,omitempty"`
	Error       *ShellError       `json:"error,omitempty"`
	Cursor      int               `json:"cursor,omitempty"`
	Column      int               `json:"column,omitempty"`
}

func newExecutionRuntime(m *ShellManager) (*executionRuntime, error) {
	r := &executionRuntime{shell: m, cells: map[string]*executionCell{}, store: map[string]json.RawMessage{}, slots: make(chan struct{}, ShellDispatchLimit)}
	files, err := filepath.Glob(filepath.Join(m.dir, "cells", "*.jsonl"))
	if err != nil {
		return nil, err
	}
	for _, path := range files {
		f, e := os.Open(path)
		if e != nil {
			return nil, e
		}
		c := &executionCell{runtime: r, id: strings.TrimSuffix(filepath.Base(path), ".jsonl"), state: "interrupted_unknown", images: map[string]ImageAttachment{}, owned: map[int]bool{}, done: make(chan struct{})}
		s := bufio.NewScanner(f)
		s.Buffer(make([]byte, 4096), 32<<20)
		for s.Scan() {
			var event cellEvent
			if e = json.Unmarshal(s.Bytes(), &event); e != nil {
				c.error = &ShellError{"interrupted_unknown", "编排日志尾部不完整，请核对已有记录"}
				break
			}
			c.apply(event)
		}
		readErr := s.Err()
		f.Close()
		if readErr != nil {
			return nil, fmt.Errorf("编排日志读取失败：%w", readErr)
		}
		if c.state == "running" || c.state == "" {
			c.state = "interrupted_unknown"
			c.error = &ShellError{"interrupted_unknown", "执行单元已中断，已保留子调用记录；不会自动重跑"}
		}
		if c.error != nil && c.error.Code == "interrupted_unknown" {
			c.state = "interrupted_unknown"
		}
		for i := range c.records {
			if c.records[i].State == "running" {
				c.records[i].State = "interrupted_unknown"
			}
		}
		close(c.done)
		if c.error == nil {
			c.log, e = os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0600)
			if e != nil {
				return nil, e
			}
		}
		r.cells[c.id] = c
	}
	return r, nil
}

func (c *executionCell) apply(e cellEvent) {
	switch e.Type {
	case "start":
		c.key, c.description, c.state = e.Key, e.Description, "running"
	case "output":
		if e.Output != nil {
			c.outputs = append(c.outputs, *e.Output)
			c.outputBytes += len(e.Output.Text)
		}
	case "image":
		if e.Image != nil {
			c.images[e.Image.SHA256] = *e.Image
		}
	case "nested":
		if e.Record != nil {
			found := false
			for i := range c.records {
				if c.records[i].ID == e.Record.ID {
					c.records[i] = *e.Record
					found = true
					break
				}
			}
			if !found {
				c.records = append(c.records, *e.Record)
			}
		}
	case "finish":
		c.state, c.error = e.State, e.Error
	case "cursor":
		c.cursor, c.column = e.Cursor, e.Column
	}
}

// 每个子调用先持久化意图，返回 Promise 前保存结果；失败立即停止本 cell 的后续执行。
func (c *executionCell) append(e cellEvent) error {
	if e.At == 0 {
		e.At = time.Now().UnixMicro()
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.log == nil {
		return fmt.Errorf("编排日志已关闭")
	}
	if e.Type == "nested" && e.Record != nil && e.Record.State == "running" {
		if info, err := c.log.Stat(); err != nil || info.Size() > 64<<20 {
			return fmt.Errorf("编排日志超过 64 MiB 或不可读取，请缩小操作")
		}
	}
	b, err := json.Marshal(e)
	if err == nil {
		_, err = c.log.Write(append(b, '\n'))
	}
	if err == nil {
		err = c.log.Sync()
	}
	if err == nil {
		c.apply(e)
	}
	return err
}

func execFailure(code, message string) ExecResult {
	return ExecResult{State: "failed", Error: &ShellError{code, message}}
}

func (r *executionRuntime) execute(ctx context.Context, call ToolCall, key string) (ExecResult, []ImageAttachment) {
	if call.Function.Name == "wait" {
		var req WaitRequest
		if err := decodeShellArgs(call.Function.Arguments, &req); err != nil {
			return execFailure("invalid_arguments", err.Error()), nil
		}
		yield, err := shellYield(req.YieldTimeMS, 10000)
		if err != nil {
			return execFailure("invalid_arguments", err.Error()), nil
		}
		tokens, err := shellTokens(req.MaxTokens)
		if err != nil {
			return execFailure("invalid_arguments", err.Error()), nil
		}
		limitShellBudget(ctx, &tokens)
		r.mu.Lock()
		c := r.cells[req.CellID]
		r.mu.Unlock()
		if c == nil {
			return execFailure("unknown_cell", "找不到执行单元；cell_id 来自 exec，不是 Shell 的 session_id"), nil
		}
		if req.Terminate {
			c.stop()
		}
		return c.wait(ctx, yield, tokens)
	}
	var req ExecRequest
	if r.shell.config != "" {
		ctx = context.WithValue(ctx, officialToolConfigKey{}, r.shell.config)
	}
	ctx = withOfficialToolAdmission(ctx)
	if err := decodeShellArgs(call.Function.Arguments, &req); err != nil {
		return execFailure("invalid_arguments", err.Error()), nil
	}
	if strings.TrimSpace(req.Code) == "" || len(req.Code) > 256<<10 || len(req.Description) > 256 {
		return execFailure("invalid_arguments", "code 必须非空且最多 256 KiB，用途最多 256 字节"), nil
	}
	yield, err := shellYield(req.YieldTimeMS, 1000)
	if err != nil {
		return execFailure("invalid_arguments", err.Error()), nil
	}
	tokens, err := shellTokens(req.MaxOutputTokens)
	if err != nil {
		return execFailure("invalid_arguments", err.Error()), nil
	}
	limitShellBudget(ctx, &tokens)
	if ctx.Err() != nil {
		return execFailure("cancelled", "本轮已停止，未启动执行单元"), nil
	}
	r.mu.Lock()
	for _, c := range r.cells {
		if c.key == key {
			r.mu.Unlock()
			return execFailure("already_started", "该调用已经启动过；请检查已有 cell_id 与编排日志，不重跑"), nil
		}
	}
	active := 0
	for _, c := range r.cells {
		select {
		case <-c.done:
		default:
			active++
		}
	}
	if r.closed || active >= 4 || len(r.cells) >= 512 {
		r.mu.Unlock()
		return execFailure("cell_limit", "执行单元不可用：最多 4 个在途、每会话最多 512 个；请等待现有单元或创建新会话"), nil
	}
	var random [12]byte
	if _, err = rand.Read(random[:]); err != nil {
		r.mu.Unlock()
		return execFailure("internal_error", err.Error()), nil
	}
	id := "cell_" + hex.EncodeToString(random[:])
	dir := filepath.Join(r.shell.dir, "cells")
	if err = os.MkdirAll(dir, 0700); err != nil {
		r.mu.Unlock()
		return execFailure("persistence_failed", err.Error()), nil
	}
	f, err := os.OpenFile(filepath.Join(dir, id+".jsonl"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		r.mu.Unlock()
		return execFailure("persistence_failed", err.Error()), nil
	}
	cellCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Minute)
	c := &executionCell{runtime: r, id: id, key: key, description: req.Description, state: "running", log: f, cancel: cancel, done: make(chan struct{}), images: map[string]ImageAttachment{}, owned: map[int]bool{}}
	r.cells[id] = c
	r.mu.Unlock()
	if err = c.append(cellEvent{Type: "start", Key: key, Description: req.Description, Request: &req}); err != nil {
		c.finish("failed", &ShellError{"persistence_failed", err.Error()})
		return execFailure("persistence_failed", err.Error()), nil
	}
	go c.run(cellCtx, req.Code)
	return c.wait(ctx, yield, tokens)
}

func (c *executionCell) wait(ctx context.Context, yield time.Duration, tokens int) (ExecResult, []ImageAttachment) {
	c.pollMu.Lock()
	defer c.pollMu.Unlock()
	timer := time.NewTimer(yield)
	defer timer.Stop()
	select {
	case <-c.done:
	case <-timer.C:
	case <-ctx.Done():
		c.stop()
	}
	c.mu.Lock()
	r := ExecResult{OK: c.error == nil, State: c.state, CellID: c.id, Description: c.description, Error: c.error}
	var images []ImageAttachment
	next := min(c.cursor, len(c.outputs))
	column := c.column
	budget := max(4, tokens*3)
	for next < len(c.outputs) {
		v := c.outputs[next]
		if v.Type == "text" {
			v.Text = v.Text[min(column, len(v.Text)):]
			part := utf8Prefix(v.Text, min(budget, len(v.Text)))
			if len(part) == 0 && len(v.Text) > 0 {
				break
			}
			column += len(part)
			budget -= len(part)
			v.Text = part
			if column >= len(c.outputs[next].Text) {
				next++
				column = 0
			}
		} else {
			if budget < 96 && len(r.Output) > 0 {
				break
			}
			budget -= 96
			next++
			column = 0
		}
		r.Output = append(r.Output, v)
		if v.Type == "image" {
			if a, ok := c.images[v.ImageID]; ok {
				images = append(images, a)
			}
		}
		if budget <= 0 {
			break
		}
	}
	r.HasMore = next < len(c.outputs)
	open := c.log != nil
	c.mu.Unlock()
	if open {
		if err := c.append(cellEvent{Type: "cursor", Cursor: next, Column: column}); err != nil {
			r.OK = false
			r.Error = &ShellError{"persistence_failed", err.Error()}
			c.stop()
		}
	} else {
		c.mu.Lock()
		c.cursor, c.column = next, column
		c.mu.Unlock()
	}
	return r, images
}

func (c *executionCell) stop() {
	c.mu.Lock()
	cancel := c.cancel
	ids := make([]int, 0, len(c.owned))
	for id := range c.owned {
		ids = append(ids, id)
	}
	c.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	for _, id := range ids {
		c.runtime.shell.stopSession(id)
	}
}

func (c *executionCell) finish(state string, problem *ShellError) {
	if err := c.append(cellEvent{Type: "finish", State: state, Error: problem}); err != nil {
		c.mu.Lock()
		c.state, c.error = "failed", &ShellError{"persistence_failed", err.Error()}
		c.mu.Unlock()
	}
	close(c.done)
}

func orchestrationHost() (string, error) {
	exe, _ := os.Executable()
	cwd, _ := os.Getwd()
	for _, start := range []string{platform.AppRoot(), filepath.Dir(exe), cwd} {
		for dir, n := start, 0; n < 4; n++ {
			path := platform.ElectronPath(dir)
			if st, err := os.Stat(path); err == nil && !st.IsDir() {
				return path, nil
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	if path, err := exec.LookPath("node"); err == nil {
		return path, nil
	}
	return "", fmt.Errorf("未找到项目 Electron JavaScript 运行时，请修复 Desktop 的 Electron 安装")
}

type workerMessage struct {
	Type    string          `json:"type"`
	ID      int             `json:"id"`
	Name    string          `json:"name"`
	Args    json.RawMessage `json:"args"`
	Text    string          `json:"text"`
	ImageID string          `json:"image_id"`
	Key     string          `json:"key"`
	Value   json.RawMessage `json:"value"`
	Error   string          `json:"error"`
}

func (c *executionCell) run(ctx context.Context, code string) {
	state := "completed"
	var problem *ShellError
	fail := func(code, message string) { state = "failed"; problem = &ShellError{code, message} }
	var nested sync.WaitGroup
	var failureMu sync.Mutex
	var nestedFailure error
	defer func() {
		interrupted := ctx.Err()
		c.cancel()
		nested.Wait()
		if interrupted != nil {
			state = "cancelled"
			problem = &ShellError{"cancelled", "执行单元已停止"}
			if interrupted == context.DeadlineExceeded {
				state = "timed_out"
				problem = &ShellError{"timed_out", "执行单元超过五分钟时限"}
			}
		}
		failureMu.Lock()
		if nestedFailure != nil {
			fail("nested_persistence_failed", nestedFailure.Error())
		}
		failureMu.Unlock()
		if state != "completed" {
			c.stop()
		}
		c.finish(state, problem)
	}()
	host, err := orchestrationHost()
	if err != nil {
		fail("runtime_unavailable", err.Error())
		return
	}
	sum := sha256.Sum256(orchestrationWorker)
	path := filepath.Join(c.runtime.shell.dir, "cells", fmt.Sprintf("worker-%x.cjs", sum[:8]))
	// 每个 cell 用自己的桥文件，避免多个首次启动的 worker 读取半写入文件。
	path = strings.TrimSuffix(path, ".cjs") + "-" + c.id + ".cjs"
	if err = os.WriteFile(path, orchestrationWorker, 0600); err != nil {
		fail("runtime_unavailable", err.Error())
		return
	}
	defer os.Remove(path)
	cmd := exec.CommandContext(ctx, host, path)
	cmd.Dir = c.runtime.shell.root
	cmd.Env = append(os.Environ(), "ELECTRON_RUN_AS_NODE=1")
	configureExecutionProcess(cmd)
	in, err := cmd.StdinPipe()
	if err != nil {
		fail("runtime_unavailable", err.Error())
		return
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		fail("runtime_unavailable", err.Error())
		return
	}
	// 不向用户终端泄漏 worker 的异常或协议字节；错误通过结构化输出返回。
	cmd.Stderr = io.Discard
	if err = cmd.Start(); err != nil {
		fail("runtime_unavailable", err.Error())
		return
	}
	defer func() { in.Close(); _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	var writeMu sync.Mutex
	send := func(v any) error { writeMu.Lock(); defer writeMu.Unlock(); return json.NewEncoder(in).Encode(v) }
	c.runtime.mu.Lock()
	saved := map[string]json.RawMessage{}
	for k, v := range c.runtime.store {
		saved[k] = append(json.RawMessage(nil), v...)
	}
	c.runtime.mu.Unlock()
	names := make([]string, 0, len(executionNestedTools))
	for _, name := range executionNestedTools {
		if toolAllowed(ctx, name) {
			names = append(names, name)
		}
	}
	if err = send(map[string]any{"code": code, "names": names, "store": saved}); err != nil {
		fail("runtime_unavailable", err.Error())
		return
	}
	scanner := bufio.NewScanner(out)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	seen := map[int]bool{}
	for scanner.Scan() {
		var msg workerMessage
		if err = json.Unmarshal(scanner.Bytes(), &msg); err != nil {
			fail("worker_protocol", "JavaScript 输出协议无效")
			return
		}
		switch msg.Type {
		case "call":
			if msg.ID < 1 || msg.ID > 128 || seen[msg.ID] {
				fail("call_limit", "JavaScript 子调用身份重复或超限")
				return
			}
			seen[msg.ID] = true
			allowed := false
			for _, name := range names {
				allowed = allowed || name == msg.Name
			}
			if !allowed {
				fail("unknown_tool", "JavaScript 请求未注册工具")
				return
			}
			nested.Add(1)
			go func(msg workerMessage) {
				defer nested.Done()
				result, err := c.call(ctx, msg)
				answer := map[string]any{"id": msg.ID, "value": result}
				if err != nil {
					if ctx.Err() == nil {
						failureMu.Lock()
						if nestedFailure == nil {
							nestedFailure = err
						}
						failureMu.Unlock()
					}
					answer["error"] = err.Error()
					c.cancel()
				}
				_ = send(answer)
			}(msg)
		case "text":
			c.mu.Lock()
			size := c.outputBytes + len(msg.Text)
			c.mu.Unlock()
			if size > 256<<10 {
				fail("output_limit", "text() 选取的输出超过 256 KiB，请缩小选取范围")
				return
			}
			// One journal output is one logical text() call. wait() already
			// pages its text with a byte cursor; storage chunks must not turn a
			// single JSON result into ambiguous multiple tool outputs.
			if msg.Text != "" {
				part := ExecOutput{Type: "text", Text: msg.Text}
				if err = c.append(cellEvent{Type: "output", Output: &part}); err != nil {
					fail("persistence_failed", err.Error())
					return
				}
			}
		case "image":
			c.mu.Lock()
			_, ok := c.images[msg.ImageID]
			count := 0
			for _, v := range c.outputs {
				if v.Type == "image" {
					count++
				}
			}
			c.mu.Unlock()
			if !ok || count >= 4 {
				fail("invalid_image", "image() 必须引用本单元读取的图片；每单元最多四张")
				return
			}
			part := ExecOutput{Type: "image", ImageID: msg.ImageID}
			if err = c.append(cellEvent{Type: "output", Output: &part}); err != nil {
				fail("persistence_failed", err.Error())
				return
			}
		case "store":
			c.runtime.mu.Lock()
			size := len(msg.Value)
			for k, v := range c.runtime.store {
				if k != msg.Key {
					size += len(k) + len(v)
				}
			}
			if size <= 256<<10 && len(msg.Key) <= 256 {
				c.runtime.store[msg.Key] = append(json.RawMessage(nil), msg.Value...)
			}
			c.runtime.mu.Unlock()
			if size > 256<<10 {
				fail("store_limit", "共享 JSON 存储超过 256 KiB")
				return
			}
		case "done":
			if msg.Error != "" {
				fail("javascript_error", msg.Error)
			}
			return
		default:
			fail("worker_protocol", "未知 JavaScript 桥事件")
			return
		}
	}
	if ctx.Err() != nil {
		state = "cancelled"
		problem = &ShellError{"cancelled", "执行单元已停止"}
		if ctx.Err() == context.DeadlineExceeded {
			state = "timed_out"
			problem = &ShellError{"timed_out", "执行单元超过五分钟时限"}
		}
	} else {
		fail("worker_exited", "JavaScript worker 在提交完成事件前退出")
	}
}

func (c *executionCell) call(ctx context.Context, msg workerMessage) (json.RawMessage, error) {
	if !toolAllowed(ctx, msg.Name) {
		return nil, fmt.Errorf("tool_not_assigned: %s", msg.Name)
	}
	select {
	case c.runtime.slots <- struct{}{}:
		defer func() { <-c.runtime.slots }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	args := msg.Args
	if msg.Name == "apply_patch" {
		var patch string
		if json.Unmarshal(args, &patch) == nil {
			args = rawJSON(map[string]any{"patch": patch})
		}
	}
	call := ToolCall{ID: fmt.Sprintf("nested_%d", msg.ID), Type: "function", Function: FunctionCall{Name: msg.Name, Arguments: string(args)}}
	if err := admitOfficialToolCall(ctx, call); err != nil {
		return nil, err
	}
	record := NestedToolRecord{ID: msg.ID, Call: call, State: "running"}
	if err := c.append(cellEvent{Type: "nested", Record: &record}); err != nil {
		return nil, err
	}
	observeNestedExecution(ctx, call)
	var result any
	var attachments []ImageAttachment
	m := c.runtime.shell
	switch {
	case IsShellTool(msg.Name):
		v := m.Execute(ctx, call)
		result = v
		canonical, canonicalErr := terminaltool.CanonicalCall(call)
		if canonicalErr == nil && canonical.Function.Name == "exec_command" && v.SessionID > 0 {
			c.mu.Lock()
			c.owned[v.SessionID] = true
			c.mu.Unlock()
			if ctx.Err() != nil {
				m.stopSession(v.SessionID)
			}
		}
	case msg.Name == "apply_patch":
		result = patchtool.ExecutePatchWithPaths(ctx, m.root, filepath.Join(m.dir, "patches"), call, c.id+":"+call.ID, m.relocate)
	case msg.Name == "view_image":
		result, attachments = m.viewImage(ctx, call)
	}
	data, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	record.Output, record.State = string(data), "completed"
	if err = c.append(cellEvent{Type: "nested", Record: &record}); err != nil {
		return nil, err
	}
	for _, a := range attachments {
		if err = c.append(cellEvent{Type: "image", Image: &a}); err != nil {
			return nil, err
		}
	}
	if patch, ok := result.(PatchResult); ok {
		return json.RawMessage(patchtool.PatchModelOutput(patch)), nil
	}
	return data, nil
}

func (m *ShellManager) stopSession(id int) {
	m.mu.Lock()
	j := m.jobs[id]
	m.mu.Unlock()
	if j != nil {
		j.stop("cancelled")
	}
}

func (r *executionRuntime) stopAll(closeRuntime bool) {
	r.mu.Lock()
	if closeRuntime {
		r.closed = true
	}
	cells := make([]*executionCell, 0, len(r.cells))
	for _, c := range r.cells {
		cells = append(cells, c)
	}
	r.mu.Unlock()
	for _, c := range cells {
		c.stop()
	}
	if closeRuntime {
		for _, c := range cells {
			select {
			case <-c.done:
				c.mu.Lock()
				if c.log != nil {
					c.log.Close()
					c.log = nil
				}
				c.mu.Unlock()
			case <-time.After(3 * time.Second):
			}
		}
	}
}

// 交付核验必须等到真实回执；UI 节拍仍使用非阻塞读取。
func (m *ShellManager) ExecutionSnapshots() []ExecResult {
	out, _ := m.executionSnapshots(false)
	return out
}

func (m *ShellManager) TryExecutionSnapshots() ([]ExecResult, bool) {
	return m.executionSnapshots(true)
}

func (m *ShellManager) executionSnapshots(nonblocking bool) ([]ExecResult, bool) {
	r := m.execution
	if r == nil {
		return nil, true
	}
	if nonblocking {
		if !r.mu.TryLock() {
			return nil, false
		}
	} else {
		r.mu.Lock()
	}
	cells := make([]*executionCell, 0, len(r.cells))
	for _, c := range r.cells {
		cells = append(cells, c)
	}
	r.mu.Unlock()
	var out []ExecResult
	for _, c := range cells {
		if nonblocking {
			if !c.mu.TryLock() {
				return nil, false
			}
		} else {
			c.mu.Lock()
		}
		result := ExecResult{OK: c.error == nil, State: c.state, CellID: c.id, Description: c.description, Error: c.error, Records: append([]NestedToolRecord(nil), c.records...), Output: append([]ExecOutput(nil), c.outputs...)}
		c.mu.Unlock()
		sort.Slice(result.Records, func(i, j int) bool { return result.Records[i].ID < result.Records[j].ID })
		out = append(out, result)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CellID < out[j].CellID })
	return out, true
}

// 等待分页必须停在完整字符边界，不能拆开 UTF-8。
func utf8Prefix(s string, n int) string {
	if n >= len(s) {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}
