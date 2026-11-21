// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workspaceTerminalRequest; terminalCall; terminalRead; resize; userInput
// Impact: python -B scripts/code-atlas.py show Core/workspace_terminals.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"unicode/utf8"

	"github.com/aieyra/aieyra-os/CORE/platform"
)

// Terminal views reference the existing task runtime. They cannot create a
// process, select a different owner, or consume the model's output cursor.
type workspaceTerminalRequest struct {
	TaskID            string `json:"task_id"`
	AgentID           string `json:"agent_id"`
	Generation        int    `json:"generation"`
	SessionGeneration int    `json:"session_generation"`
	SessionID         int    `json:"session_id"`
	Offset            int64  `json:"offset"`
	RequestID         string `json:"request_id"`
	Chars             string `json:"chars"`
	PressEnter        bool   `json:"press_enter"`
	Private           bool   `json:"private"`
	Terminate         bool   `json:"terminate"`
	Terminal          bool   `json:"terminal"`
	Columns           int    `json:"columns"`
	Rows              int    `json:"rows"`
	InputClient       string `json:"input_client"`
	InputSequence     int    `json:"input_sequence"`
	ImageID           string `json:"image_id"`
}

func (w *Workspace) terminalCall(ctx context.Context, action string, raw json.RawMessage) (any, error) {
	var p workspaceTerminalRequest
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	owner, err := w.taskOwner(p.TaskID)
	if err != nil {
		return nil, err
	}
	if owner != w {
		return owner.terminalCall(ctx, action, raw)
	}
	w.mu.Lock()
	root, primary := w.state.ID, w.state.Roles[WorkspaceMatrix]
	// 协同形态（最终搬家 R13）：Vaya 和 Cota 的执行窗口按各自的角色任务读终端。
	member := false
	for role, agent := range w.state.Roles {
		member = member || (role != WorkspaceMatrix && agent != "" && agent == p.AgentID)
	}
	w.mu.Unlock()
	id := p.TaskID
	if id == root {
		id = primary
		if member {
			id = p.AgentID
		}
	}
	if p.TaskID == "" || id == "" || p.Generation <= 0 || p.AgentID != id {
		return nil, fmt.Errorf("terminal requires the current task, agent and generation")
	}
	w.manager.mu.Lock()
	j := w.manager.jobs[id]
	if j == nil || !w.manager.ownsLocked(root, id) || (id != primary && !member && j.record.Spec.WorkspaceRole != "") {
		w.manager.mu.Unlock()
		return nil, fmt.Errorf("terminal task not owned by caller")
	}
	if j.record.Generation != p.Generation {
		w.manager.mu.Unlock()
		return nil, fmt.Errorf("terminal generation changed; refresh the task")
	}
	shell := j.shell
	w.manager.mu.Unlock()
	// 展示台显示 Eyra 实际看过的那张图（UI设计知识库 形态 §15.11 V1）：只按图片指纹读本任务的不可变快照，不接受路径。
	if action == "workspace.tool_image" {
		if shell == nil {
			return nil, fmt.Errorf("terminal runtime is unavailable")
		}
		image, err := shell.toolImage(p.ImageID)
		if err != nil {
			return nil, err
		}
		image["ok"], image["task_id"], image["agent_id"], image["generation"] = true, p.TaskID, id, p.Generation
		return image, nil
	}
	response := map[string]any{"ok": true, "task_id": p.TaskID, "agent_id": id, "generation": p.Generation}
	if action == "workspace.terminals" {
		rows := []ShellResult{}
		if shell != nil {
			current, ready := shell.TrySnapshots()
			if !ready {
				response["unchanged"] = true
				return response, nil
			}
			for _, row := range current {
				if row.Generation != p.Generation && !row.Background {
					continue
				}
				row.Output, row.OutputRef = "", ""
				rows = append(rows, row)
			}
		}
		response["sessions"] = rows
	} else {
		if shell == nil {
			return nil, fmt.Errorf("terminal runtime is unavailable")
		}
		session := shell.job(p.SessionID)
		if session == nil {
			return nil, fmt.Errorf("terminal session is unavailable")
		}
		session.mu.Lock()
		generation, background := session.result.Generation, session.result.Background
		session.mu.Unlock()
		if p.SessionGeneration != 0 && p.SessionGeneration != generation || generation != p.Generation && (!background || p.SessionGeneration != generation) {
			return nil, fmt.Errorf("terminal generation must match its original session receipt")
		}
		var result ShellResult
		switch action {
		case "workspace.terminal_read":
			if p.Terminal {
				secrets, err := w.manager.redactionSecrets()
				if err != nil {
					return nil, fmt.Errorf("terminal credential filter is unavailable")
				}
				result = session.terminalRead(p.Offset, secrets...)
			} else {
				result = shell.read(ShellRead{SessionID: p.SessionID, Offset: p.Offset, MaxOutputTokens: 4096})
			}
		case "workspace.terminal_input", "workspace.terminal_resize":
			// Bind the mutation at its acceptance boundary, not only before the
			// log/session lookup. A new model turn may have begun in between.
			w.manager.mu.Lock()
			if j.record.Generation != p.Generation || j.shell != shell || w.manager.ctx.Err() != nil {
				w.manager.mu.Unlock()
				return nil, fmt.Errorf("terminal task changed before input was accepted")
			}
			if action == "workspace.terminal_resize" {
				result = session.resize(p.Columns, p.Rows)
			} else {
				result = session.userInput(ctx, p)
			}
			w.manager.mu.Unlock()
		default:
			return nil, fmt.Errorf("unknown terminal action")
		}
		result.OutputRef = ""
		response["result"] = result
	}
	// Apply the same configured-credential redaction as task snapshots/receipts.
	var safe map[string]any
	if err := json.Unmarshal([]byte(w.manager.redact(string(rawJSON(response)))), &safe); err != nil {
		return nil, err
	}
	return safe, nil
}

// Only the scoped terminal view receives VT bytes. Model output and ordinary
// logs continue through CleanShellText. The UI has its own byte cursor.
func (j *shellJob) terminalRead(offset int64, secrets ...string) ShellResult {
	j.mu.Lock()
	r := j.result
	j.mu.Unlock()
	if !r.TTY {
		return shellFailure("not_pty", "此进程不是 PTY，请查看日志")
	}
	if offset < 0 || offset > r.LoggedBytes {
		return shellFailure("invalid_offset", "终端读取位置无效")
	}
	// Inspect both sides of a page boundary before emitting bytes. Masking keeps
	// byte lengths stable, including when a caller starts inside a credential.
	overlap := 0
	for _, secret := range secrets {
		overlap = max(overlap, len(secret)-1)
	}
	start := max(int64(0), offset-int64(overlap))
	end := min(r.LoggedBytes, offset+32768)
	b, err := readShellRange(r.OutputRef, start, int(min(r.LoggedBytes, end+int64(overlap))-start))
	if err != nil {
		return shellFailure("log_unavailable", err.Error())
	}
	end = min(end, start+int64(len(b)))
	// A live suffix may still become a configured secret. Hold that suffix;
	// after capture ends, mask it instead of exposing a partial credential.
	safeEnd := len(b)
	masked := bytes.Clone(b)
	for _, secret := range secrets {
		if secret == "" {
			continue
		}
		key := []byte(secret)
		for pos := 0; pos < len(b); {
			at := bytes.Index(b[pos:], key)
			if at < 0 {
				break
			}
			at += pos
			for i := at; i < at+len(key); i++ {
				masked[i] = '*'
			}
			pos = at + 1
		}
		if start+int64(len(b)) == r.LoggedBytes {
			for n := min(len(key)-1, len(b)); n > 0; n-- {
				if bytes.Equal(b[len(b)-n:], key[:n]) {
					if r.Pending() && !r.PrivateOutput && !r.LogIncomplete {
						safeEnd = min(safeEnd, len(b)-n)
					} else {
						for i := len(b) - n; i < len(b); i++ {
							masked[i] = '*'
						}
					}
					break
				}
			}
		}
	}
	end = max(offset, min(end, start+int64(safeEnd)))
	chunk := masked[offset-start : end-start]
	// A read boundary must not split Chinese or other multibyte characters.
	if len(chunk) > 0 {
		last := len(chunk) - 1
		for last > 0 && !utf8.RuneStart(chunk[last]) {
			last--
		}
		if !utf8.FullRune(chunk[last:]) && (end < r.LoggedBytes || r.Pending()) {
			chunk = chunk[:last]
		}
	}
	r.TerminalOutput = string(chunk)
	r.NextOffset = offset + int64(len(chunk))
	r.Truncated = r.NextOffset < r.LoggedBytes || r.LogIncomplete
	return r
}

func (j *shellJob) resize(columns, rows int) ShellResult {
	if columns < 2 || columns > 500 || rows < 2 || rows > 300 {
		return shellFailure("invalid_size", "终端尺寸应在 2–500 列、2–300 行之间")
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	if !j.result.TTY || j.result.State != "running" || j.process == nil {
		return shellFailure("not_running_pty", "当前没有运行中的 PTY")
	}
	process, ok := j.process.(platform.TerminalProcess)
	if !ok {
		return shellFailure("resize_unavailable", "该平台进程不支持调整终端尺寸")
	}
	if err := process.Resize(columns, rows); err != nil {
		return shellFailure("resize_failed", err.Error())
	}
	j.result.Columns, j.result.Rows = columns, rows
	if err := j.persist(); err != nil {
		return shellFailure("resize_persistence_failed", "尺寸已调整，但无法保存回执")
	}
	return j.result
}

// Input is accepted once and written asynchronously. A blocked pipe must not
// hold the task lock or turn a view disconnect into process cancellation.
// Only the bounded byte buffer survives until Write returns; no input payload
// is written to task history, activity receipts or shell metadata.
func (j *shellJob) userInput(ctx context.Context, p workspaceTerminalRequest) ShellResult {
	if err := ctx.Err(); err != nil {
		return shellFailure("view_disconnected", "输入未提交，请重新连接")
	}
	if p.Terminate {
		if p.Chars != "" || p.PressEnter || p.Private {
			return shellFailure("invalid_arguments", "停止不能同时发送输入")
		}
		j.stop("cancelled")
		j.mu.Lock()
		result := j.result
		j.mu.Unlock()
		return result
	}
	if p.RequestID == "" || len(p.RequestID) > 128 || len(p.Chars) > 4096 || p.Chars == "" && !p.PressEnter {
		return shellFailure("invalid_arguments", "输入需要唯一请求编号，且每次不超过 4 KiB")
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	sequenced := p.InputClient != "" || p.InputSequence != 0
	if sequenced {
		if !j.result.TTY || len(p.InputClient) < 16 || len(p.InputClient) > 128 || p.InputSequence < 1 || p.InputSequence > 1000000000 || p.Private || p.PressEnter {
			return shellFailure("invalid_input_sequence", "PTY 按键需要有效的客户端和递增序号；敏感输入请使用专用输入框")
		}
		if p.InputSequence <= j.uiSequences[p.InputClient] {
			if j.result.InputClient == p.InputClient && j.result.InputSequence == p.InputSequence {
				return j.result
			}
			return shellFailure("already_submitted", "该按键序号已提交，不会重复发送")
		}
		if p.InputSequence != j.uiSequences[p.InputClient]+1 || j.uiSequences[p.InputClient] == 0 && len(j.uiSequences) >= 32 {
			return shellFailure("input_sequence_changed", "终端按键连接已改变，请重新打开终端")
		}
	}
	if j.uiInputs[p.RequestID] || j.result.InputID == p.RequestID {
		if j.result.InputID != p.RequestID {
			return shellFailure("already_submitted", "该输入已提交，不会重复发送")
		}
		return j.result
	}
	if j.result.State != "running" || j.process == nil {
		return shellFailure("process_ended", "进程已结束，无法发送输入")
	}
	if j.result.InputState == "pending" {
		return shellFailure("input_pending", "上一次输入仍在写入，请等待回执或明确停止进程")
	}
	if p.PressEnter && !j.result.TTY {
		return shellFailure("invalid_arguments", "管道输入请明确发送换行；Enter 按键只适用于 PTY")
	}
	if !sequenced && len(j.uiInputs) >= 128 {
		return shellFailure("input_limit", "本终端已达到 128 次界面输入上限")
	}
	previous := j.result
	if p.Private {
		j.result.PrivateOutput = true
		j.result.InputNotice = runtimePrompt("Matrix/辅助指令/私密输入结果.txt")
	}
	j.result.InputID, j.result.InputState = p.RequestID, "pending"
	j.result.InputClient, j.result.InputSequence = p.InputClient, p.InputSequence
	// Commit the ID and private mode before touching stdin. A crash after this
	// boundary recovers as unknown, never as an invitation to resend the input.
	if err := j.persist(); err != nil {
		j.result = previous
		return shellFailure("input_persistence_failed", "无法保存输入回执，输入未发送")
	}
	if sequenced {
		if j.uiSequences == nil {
			j.uiSequences = map[string]int{}
		}
		j.uiSequences[p.InputClient] = p.InputSequence
	} else {
		if j.uiInputs == nil {
			j.uiInputs = map[string]bool{}
		}
		j.uiInputs[p.RequestID] = true
	}
	input := []byte(p.Chars)
	if p.PressEnter {
		input = append(input, '\r')
	}
	go func() {
		defer clear(input)
		j.inputMu.Lock()
		defer j.inputMu.Unlock()
		j.mu.Lock()
		process, running := j.process, j.result.State == "running"
		j.mu.Unlock()
		state := "failed"
		if running && process != nil {
			if n, err := process.Write(input); err == nil && n == len(input) {
				state = "written"
			}
		}
		j.mu.Lock()
		j.result.InputState = state
		if err := j.persist(); err != nil {
			j.result.InputNotice = formatPromptText(runtimePrompt("Matrix/辅助指令/输入回执保存失败.txt"), state)
		}
		j.mu.Unlock()
	}()
	return j.result
}
