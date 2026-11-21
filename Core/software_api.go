// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: softwareAPICall
// Impact: python -B scripts/code-atlas.py show Core/software_api.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

// Only this facade selects a desktop operation versus the shared settings
// dispatcher. Existing settings aliases retain exactly the same implementation.
func softwareAPICall(ctx context.Context, raw json.RawMessage, callID string) (json.RawMessage, bool, json.RawMessage, error) {
	var p map[string]json.RawMessage
	if json.Unmarshal(raw, &p) != nil || p == nil {
		return nil, true, nil, fmt.Errorf("software_api arguments 必须为对象")
	}
	var action string
	if json.Unmarshal(p["action"], &action) != nil || action == "" {
		return nil, true, nil, fmt.Errorf("software_api action 必须为非空字符串")
	}
	if runtime, ok := ctx.Value(packageRuntimeKey{}).(packageRuntimeContext); ok {
		data, err := runtime.program(ctx, raw)
		return data, true, nil, err
	}
	if action == "settings" {
		if len(p) != 2 {
			return nil, true, nil, fmt.Errorf("settings 委托只接受 action 和 arguments")
		}
		var nested map[string]json.RawMessage
		if json.Unmarshal(p["arguments"], &nested) != nil || nested == nil {
			return nil, true, nil, fmt.Errorf("settings arguments 必须为对象")
		}
		return nil, false, p["arguments"], nil
	}
	desktop := false
	switch action {
	case "package", "program", "describe", "modules", "module", "order", "receipt", "link_status", "link_open", "eyra_open", "eyra_close", "control":
		desktop = true
	}
	if !desktop {
		data, err := toolboxRouted(ctx, "software_api", raw)
		return data, data != nil || err != nil, raw, err
	}
	if bound, ok := ctx.Value(programAgentContextKey{}).(programAgentContext); ok {
		if action == "control" {
			p["action"] = rawJSON("link_open")
		}
		data, err := bound.serviceCall(ctx, "desktop", rawJSON(p))
		return data, true, nil, err
	}
	c, ok := ctx.Value(workspaceContextKey{}).(workspaceContext)
	if !ok || c.workspace == nil || c.role != WorkspaceMatrix || c.workspace.Mode() != HostOS || c.workspace.isTerminal() {
		return nil, true, nil, fmt.Errorf("software_api 模块操作仅属于 OS 主会话，专项 Agent 请交回 Eyra")
	}
	if err := ctx.Err(); err != nil {
		return nil, true, nil, err
	}
	if action == "control" {
		action = "link_open"
		p["action"] = rawJSON(action)
	}
	if action == "module" || action == "order" || action == "link_open" {
		if _, exists := p["request_id"]; !exists {
			identity, _ := ctx.Value(toolInvocationKey{}).(string)
			if identity == "" {
				identity = callID
			}
			if identity == "" {
				return nil, true, nil, fmt.Errorf("窗口变更需要 request_id 或持久工具调用编号")
			}
			hash := sha256.Sum256([]byte(identity))
			p["request_id"] = rawJSON("tool-" + hex.EncodeToString(hash[:16]))
		}
	}
	request := rawJSON(p)
	if c.workspace.service == nil {
		return nil, true, nil, fmt.Errorf("OS 桌面服务尚未就绪")
	}
	data, err := c.workspace.service.CallTool(ctx, "desktop", c.workspace.state.ID, request)
	if err != nil {
		result := map[string]any{"ok": false, "state": "unknown", "operation_session": c.workspace.state.ID, "code": "DESKTOP_TRANSPORT_UNCONFIRMED", "error": "桌面操作结果未确认；先查询原 request_id 与 operation_session 回执和 modules 状态，勿盲目重复窗口变更。"}
		if scope, exists := p["operation_session"]; exists {
			result["operation_session"] = scope
		}
		if id, exists := p["request_id"]; exists {
			result["request_id"] = id
		}
		return rawJSON(result), true, nil, err
	}
	return data, true, nil, nil
}
