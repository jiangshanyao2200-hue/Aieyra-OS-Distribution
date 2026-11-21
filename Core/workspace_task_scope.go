// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: taskOwner; scopedWorkspaceAction; scopedTaskCall; navigationSnapshot
// Impact: python -B scripts/code-atlas.py show Core/workspace_task_scope.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
)

// 只沿调用者已拥有的任务树定位。进程中存在某个 ID 不构成访问授权。
func (w *Workspace) taskOwner(id string) (*Workspace, error) {
	if id == "" || id == w.state.ID {
		return w, nil
	}
	if next := w.splitTarget(id); next != nil {
		return next, nil
	}
	if _, err := w.childTask(id); err == nil {
		return w, nil
	}
	for _, next := range w.splitWorkspaces() {
		if _, err := next.childTask(id); err == nil {
			return next, nil
		}
	}
	return nil, fmt.Errorf("task not owned by caller")
}

func scopedWorkspaceAction(action string) bool {
	switch action {
	case "workspace.ask_reply", "workspace.withdraw", "workspace.messages", "workspace.history", "workspace.receipt", "workspace.document", "workspace.document_state", "workspace.configure", "workspace.workflow", "workspace.acknowledge", "workspace.collaboration", "workspace.notice", "workspace.greet", "workspace.selfcheck", "workspace.artifact", "workspace.diary":
		return true
	}
	return false
}

// 独立任务复用同一个合同；普通 helper 只开放已有的局部记录，不能退回母体操作。
func (w *Workspace) scopedTaskCall(ctx context.Context, action string, raw json.RawMessage, id string) (any, error) {
	owner, err := w.taskOwner(id)
	if err != nil {
		return nil, err
	}
	if owner != w {
		return owner.Call(ctx, action, raw)
	}
	if action == "workspace.document" || action == "workspace.document_state" {
		m, actor := w.manager.taskManager(w.state.ID, id)
		if m.packageService {
			r, err := m.Status(actor, id)
			if err != nil {
				return nil, err
			}
			scope := m.packageMemoryWorkspace(r)
			defer scope.service.Close()
			if action == "workspace.document_state" {
				return scope.documentState(raw)
			}
			var p struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(raw, &p); err != nil {
				return nil, err
			}
			return scope.readDocument(p.ID)
		}
	}
	switch action {
	case "workspace.history":
		return w.historyPage(raw)
	case "workspace.receipt":
		return w.historyReceipt(raw)
	case "workspace.messages":
		result, err := w.taskSnapshot(id, WorkspaceCursor{})
		if err != nil {
			return nil, err
		}
		return map[string]any{"messages": result.(map[string]any)["messages"], "before": 0, "has_more": false}, nil
	}
	return nil, fmt.Errorf("this action is unavailable for a supervised child task")
}

func (w *Workspace) navigationSnapshot(value any) any {
	if row, ok := value.(map[string]any); ok {
		row["tasks"] = w.taskList()
		row["navigation_root_id"] = w.state.ID
	}
	return value
}
