// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workspaceCollaboration; collaborationModeLocked; collaborationRoleLocked; collaborationContract; collaborationToolDefinition; collaborationCall; collaborationSnapshot
// Impact: python -B scripts/code-atlas.py show Core/workspace_collaboration.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
)

// Collaboration is a projection of the existing task runtimes. Configuration
// alone neither launches a role nor creates a Control identity.
type workspaceCollaboration struct {
	Mode  string   `json:"mode"`
	Roles []string `json:"roles,omitempty"`
}

func (w *Workspace) collaborationModeLocked() string {
	if w.collaboration.Mode == "" {
		return "natural"
	}
	return w.collaboration.Mode
}

func (w *Workspace) collaborationRoleLocked(role string) bool {
	if !CurrentReleaseStage().TeamCollaboration {
		return false
	}
	if w.Mode() != HostOS || role != WorkspaceProject && role != WorkspaceExecution {
		return false
	}
	// 协同关闭时不派发；Matrix 保持直接执行。
	if w.teamHost() {
		if ready, _ := w.collaborationReady(); !ready {
			return false
		}
	}
	if w.teamHost() && !w.teamRoleOn(role) {
		return false
	}
	switch w.collaborationModeLocked() {
	case "natural":
		return true
	case "custom":
		return slices.Contains(w.collaboration.Roles, role)
	}
	return false
}

func (w *Workspace) collaborationContract(role string) string {
	if role != WorkspaceMatrix {
		return workspaceRoleContract(role)
	}
	w.mu.Lock()
	mode := w.collaborationModeLocked()
	w.mu.Unlock()
	base := strings.Replace(workspaceRoleContract(role), "team/child agents are disabled.", "OS collaboration is available when useful for the authorized task.", 1)
	return base + " Current collaboration mode: " + mode + runtimePrompt("Matrix/辅助指令/协同模板.txt")
}

func collaborationToolDefinition(d ToolDefinition) ToolDefinition {
	// Definitions are freshly built per request. Keep the non-OS schema intact.
	params := d.Parameters.(map[string]any)
	properties := params["properties"].(map[string]any)
	actions := properties["action"].(map[string]any)
	actions["enum"] = append(actions["enum"].([]string), "collaboration_status", "collaboration_configure", "collaboration_split", "collaboration_retry")
	properties["mode"] = schemaEnum("natural", "split", "custom")
	properties["roles"] = schemaStrings()
	properties["request_id"] = schemaString()
	properties["task_id"] = schemaString()
	properties["message"] = schemaString()
	d.Description += runtimePrompt("Matrix/工具说明/协作操作补充.txt")
	return d
}

func (w *Workspace) collaborationCall(ctx context.Context, caller string, raw json.RawMessage) (any, error) {
	if w.Mode() != HostOS || caller != WorkspaceMatrix {
		return nil, fmt.Errorf("OS Matrix collaboration capability required")
	}
	var p struct {
		Action string   `json:"action"`
		Mode   string   `json:"mode"`
		Roles  []string `json:"roles"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if strings.TrimPrefix(p.Action, "collaboration_") != "status" && homeTeamRetired {
		return nil, fmt.Errorf("首页 Eyra 不再组建团队；编程任务请用 agents(action=\"program_send\", program=\"coding\") 委派给 Coding")
	}
	if strings.TrimPrefix(p.Action, "collaboration_") != "status" && !CurrentReleaseStage().TeamCollaboration {
		return nil, fmt.Errorf("团队协同在基础能力阶段暂未开放")
	}
	switch strings.TrimPrefix(p.Action, "collaboration_") {
	case "status":
		return w.collaborationSnapshot(), nil
	case "configure":
		if p.Mode != "natural" && p.Mode != "split" && p.Mode != "custom" {
			return nil, fmt.Errorf("unknown collaboration mode")
		}
		seen := map[string]bool{}
		for _, role := range p.Roles {
			if p.Mode != "custom" || role != WorkspaceProject && role != WorkspaceExecution || seen[role] {
				return nil, fmt.Errorf("custom roles may contain project and execution once each")
			}
			seen[role] = true
		}
		w.mu.Lock()
		if w.closed || w.updateFrozen {
			w.mu.Unlock()
			return nil, fmt.Errorf("task is closed or frozen")
		}
		// A template switch must not silently revoke running roles or their queues.
		for _, record := range w.manager.List(w.state.ID) {
			if record.Spec.WorkspaceRole != WorkspaceMatrix && activeAgent(record.State) {
				w.mu.Unlock()
				return nil, fmt.Errorf("finish or explicitly cancel active collaborators before changing mode")
			}
		}
		for _, message := range w.state.Messages {
			// 变更收据留待下一次定向读取，不代表尚未完成的角色委派。
			if message.To != WorkspaceMatrix && !message.Reference && (message.State == "queued" || message.State == "context") {
				w.mu.Unlock()
				return nil, fmt.Errorf("pending role messages must be resolved before changing mode")
			}
		}
		w.collaboration = workspaceCollaboration{Mode: p.Mode, Roles: append([]string(nil), p.Roles...)}
		w.state.Revision++
		w.mu.Unlock()
		return w.collaborationSnapshot(), nil
	case "split", "retry":
		return w.splitCall(ctx, raw)
	}
	return nil, fmt.Errorf("unknown collaboration action")
}

func (w *Workspace) collaborationSnapshot() map[string]any {
	w.mu.Lock()
	mode, taskID := w.collaborationModeLocked(), w.state.ID
	roles := make(map[string]string, len(w.state.Roles))
	for role, id := range w.state.Roles {
		roles[role] = id
	}
	live := make(map[string]WorkspaceLive, len(w.live))
	for role, value := range w.live {
		live[role] = value
	}
	configured := []string{}
	for _, role := range w.collaboration.Roles {
		if role == WorkspaceProject || role == WorkspaceExecution {
			configured = append(configured, role)
		}
	}
	w.mu.Unlock()
	active, dispatched := false, false
	rows := []map[string]any{}
	for _, role := range []string{WorkspaceMatrix, WorkspaceProject, WorkspaceExecution} {
		row := map[string]any{"role": role, "task_id": taskID, "state": "idle", "execution_state": "idle", "execution_started": false, "activity": "尚未派发"}
		if id := roles[role]; id != "" {
			if state, err := w.manager.workspaceRoleStatus(taskID, id); err == nil {
				for k, v := range state {
					row[k] = v
				}
				row["execution_state"] = state["state"]
				row["activity"] = state["state"]
				if text := strings.TrimSpace(live[role].Text); text != "" && activeAgent(state["state"].(string)) {
					row["activity"] = shortSpeech(w.manager.redact(text), 100)
				}
				if role != WorkspaceMatrix {
					dispatched = true
					active = active || activeAgent(state["state"].(string))
				}
			}
		}
		rows = append(rows, row)
	}
	helpers := []map[string]any{}
	if mode == "custom" {
		for _, record := range w.manager.List(taskID) {
			if record.Spec.WorkspaceRole == "" {
				dispatched = true
				active = active || activeAgent(record.State)
				helpers = append(helpers, map[string]any{"task_id": record.ID, "parent_task_id": record.Parent, "title": w.manager.redact(record.Spec.Title), "state": record.State, "generation": record.Generation})
			}
		}
	}
	parent := ""
	membership := workspaceMembership{State: "not_required", Project: "os", NativeID: taskID}
	splits := []map[string]any{}
	if w.split != nil {
		own := w.splitRow()
		parent, membership = w.split.Parent, own["membership"].(workspaceMembership)
		splits = append(splits, own)
	}
	for _, next := range w.splitWorkspaces() {
		splits = append(splits, next.splitRow())
	}
	for _, split := range splits {
		active = active || activeAgent(split["execution_state"].(string))
	}
	for _, row := range rows {
		row["parent_task_id"], row["membership"], row["mode"] = parent, membership, mode
	}
	ready, missing := w.collaborationReady()
	return map[string]any{"enabled": CurrentReleaseStage().TeamCollaboration, "team": map[string]any{"ready": ready, "missing": missing, "names": teamRoleNames(), "enabled": map[string]bool{WorkspaceProject: w.teamRoleOn(WorkspaceProject), WorkspaceExecution: w.teamRoleOn(WorkspaceExecution)}}, "mode": mode, "template": map[string]string{"natural": "标准协同", "split": "分裂协同", "custom": "自定义协同"}[mode], "active": active, "dispatched": dispatched || len(splits) > 0, "task_id": taskID, "parent_task_id": parent, "membership": membership, "station_required": len(splits) > 0, "splits": splits, "roles": rows, "helpers": helpers, "configured_roles": configured}
}
