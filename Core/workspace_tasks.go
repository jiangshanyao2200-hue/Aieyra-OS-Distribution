// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: taskList; localTaskList; childTask; taskMessageHash; taskRequestRows; taskStatus; taskSnapshot; taskCall
// Impact: python -B scripts/code-atlas.py show Core/workspace_tasks.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/aieyra/aieyra-os/contracts/storage"
)

// 标签页和终端只改变投影，任务仍归原有调度树及代际锁管理。
func (w *Workspace) taskList() []map[string]any {
	rows := w.localTaskList()
	for _, next := range w.splitWorkspaces() {
		rows = append(rows, next.localTaskList()...)
	}
	return rows
}

func (w *Workspace) localTaskList() []map[string]any {
	w.mu.Lock()
	root, primary := w.state.ID, w.state.Roles[WorkspaceMatrix]
	w.mu.Unlock()
	rows := []map[string]any{{"id": root, "title": "Eyra", "primary": true, "state": "idle"}}
	if w.split != nil {
		rows[0] = w.splitRow()
	}
	type taskRow struct {
		id, title, state, parent, created string
		generation                        int
	}
	var children []taskRow
	w.manager.mu.Lock()
	for id, job := range w.manager.jobs {
		if !w.manager.ownsLocked(root, id) {
			continue
		}
		r := &job.record
		if r.ID == primary {
			rows[0]["state"], rows[0]["generation"] = r.State, r.Generation
			continue
		}
		if r.Spec.WorkspaceRole != "" {
			continue
		}
		title := r.Spec.Title
		if title == "" {
			title = shortSpeech(r.Spec.Task, 32)
		}
		children = append(children, taskRow{r.ID, title, r.State, r.Parent, r.Created, r.Generation})
	}
	w.manager.mu.Unlock()
	for _, m := range []*AgentManager{w.manager.workboxHost.Load(), w.manager.packageHost.Load()} {
		if m == nil {
			continue
		}
		m.mu.Lock()
		for _, j := range m.jobs {
			r := &j.record
			if m.ownsLocked(m.owner, r.ID) {
				children = append(children, taskRow{r.ID, r.Spec.Title, r.State, root, r.Created, r.Generation})
			}
		}
		m.mu.Unlock()
	}
	sort.Slice(children, func(i, j int) bool {
		if children[i].created == children[j].created {
			return children[i].id < children[j].id
		}
		return children[i].created < children[j].created
	})
	for _, r := range children {
		rows = append(rows, map[string]any{"id": r.id, "title": w.manager.redact(r.title), "state": r.state, "generation": r.generation, "parent": r.parent})
	}
	return rows
}

func (w *Workspace) childTask(id string) (AgentRecord, error) {
	r, err := w.manager.Status(w.state.ID, id)
	if err != nil {
		return r, err
	}
	if r.Spec.WorkspaceRole != "" {
		return AgentRecord{}, fmt.Errorf("use the primary task view")
	}
	return r, nil
}

func taskMessageHash(message string) string { return fmt.Sprintf("%x", sha256.Sum256([]byte(message))) }

func taskRequestRows(r AgentRecord) []map[string]any {
	rows := []map[string]any{}
	for id, message := range r.Turns {
		generation := r.TurnGenerations[id]
		if generation == 0 && id == r.Spec.RequestID {
			generation = 1
		}
		if generation == 0 {
			continue
		}
		state, reply, detail := r.State, r.Result, r.Error
		if generation != r.Generation {
			state, reply, detail = "interrupted", "", ""
			for _, previous := range r.History {
				if previous.Generation == generation {
					state, reply, detail = previous.State, previous.Result, previous.Error
					break
				}
			}
		}
		phase := state
		if activeAgent(state) {
			state = "running"
		}
		hash := r.TurnHashes[id]
		if hash == "" {
			hash = taskMessageHash(message)
		}
		rows = append(rows, map[string]any{"request_id": id, "message_hash": hash, "generation": generation, "state": state, "phase": phase, "reply": reply, "error": detail})
	}
	sort.Slice(rows, func(i, j int) bool {
		a, b := rows[i]["generation"].(int), rows[j]["generation"].(int)
		if a == b {
			return rows[i]["request_id"].(string) < rows[j]["request_id"].(string)
		}
		return a < b
	})
	return rows
}

func (w *Workspace) taskStatus(id, request string) (any, error) {
	r, err := w.childTask(id)
	if err != nil {
		return nil, err
	}
	rows := taskRequestRows(r)
	for _, row := range rows {
		row["reply"] = w.manager.redact(row["reply"].(string))
		row["error"] = w.manager.redact(row["error"].(string))
	}
	if request != "" {
		for _, row := range rows {
			if row["request_id"] == request {
				return row, nil
			}
		}
		return nil, fmt.Errorf("request not found")
	}
	return map[string]any{"busy": activeAgent(r.State), "phase": r.State, "model": r.Spec.ModelID, "requests": rows}, nil
}

func (w *Workspace) taskSnapshot(id string, cursors WorkspaceCursor) (any, error) {
	m, owner := w.manager.taskManager(w.state.ID, id)
	if _, err := m.Humans(owner); err != nil {
		return nil, err
	}
	// Scan receipts before capturing the record. A concurrent continuation may
	// leave fewer visible receipts, but never pair a future turn with old state.
	activity, err := m.Activity(owner, id, cursors.Activity[WorkspaceMatrix], 0, 120)
	if err != nil {
		return nil, err
	}
	// 同一把调度锁下读取任务轮次与状态，不能把新轮次状态配给旧正文。
	m.mu.Lock()
	if !m.ownsLocked(owner, id) || m.jobs[id].record.Spec.WorkspaceRole != "" {
		m.mu.Unlock()
		return nil, fmt.Errorf("task not owned by caller")
	}
	j := m.jobs[id]
	r, row := copyRecord(j.record), workspaceJobStatus(j)
	plan := ClonePlan(j.plan)
	planGeneration := j.planGeneration
	m.mu.Unlock()
	row["role"] = WorkspaceMatrix
	page := activity.(map[string]any)
	items := []any{}
	for _, item := range page["items"].([]any) {
		v, ok := item.(map[string]any)
		if ok && (v["hidden"] == true || v["generation"] == float64(r.Generation)) {
			items = append(items, v)
		}
	}
	page["items"], page["state"] = items, r.State
	row["activity"] = activity
	if planGeneration != r.Generation {
		plan = nil
	}
	if plan != nil {
		_ = json.Unmarshal([]byte(w.manager.redact(string(rawJSON(plan)))), &plan)
	}
	_ = json.Unmarshal([]byte(w.manager.redact(string(rawJSON(row)))), &row)
	w.mu.Lock()
	live, theme := w.live[id], w.state.Theme
	w.mu.Unlock()
	if live.Generation != r.Generation {
		live = WorkspaceLive{Generation: r.Generation}
	}
	live.Text, live.Thought = w.manager.redact(live.Text), w.manager.redact(live.Thought)
	messages := []workspaceMessage{}
	for _, request := range taskRequestRows(r) {
		if request["generation"] != r.Generation {
			continue
		}
		key := request["request_id"].(string)
		at := r.SubmittedAt
		if at == "" && r.Generation == 1 {
			at = r.Created
		}
		messages = append(messages, workspaceMessage{ID: key, From: "user", To: WorkspaceMatrix, Text: w.manager.redact(r.Turns[key]), Attachments: r.TurnAttachments[key], State: request["state"].(string), Generation: r.Generation, At: at})
	}
	if !activeAgent(r.State) {
		messages = append(messages, workspaceMessage{ID: fmt.Sprintf("%s:%d:result", id, r.Generation), From: WorkspaceMatrix, To: "user", Text: w.manager.redact(r.Result), Error: w.manager.redact(r.Error), State: r.State, Generation: r.Generation, At: r.CompletedAt, RunTime: cloneRunTime(r.RunTime)})
	}
	documents := []WorkspaceDocument{}
	if m.packageService {
		scope := m.packageMemoryWorkspace(r)
		err := scope.refreshReportsLocked()
		scope.service.Close()
		if err != nil {
			return nil, err
		}
		documents = scope.state.Documents
	}
	updated, _ := time.Parse(time.RFC3339Nano, r.Updated)
	model := r.Spec.ModelID
	if s, e := w.manager.settings(model); e == nil {
		model = s.Model
	}
	// 微秒修订在 JS 安全整数范围；正文每次完整返回，不依赖时钟去重。
	return map[string]any{"version": 1, "session_id": id, "root_id": w.state.ID, "history_segment": id, "core_epoch": w.epoch, "ready": true, "workdir": storage.Relocate(w.config, r.Spec.Workdir), "model_name": w.manager.redact(model), "roles": []any{row}, "messages": messages, "message_total": len(messages), "messages_unchanged": false, "revision": max(int64(0), updated.UnixMicro()), "live": map[string]WorkspaceLive{WorkspaceMatrix: live}, "tasks": w.taskList(), "theme": theme, "events": []any{}, "cursor": 0, "documents": documents, "plan": plan, "plan_scope": map[string]any{"agent": id, "generation": r.Generation}, "greeting": WorkspaceGreeting{State: "skipped"}}, nil
}

// 每个操作显式绑定任务；不使用可被另一窗口覆盖的“当前任务”全局变量。
func (w *Workspace) taskCall(ctx context.Context, action string, raw json.RawMessage) (any, error) {
	var p struct {
		TaskID      string               `json:"task_id"`
		RequestID   string               `json:"request_id"`
		Message     string               `json:"message"`
		Attachments []ComposerAttachment `json:"attachments"`
		Generation  int                  `json:"generation"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if p.TaskID == "" || p.TaskID == w.state.ID {
		names := map[string]string{"workspace.task_snapshot": "workspace.snapshot", "workspace.task_status": "matrix.status", "workspace.task_send": "matrix.send", "workspace.task_cancel": "matrix.cancel"}
		if action == "workspace.task_cancel" && p.RequestID == "" {
			w.mu.Lock()
			defer w.mu.Unlock()
			if id := w.state.Roles[WorkspaceMatrix]; id != "" {
				r, err := w.manager.Status(w.state.ID, id)
				if err != nil {
					return nil, err
				}
				if r.Generation != p.Generation {
					return nil, fmt.Errorf("task generation changed; inspect before cancelling")
				}
			}
			return map[string]bool{"ok": true}, w.cancelLocked()
		}
		return w.Call(ctx, names[action], raw)
	}
	owner, err := w.taskOwner(p.TaskID)
	if err != nil {
		return nil, err
	}
	if owner != w {
		result, err := owner.taskCall(ctx, action, raw)
		if err == nil && action == "workspace.task_snapshot" {
			result = w.navigationSnapshot(result)
		}
		return result, err
	}
	task, err := w.childTask(p.TaskID)
	if err != nil {
		return nil, err
	}
	switch action {
	case "workspace.task_snapshot":
		var cursors WorkspaceCursor
		if err := json.Unmarshal(raw, &cursors); err != nil {
			return nil, err
		}
		return w.taskSnapshot(p.TaskID, cursors)
	case "workspace.task_status":
		return w.taskStatus(p.TaskID, p.RequestID)
	case "workspace.task_send":
		if p.Generation < 0 || p.Generation == 0 && task.Spec.AgentPackage == "" {
			return nil, fmt.Errorf("inspect the task generation before sending")
		}
		if _, err := w.manager.sendGenerationAttachments(w.state.ID, p.TaskID, p.RequestID, w.manager.redact(p.Message), attachmentMessageHash(p.Message, p.Attachments), p.Generation, p.Attachments); err != nil {
			return nil, err
		}
		return w.taskStatus(p.TaskID, p.RequestID)
	case "workspace.task_cancel":
		if p.Generation < 0 || p.Generation == 0 && task.Spec.AgentPackage == "" {
			return nil, fmt.Errorf("inspect the task generation before cancelling")
		}
		if p.RequestID != "" {
			value, err := w.taskStatus(p.TaskID, p.RequestID)
			if err != nil {
				return nil, err
			}
			if value.(map[string]any)["generation"] != p.Generation {
				return nil, fmt.Errorf("request generation changed")
			}
		}
		return map[string]bool{"ok": true}, w.manager.CancelGeneration(w.state.ID, p.TaskID, p.Generation)
	}
	return nil, fmt.Errorf("unknown task action")
}
