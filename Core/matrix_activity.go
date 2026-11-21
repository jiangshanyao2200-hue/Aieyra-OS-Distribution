// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: AgentActivity; mergeShellPreview; ActivityPatch; activityPatch; agentActivityCache; newAgentActivityCache; put; activityArgs; activityText; internalActivityID; activityPreview; result; scan; Activity; activityPlanOutput
// Impact: python -B scripts/code-atlas.py show Core/matrix_activity.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	toolcontract "github.com/aieyra/aieyra-os/tool/contract"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// 过程是持久收据的只读投影；不进入模型上下文，也不创建第二个执行队列。
type AgentActivity struct {
	StartedAt    int64             `json:"started_at,omitempty"`
	Generation   int               `json:"generation"`
	Presentation *ToolPresentation `json:"presentation,omitempty"`
	Preview      json.RawMessage   `json:"preview,omitempty"`
	InputPreview json.RawMessage   `json:"input_preview,omitempty"`
	ID           string            `json:"id"`
	Sequence     int64             `json:"sequence"`
	Revision     int64             `json:"revision"`
	Parent       string            `json:"parent,omitempty"`
	Tool         string            `json:"tool"`
	Action       string            `json:"action,omitempty"`
	Title        string            `json:"title,omitempty"`
	Targets      []string          `json:"targets,omitempty"`
	State        string            `json:"state"`
	Detail       string            `json:"detail,omitempty"`
	Command      string            `json:"command,omitempty"`
	Input        string            `json:"input,omitempty"`
	Session      int               `json:"session_id,omitempty"`
	Cell         string            `json:"cell_id,omitempty"`
	Exit         *int              `json:"exit_code,omitempty"`
	Hidden       bool              `json:"hidden,omitempty"`
	HasInput     bool              `json:"-"`
	Recorded     bool              `json:"-"`
	Patch        *ActivityPatch    `json:"patch,omitempty"`
}

// Continuations carry deltas; keep the command's output when the shell closes.
func mergeShellPreview(previous, delta json.RawMessage) json.RawMessage {
	var old, next map[string]any
	if json.Unmarshal(previous, &old) != nil || json.Unmarshal(delta, &next) != nil {
		return delta
	}
	a, _ := old["output"].(string)
	b, _ := next["output"].(string)
	oldEnd, _ := old["next_offset"].(float64)
	newEnd, _ := next["next_offset"].(float64)
	text := a
	if b != "" && (newEnd == 0 || newEnd > oldEnd) {
		// Distinct offsets can contain identical lines; never deduplicate by text.
		if newEnd > oldEnd && newEnd-oldEnd < float64(len(b)) {
			start := len(b) - int(newEnd-oldEnd)
			for start < len(b) && b[start]&0xc0 == 0x80 {
				start++
			}
			text += b[start:]
		} else {
			text += b
		}
	}
	for k, v := range next {
		old[k] = v
	}
	if len(text) > 48<<10 {
		text = string([]rune(text)[max(0, len([]rune(text))-(12<<10)):])
		old["truncated"] = true
	}
	old["output"] = text
	data, _ := json.Marshal(old)
	return data
}

// 有界差异随完成增量发送一次，完整原文保留在持久收据，空轮询不重复发送。
type ActivityPatch struct {
	State        string      `json:"state"`
	Files        []PatchFile `json:"files"`
	Omitted      int         `json:"omitted_lines"`
	OmittedFiles int         `json:"omitted_files,omitempty"`
}

func activityPatch(r PatchResult) *ActivityPatch {
	p := &ActivityPatch{State: r.State, Files: []PatchFile{}}
	lines, budget := 32, 8192
	for _, f := range r.Files {
		if len(p.Files) >= 16 {
			p.OmittedFiles++
			for _, h := range f.Hunks {
				p.Omitted += len(h.Lines)
			}
			continue
		}
		copy := f
		copy.Hunks = nil
		copy.BeforeHash, copy.AfterHash = "", ""
		for _, h := range f.Hunks {
			part := h
			part.Lines = nil
			for _, line := range h.Lines {
				if lines <= 0 || budget <= 0 {
					p.Omitted++
					continue
				}
				text := utf8Prefix(line.Text, min(600, budget))
				if len(text) < len(line.Text) {
					text += "…"
				}
				line.Text = text
				part.Lines = append(part.Lines, line)
				lines--
				budget -= len(text)
			}
			if len(part.Lines) > 0 {
				copy.Hunks = append(copy.Hunks, part)
			}
		}
		if len(p.Files) < 16 {
			p.Files = append(p.Files, copy)
		}
	}
	return p
}

type agentActivityCache struct {
	mu         sync.Mutex
	offsets    map[string]int64
	items      map[string]AgentActivity
	sessions   map[int]string
	cells      map[string]string
	sequence   int64
	revision   int64
	archived   map[string]int64 // Small tombstones prevent old receipts resurfacing.
	generation int
	actor      string // Retained across bounded scans of a shared durable archive.
}

func newAgentActivityCache() *agentActivityCache {
	return &agentActivityCache{offsets: map[string]int64{}, items: map[string]AgentActivity{}, sessions: map[int]string{}, cells: map[string]string{}, archived: map[string]int64{}}
}

func (c *agentActivityCache) put(v AgentActivity) {
	if _, gone := c.archived[v.ID]; gone {
		return
	}
	old, exists := c.items[v.ID]
	if exists {
		v.Sequence, v.Revision = old.Sequence, old.Revision
		a, _ := json.Marshal(old)
		b, _ := json.Marshal(v)
		if bytes.Equal(a, b) && old.HasInput == v.HasInput && old.Recorded == v.Recorded {
			return
		}
	} else {
		c.sequence++
		v.Sequence = c.sequence
	}
	c.revision++
	v.Revision = c.revision
	c.items[v.ID] = v
}

func activityArgs(call ToolCall) map[string]json.RawMessage {
	var args map[string]json.RawMessage
	_ = json.Unmarshal([]byte(call.Function.Arguments), &args)
	return args
}

func activityText(args map[string]json.RawMessage, name string) string {
	var v string
	_ = json.Unmarshal(args[name], &v)
	return utf8Prefix(v, 2000)
}

// 模型配置、窗口这类内部编号（matrix-8b39…）用户看不懂，不进显示。
var internalActivityID = regexp.MustCompile(`^(?:[a-z][a-z0-9]*[-_])?[0-9a-f]{12,}$`)

func activityPreview(call ToolCall, id, parent string) AgentActivity {
	if canonical, err := canonicalTerminalCall(call); err == nil {
		call = canonical
	}
	a := activityArgs(call)
	v := AgentActivity{ID: id, Parent: parent, Tool: call.Function.Name, Title: activityText(a, "description"), State: "queued"}
	// Display the stage summary from the existing intent without duplicating it
	// in model tool results. Only these public memory arguments are projected.
	if v.Tool == "memory" && (activityText(a, "action") == "seal" || activityText(a, "action") == "merge") {
		fields := map[string]string{}
		for _, key := range []string{"title", "content", "keywords"} {
			var value string
			if json.Unmarshal(a[key], &value) == nil && value != "" {
				fields[key] = utf8Prefix(value, 12000)
			}
		}
		v.InputPreview = rawJSON(fields)
	}
	// 生成文档同样带上标题和正文，否则展示台只能写“生成文档”，没有详情可看。
	if (v.Tool == "report" || v.Tool == "workspace") && activityText(a, "action") == "report" {
		fields := map[string]string{}
		for _, key := range []string{"title", "format", "content"} {
			var value string
			if json.Unmarshal(a[key], &value) == nil && value != "" {
				fields[key] = utf8Prefix(value, 12000)
			}
		}
		v.InputPreview = rawJSON(fields)
	}
	if isWorkspaceTool(v.Tool) || v.Tool == "agents" || v.Tool == "core_link" {
		v.Action = activityText(a, "action")
		if value := activityText(a, "query"); value != "" {
			v.Targets = append(v.Targets, value)
		}
	}
	if programDelegationAction(v.Tool, v.Action) {
		v.Title = map[string]string{"program_send": "派工给程序专员", "program_result": "查看程序专员结果", "program_cancel": "停止程序委派"}[v.Action]
		v.Targets = nil
		v.InputPreview = programReceiptInput(v.Action, a)
		return v
	}
	if v.Tool == "core_link" {
		// Project the actual task for display, keeping routing IDs and arbitrary
		// arguments in the original receipt rather than the readable summary.
		var message string
		if json.Unmarshal(a["message"], &message) == nil && message != "" {
			v.InputPreview = rawJSON(map[string]string{"message": utf8Prefix(message, 12000)})
		}
	}
	if v.Tool == "agents" {
		if strings.HasPrefix(v.Action, "identity_") {
			fields := map[string]any{}
			for _, key := range []string{"reason", "task", "outcome"} {
				if value := activityText(a, key); value != "" {
					fields[key] = value
				}
			}
			var command map[string]json.RawMessage
			_ = json.Unmarshal(a["command"], &command)
			for _, key := range []string{"success", "exit", "user_reference"} {
				if value := activityText(command, key); value != "" {
					fields[key] = value
				}
			}
			var plan []string
			if json.Unmarshal(command["plan"], &plan) == nil {
				for i := range plan {
					plan[i] = utf8Prefix(plan[i], 2000)
				}
				fields["plan"] = plan[:min(len(plan), 32)]
			}
			v.InputPreview = rawJSON(fields)
		}
		for _, key := range []string{"title", "name", "model_id", "agent_id", "id"} {
			if value := activityText(a, key); value != "" {
				v.Targets = append(v.Targets, value)
			}
		}
	}
	v.HasInput = activityText(a, "chars") != "" || string(a["press_enter"]) == "true"
	v.HasInput = v.HasInput || string(a["terminate"]) == "true"
	if v.Tool == "write_stdin" {
		v.Input = activityText(a, "chars")
	}
	// Waiting for an existing shell is still the same command before its receipt
	// arrives. Publish the session from the intent so the UI can group it then.
	if v.Tool == "write_stdin" || v.Tool == "read_shell_output" {
		_ = json.Unmarshal(a["session_id"], &v.Session)
		if v.Session < 0 {
			v.Session = 0
		}
	}
	if v.Tool == "exec_command" {
		v.Command = activityText(a, "cmd")
		if wd := activityText(a, "workdir"); wd != "" {
			v.Targets = []string{wd}
		}
	}
	if v.Tool == "toolbox" {
		v.Tool = activityText(a, "name")
		if v.Tool == "" {
			v.Tool = "toolbox"
		}
		v.Action = activityText(a, "action")
		if v.Action == "open" {
			v.Action = "load_tool"
		}
		if v.Action == "close" {
			v.Action = "unload_tool"
		}
		var nested map[string]json.RawMessage
		_ = json.Unmarshal(a["arguments"], &nested)
		if action := activityText(nested, "action"); v.Action == "call" && action != "" {
			v.Action = action
		}
		if v.Tool == "browser" {
			fields := map[string]any{}
			for _, key := range []string{"script", "value", "key", "selector", "text", "name", "role", "url", "query", "frame_id", "element_id", "files"} {
				if raw, ok := nested[key]; ok {
					var value any
					if json.Unmarshal(raw, &value) == nil {
						if text, ok := value.(string); ok {
							value = utf8Prefix(text, 12000)
						}
						if key == "value" && v.Action == "fill" {
							value = "输入内容等待页面确认"
						}
						fields[key] = value
					}
				}
			}
			v.InputPreview = rawJSON(fields)
		}
		for _, key := range []string{"title", "model_id", "url", "query", "tab_id", "id", "path", "workdir", "connection_id", "window_id"} {
			if value := activityText(nested, key); value != "" && !internalActivityID.MatchString(value) {
				v.Targets = append(v.Targets, value)
			}
		}
		if v.Title == "" {
			_, v.Title = toolboxDescribe(call)
		}
	}
	if v.Tool == "apply_patch" {
		var patch string
		_ = json.Unmarshal(a["patch"], &patch)
		for _, line := range strings.Split(patch, "\n") {
			for _, prefix := range []string{"*** Add File: ", "*** Update File: ", "*** Delete File: "} {
				if strings.HasPrefix(line, prefix) && len(v.Targets) < 64 {
					v.Targets = append(v.Targets, utf8Prefix(strings.TrimPrefix(line, prefix), 500))
				}
			}
		}
	}
	if path := activityText(a, "path"); path != "" {
		v.Targets = append(v.Targets, path)
	}
	// 搜索在完成前就把关键词交给界面，展示台先"敲"出关键词（UI设计知识库 形态 §15.11 V2）。
	if v.Tool == "web_search" {
		if query := activityText(a, "query"); query != "" {
			v.Targets = append(v.Targets, utf8Prefix(query, 400))
		}
	}
	if v.Tool == "workspace" {
		if workdir := activityText(a, "workdir"); workdir != "" {
			v.Targets = append(v.Targets, workdir)
		}
	}
	return v
}

func (c *agentActivityCache) result(id string, call ToolCall, output string) {
	if _, gone := c.archived[id]; gone {
		return
	}
	v, ok := c.items[id]
	if !ok {
		v = activityPreview(call, id, "")
	}
	var r struct {
		Presentation *ToolPresentation `json:"presentation"`
		OK           *bool             `json:"ok"`
		State        json.RawMessage   `json:"state"`
		Session      json.RawMessage   `json:"session_id"`
		Cell         string            `json:"cell_id"`
		Exit         *int              `json:"exit_code"`
		Error        json.RawMessage   `json:"error"`
		Files        json.RawMessage   `json:"files"`
	}
	if toolcontract.ValidPackageID(v.Tool) {
		var incoming ToolboxResult
		if json.Unmarshal([]byte(output), &incoming) == nil && incoming.Package == "" && len(v.Preview) > 0 {
			output = string(continuePackagePreview(v.Preview, json.RawMessage(output)))
		}
	}
	raw := bytes.TrimSpace([]byte(output))
	if len(raw) == 0 || raw[0] != '{' || json.Unmarshal(raw, &r) != nil {
		v.State, v.Detail = "failed", "Invalid tool receipt"
		c.put(v)
		return
	}
	// Tool-specific data does not share a type just because a field has the
	// same name: project.files is a count, patch.files is a list, and workspace
	// session IDs are strings. Only shell receipts identify process sessions.
	var session int
	shell := v.Tool == "exec_command" || v.Tool == "write_stdin" || v.Tool == "read_shell_output"
	if shell && len(r.Session) > 0 && json.Unmarshal(r.Session, &session) != nil {
		v.State, v.Detail = "failed", "Invalid shell session receipt"
		c.put(v)
		return
	}
	var files []struct {
		Path string `json:"path"`
	}
	if len(r.Files) > 0 && r.Files[0] == '[' {
		_ = json.Unmarshal(r.Files, &files)
	}
	v.Detail = ""
	var resultState string
	_ = json.Unmarshal(r.State, &resultState)
	v.Recorded = true
	if toolcontract.VersionedID(v.Tool) && r.Presentation != nil && toolcontract.ValidatePresentation(r.Presentation) == nil {
		v.Presentation = r.Presentation
	}
	var packageResult ToolboxResult
	privateProgram := programDelegationAction(v.Tool, v.Action)
	if privateProgram {
		v.Preview = programReceiptOutput(output)
	} else if toolcontract.ValidPackageID(v.Tool) && json.Unmarshal([]byte(output), &packageResult) == nil && packageResult.Package != "" {
		v.Preview = boundedPackagePreview(packageResult)
	} else if len(output) <= 64<<10 {
		v.Preview = json.RawMessage(output)
	} else {
		data, _ := json.Marshal(map[string]any{"text": utf8Prefix(output, 48<<10), "truncated": true})
		v.Preview = data
	}
	if v.Tool == "apply_patch" {
		var patch PatchResult
		if json.Unmarshal([]byte(output), &patch) == nil {
			v.Patch = activityPatch(patch)
		}
	}
	v.State = "completed"
	errorPresent := len(r.Error) > 0 && string(r.Error) != "null" && string(r.Error) != "\"\""
	if resultState == "running" || resultState == "starting" || resultState == "queued" {
		v.State = "running"
	}
	if r.OK != nil && !*r.OK || r.Exit != nil && *r.Exit != 0 || errorPresent {
		v.State = "failed"
	}
	if resultState == "cancelled" || resultState == "timed_out" || resultState == "interrupted_unknown" {
		v.State = resultState
	}
	if errorPresent && privateProgram {
		v.Detail = "程序协作操作未完成"
	} else if errorPresent {
		var errObject ShellError
		if json.Unmarshal(r.Error, &errObject) == nil && errObject.Message != "" {
			v.Detail = utf8Prefix(errObject.Message, 1200)
		} else {
			v.Detail = utf8Prefix(string(r.Error), 1200)
		}
	}
	v.Session, v.Cell, v.Exit = session, r.Cell, r.Exit
	// The poll/input operation has returned even if its process is still alive.
	// Keep the process state on the original row, and settle this receipt so it
	// cannot later turn into a fabricated interruption at the end of the turn.
	processState := v.State
	if v.State == "running" && (v.Tool == "write_stdin" || v.Tool == "read_shell_output" || v.Tool == "wait") {
		v.State = "completed"
	}
	if len(files) > 0 {
		v.Targets = nil
		for _, f := range files[:min(len(files), 64)] {
			v.Targets = append(v.Targets, utf8Prefix(f.Path, 500))
		}
	}
	if session > 0 {
		if source, exists := c.sessions[session]; exists && source != id {
			if base, exists := c.items[source]; exists && resultState != "failed" && resultState != "" {
				base.State, base.Exit, base.Detail = processState, v.Exit, v.Detail
				base.Preview = mergeShellPreview(base.Preview, v.Preview)
				c.put(base)
			}
			// 空轮询只更新原过程；有输入或失败仍保留独立行。
			if !v.HasInput && v.State != "failed" {
				v.Hidden = true
				c.put(v)
				return
			}
		} else if v.Tool == "exec_command" {
			c.sessions[session] = id
		}
	}
	if r.Cell != "" {
		if source, exists := c.cells[r.Cell]; exists && source != id && call.Function.Name == "wait" {
			if base, exists := c.items[source]; exists {
				base.State, base.Detail = processState, v.Detail
				if toolcontract.ValidPackageID(base.Tool) {
					base.Preview = continuePackagePreview(base.Preview, v.Preview)
				}
				c.put(base)
			}
			if v.State != "failed" {
				v.Hidden = true
				c.put(v)
				return
			}
		} else {
			c.cells[r.Cell] = id
		}
	}
	c.put(v)
}

// 半条尾行下次再读；尺寸检查在累积期间进行，避免超大行先无限分配。
func (c *agentActivityCache) scan(path string, visit func([]byte) error) (bool, error) {
	f, err := os.Open(path)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return false, err
	}
	offset := c.offsets[path]
	if offset > stat.Size() {
		return false, fmt.Errorf("activity archive changed; reopen task details")
	}
	if _, err = f.Seek(offset, io.SeekStart); err != nil {
		return false, err
	}
	reader := bufio.NewReader(io.LimitReader(f, stat.Size()-offset))
	for n, consumed := 0, 0; n < 256 && consumed < 2<<20; n++ {
		var line []byte
		for {
			part, e := reader.ReadSlice('\n')
			if len(line)+len(part) > 8<<20 {
				return false, fmt.Errorf("activity event exceeds 8 MiB")
			}
			line = append(line, part...)
			if e == bufio.ErrBufferFull {
				continue
			}
			if e == io.EOF {
				return len(line) > 0, nil
			}
			if e != nil {
				return false, e
			}
			break
		}
		if err = visit(line); err != nil {
			return false, err
		}
		consumed += len(line)
		c.offsets[path] += int64(len(line))
	}
	return c.offsets[path] < stat.Size(), nil
}

func (m *AgentManager) Activity(owner, id string, since, before int64, limit int) (any, error) {
	if next, actor := m.taskManager(owner, id); next != m {
		return next.Activity(actor, id, since, before, limit)
	}
	if since < 0 || before < 0 || limit < 0 || limit > 400 {
		return nil, fmt.Errorf("invalid activity cursor or limit (1..400)")
	}
	if limit == 0 {
		limit = 120
	}
	m.mu.Lock()
	if !m.ownsLocked(owner, id) {
		m.mu.Unlock()
		return nil, fmt.Errorf("agent not owned by caller")
	}
	j := m.jobs[id]
	if j.activity == nil {
		j.activity = newAgentActivityCache()
	}
	c, shell, state, archive := j.activity, j.shell, j.record.State, j.archive
	m.mu.Unlock()
	c.mu.Lock()
	defer c.mu.Unlock()
	source := historySource{path: filepath.Join(m.dir, "sessions", id+".jsonl"), archive: archive}
	if archive != nil {
		source.path = archive.Path
	}
	visit := func(line []byte) error {
		var event struct {
			Kind  string          `json:"kind"`
			Value json.RawMessage `json:"value"`
			At    string          `json:"at"`
		}
		if e := json.Unmarshal(line, &event); e != nil {
			return e
		}
		// A reopened home has a new runtime agent whose generation starts over.
		// History belongs to its recorded actor, even when generation numbers match.
		if event.Kind != "meta" && c.actor != "" && c.actor != id {
			return nil
		}
		switch event.Kind {
		case "compaction_state", "checkpoint":
			var maintenance CompactionState
			var cp Checkpoint
			if event.Kind == "checkpoint" {
				if err := json.Unmarshal(event.Value, &cp); err != nil {
					return err
				}
				if cp.Compaction == nil {
					break
				}
				maintenance = *cp.Compaction
			} else if err := json.Unmarshal(event.Value, &maintenance); err != nil {
				return err
			}
			if maintenance.RequestID == "" || event.Kind != "checkpoint" && maintenance.State == "completed" {
				break
			}
			key := compactionKey(maintenance.RequestID)
			v := c.items[key]
			if v.ID == "" {
				v = AgentActivity{ID: key, Tool: "memory", Action: "compact", Title: "压缩记忆", Generation: c.generation}
				if at, err := time.Parse(time.RFC3339Nano, event.At); err == nil {
					v.StartedAt = at.UnixMicro()
				}
			}
			v.State = maintenance.State
			if v.State == "scheduled" {
				v.State = "queued"
			}
			v.Detail = compactionPhaseText(&maintenance)
			preview := map[string]any{"compaction": maintenance}
			end := maintenance.Covered
			if event.Kind == "checkpoint" {
				end = cp.Covered
				after := m.redact(checkpointText(&cp))
				preview["after"] = utf8Prefix(after, 12000)
				preview["after_more"] = len(after) > 12000
			}
			if end > maintenance.First {
				ref := historyRef{source: source, offset: c.offsets[source.path], size: len(line), kind: event.Kind}
				before, err := compactionSourcePage(ref, maintenance.First, end, 0, 12000, m.redact)
				if err != nil {
					preview["source_error"] = "原文预览暂不可用，请从历史重试。"
				} else {
					preview["before"] = before.Text
					preview["before_more"] = before.Next > 0
				}
			}
			v.Preview = rawJSON(preview)
			c.put(v)
		case "meta":
			var meta struct {
				Generation int    `json:"workspace_generation"`
				Actor      string `json:"workspace_agent"`
			}
			if json.Unmarshal(event.Value, &meta) == nil && meta.Generation > 0 {
				c.generation = meta.Generation
				c.actor = meta.Actor
			}
		case "tool_intent":
			var intent ToolIntent
			if e := json.Unmarshal(event.Value, &intent); e != nil {
				return e
			}
			for _, call := range intent.Response.ToolCalls {
				key := intent.InvocationID + ":" + call.ID
				v := activityPreview(call, key, "")
				v.Generation = c.generation
				if at, err := time.Parse(time.RFC3339Nano, event.At); err == nil {
					v.StartedAt = at.UnixMicro()
				}
				c.put(v)
			}
		case "tool_progress":
			var receipt ToolReceipt
			if e := json.Unmarshal(event.Value, &receipt); e != nil {
				return e
			}
			v := c.items[receipt.Key]
			output := receipt.Output
			if receipt.Patch != nil {
				full, _ := json.Marshal(receipt.Patch)
				output = string(full)
			}
			c.result(receipt.Key, ToolCall{Function: FunctionCall{Name: v.Tool}}, output)
		case "tool_turn":
			var turn ToolTurn
			if e := json.Unmarshal(event.Value, &turn); e != nil {
				return e
			}
			if len(turn.Messages) == 0 {
				break
			}
			for _, call := range turn.Messages[0].ToolCalls {
				if canonical, err := canonicalTerminalCall(call); err == nil {
					call = canonical
				}
				key := turn.InvocationID + ":" + call.ID
				if _, ok := c.items[key]; !ok && call.Function.Name != "wait" && call.Function.Name != "write_stdin" && call.Function.Name != "read_shell_output" {
					v := activityPreview(call, key, "")
					v.Generation = c.generation
					if at, err := time.Parse(time.RFC3339Nano, event.At); err == nil {
						v.StartedAt = at.UnixMicro()
					}
					c.put(v)
				}
				for _, msg := range turn.Messages[1:] {
					if msg.ToolCallID == call.ID {
						if !c.items[key].Recorded {
							output := msg.Content
							// Plan updates intentionally return compact deltas to the model.
							// The display projects the committed state from the same receipt.
							if call.Function.Name == "update_plan" {
								for _, receipt := range turn.Receipts {
									if receipt.Key == key && receipt.Transition != nil {
										output = activityPlanOutput(output, receipt.Transition.State)
									}
								}
							}
							c.result(key, call, output)
						}
					}
				}
			}
		}
		return nil
	}
	var more bool
	var err error
	if archive != nil && archive.ephemeral {
		archive.mu.Lock()
		offset := c.offsets[archive.Path]
		if offset < 0 || offset > int64(len(archive.memory)) {
			archive.mu.Unlock()
			return nil, fmt.Errorf("invalid activity cursor")
		}
		end := int(offset)
		for n := 0; n < 256 && end-int(offset) < 2<<20 && end < len(archive.memory); n++ {
			next := bytes.IndexByte(archive.memory[end:], '\n')
			if next < 0 {
				break
			}
			if next > 8<<20 {
				archive.mu.Unlock()
				return nil, fmt.Errorf("activity event exceeds 8 MiB")
			}
			end += next + 1
		}
		data := append([]byte(nil), archive.memory[offset:end]...)
		more = end < len(archive.memory)
		archive.mu.Unlock()
		for _, line := range bytes.SplitAfter(data, []byte{'\n'}) {
			if len(line) == 0 {
				continue
			}
			if err = visit(line); err != nil {
				break
			}
			c.offsets[archive.Path] += int64(len(line))
		}
	} else {
		path := filepath.Join(m.dir, "sessions", id+".jsonl")
		if archive != nil {
			// Managed home conversations append to their durable context archive,
			// independently of the current runtime's agent ID and directory.
			path = archive.Path
		}
		more, err = c.scan(path, visit)
	}
	if err != nil {
		return nil, err
	}
	paths, _ := filepath.Glob(filepath.Join(m.dir, id+".shell", "cells", "*.jsonl"))
	for _, path := range paths {
		cell := strings.TrimSuffix(filepath.Base(path), ".jsonl")
		pending, e := c.scan(path, func(line []byte) error {
			var event cellEvent
			if e := json.Unmarshal(line, &event); e != nil {
				return e
			}
			if event.Type == "start" {
				if c.cells[cell] == "" {
					c.cells[cell] = event.Key
				}
			}
			if event.Type == "finish" {
				if key := c.cells[cell]; key != "" {
					data, _ := json.Marshal(map[string]any{"state": event.State, "error": event.Error, "cell_id": cell})
					c.result(key, ToolCall{Function: FunctionCall{Name: "exec"}}, string(data))
				}
			}
			if event.Type == "nested" && event.Record != nil {
				r := event.Record
				key := cell + ":" + strconv.Itoa(r.ID)
				if _, exists := c.items[key]; !exists {
					v := activityPreview(r.Call, key, c.cells[cell])
					v.Generation = c.items[c.cells[cell]].Generation
					v.StartedAt = event.At
					v.State = "running"
					c.put(v)
				}
				if r.Output != "" {
					c.result(key, r.Call, r.Output)
				}
			}
			return nil
		})
		if e != nil {
			return nil, e
		}
		more = more || pending
	}
	if shell != nil {
		rows, _ := shell.TrySnapshots()
		for _, r := range rows {
			if key := c.sessions[r.SessionID]; key != "" {
				// Elapsed time alone is not new content; avoid rebuilding details on every poll.
				r.DurationMS = 0
				data, _ := json.Marshal(r)
				c.result(key, ToolCall{Function: FunctionCall{Name: "exec_command"}}, string(data))
			}
		}
	}
	// A new explicit turn can start during the read above. Never mark its fresh
	// operations interrupted using the previous generation's finished state.
	m.mu.Lock()
	state = j.record.State
	m.mu.Unlock()
	for key, v := range c.items {
		if v.State == "queued" {
			if _, started := j.started.Load(key); started {
				v.State = "running"
				c.put(v)
			}
		}
		var terminal ShellResult
		retained := shell != nil && v.Session > 0 && json.Unmarshal(v.Preview, &terminal) == nil && terminal.Background && terminal.Pending()
		if !activeAgent(state) && (v.State == "queued" || v.State == "running") && !more && !retained {
			v.State = "interrupted_unknown"
			c.put(v)
		}
		if v.State != "queued" && v.State != "running" {
			j.started.Delete(key)
		}
	}
	// Keep detailed rows bounded. Full original receipts stay in events/archives;
	// tombstones are tiny and record that history moved out of this live view.
	if len(c.items) > 4096 {
		completed := []AgentActivity{}
		for _, v := range c.items {
			if v.State != "queued" && v.State != "running" {
				completed = append(completed, v)
			}
		}
		sort.Slice(completed, func(i, k int) bool { return completed[i].Sequence < completed[k].Sequence })
		for _, v := range completed {
			if len(c.items) <= 4096 {
				break
			}
			delete(c.items, v.ID)
			c.revision++
			c.archived[v.ID] = c.revision
		}
	}
	rows := []AgentActivity{}
	for _, v := range c.items {
		if (since == 0 || v.Revision > since) && (before == 0 || v.Sequence < before) {
			rows = append(rows, v)
		}
	}
	if since > 0 {
		for id, revision := range c.archived {
			if revision > since {
				rows = append(rows, AgentActivity{ID: id, Revision: revision, Hidden: true})
			}
		}
	}
	sort.Slice(rows, func(i, k int) bool {
		if since > 0 {
			return rows[i].Revision < rows[k].Revision
		}
		return rows[i].Sequence < rows[k].Sequence
	})
	hasOlder, cursor := false, c.revision
	if len(rows) > limit {
		if since > 0 {
			rows = rows[:limit]
			cursor = rows[len(rows)-1].Revision
			more = true
		} else {
			rows, hasOlder = rows[len(rows)-limit:], true
		}
	}
	page := "latest"
	if before > 0 {
		page = "older"
	} else if since > 0 {
		page = "delta"
	}
	for i := range rows {
		if toolcontract.ValidCustomID(rows[i].Tool) {
			if custom, e := m.customTool(rows[i].Tool); e == nil {
				rows[i].Presentation = custom.Presentation
			}
		}
	}
	data, err := json.Marshal(map[string]any{"items": rows, "cursor": cursor, "has_more": more, "has_older": hasOlder, "total": len(c.items) + len(c.archived), "state": state, "page": page, "archived_count": len(c.archived)})
	if err != nil {
		return nil, err
	}
	var clean map[string]any
	if err = json.Unmarshal([]byte(m.redact(string(data))), &clean); err != nil {
		return nil, err
	}
	return clean, nil
}

// This bounded projection changes neither model receipts nor the saved plan.
func activityPlanOutput(output string, state *PlanState) string {
	var data map[string]any
	if state == nil || json.Unmarshal([]byte(output), &data) != nil || data["ok"] != true {
		return output
	}
	data["state"] = ClonePlan(state)
	encoded, err := json.Marshal(data)
	if err != nil || len(encoded) > 64<<10 {
		return output
	}
	return string(encoded)
}
