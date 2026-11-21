// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: taskManager; scopedHuman
// Impact: python -B scripts/code-atlas.py show Core/matrix_control_scope.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
)

func (c *MatrixControl) taskManager(task string) (*AgentManager, error) {
	if task == "" || task == c.manager.owner {
		return c.manager, nil
	}
	if w := c.manager.workspace; w != nil {
		owner, err := w.taskOwner(task)
		if err != nil {
			return nil, err
		}
		return owner.manager, nil
	}
	if _, err := c.manager.Status(c.manager.owner, task); err != nil {
		return nil, err
	}
	return c.manager, nil
}

func (c *MatrixControl) scopedHuman(action string, raw json.RawMessage) (any, error) {
	// 路由字段仅决定所属 manager；原始人工请求的严格绑定检查继续执行。
	var envelope map[string]json.RawMessage
	if err := decodeHuman(raw, &envelope); err != nil || envelope == nil {
		return nil, fmt.Errorf("invalid human arguments")
	}
	var task string
	if value, ok := envelope["task_id"]; ok {
		if err := json.Unmarshal(value, &task); err != nil {
			return nil, err
		}
		delete(envelope, "task_id")
	}
	if action == "humans.reply" && task == "" {
		if err := json.Unmarshal(envelope["session_id"], &task); err != nil {
			return nil, err
		}
	}
	m, err := c.taskManager(task)
	if err != nil {
		return nil, err
	}
	data := rawJSON(envelope)
	switch action {
	case "humans.list", "humans.status":
		value, err := m.callHuman(action, data)
		if err != nil || task == "" || task == m.owner {
			return value, err
		}
		if action == "humans.status" {
			if value.(HumanRequest).AgentID != task {
				return nil, fmt.Errorf("human_origin_mismatch")
			}
			return value, nil
		}
		rows := []HumanRequest{}
		for _, row := range value.([]HumanRequest) {
			if row.AgentID == task {
				rows = append(rows, row)
			}
		}
		return rows, nil
	case "humans.reply":
		var p HumanReply
		if err := decodeHuman(data, &p); err != nil {
			return nil, err
		}
		if p.SessionID != m.owner || task != "" && task != m.owner && p.AgentID != task {
			return nil, fmt.Errorf("human_origin_mismatch")
		}
		return m.ReplyHuman(m.owner, p)
	}
	return nil, fmt.Errorf("unknown_human_action")
}
