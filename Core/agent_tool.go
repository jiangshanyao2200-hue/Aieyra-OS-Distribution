// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: AgentToolDefinition; executeAgents
// Impact: python -B scripts/code-atlas.py show Core/agent_tool.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
)

// Agent scheduling uses the existing owner, receipts and conversations, independently of Toolbox.
func AgentToolDefinition() ToolDefinition {
	properties := map[string]any{
		"action": schemaEnum("overview", "programs", "program", "program_open", "program_send", "program_result", "program_cancel", "compact", "compact_status", "identity_enter", "identity_exit", "identity_status", "package", "models", "create", "list", "status", "snapshot", "settings", "configure", "result", "activity", "events", "wait", "send", "cancel", "review", "open_window", "hide_window", "contacts", "contact", "contact_create", "contact_update", "contact_delete", "session_create", "session_delete", "groups", "group", "group_create", "group_post", "group_update", "group_stop", "group_delete"),
		"kind":   schemaEnum("conversation"), "tools": schemaStrings(), "members": schemaStrings(),
		"command":  map[string]any{"type": "object", "description": "identity_enter also requires top-level contact_id, request_id, reason and task. Obtain the target contact_id from agents(action=contacts); command does not select a target by itself. Its fields are {trigger:user_request/task_complexity/delegation_failed,user_reference,failed_agent,failed_generation,success,exit,plan:[steps],unresolved:[facts]}. user_reference must be a verbatim contiguous substring of an actual user message, not a paraphrase or a joined quotation. Use the handoff rules in the manual. Otherwise Agent package action: sources, models, describe, list, status, create, configure, switch, restore_version, team, send or cancel. create needs package, request_id, model_id, workdir and team_role; it creates an idle supervised instance with only your granted tools. Changes need id, request_id, reason and expected_revision. The active primary Eyra may manage all local instances; child supervisors may change only directly supervised definitions. team may retain or detach your member. Only the user can re-enable disabled instances or fixed roles. send/cancel need the observed generation."},
		"contract": map[string]any{"type": "object"},
		"checks":   map[string]any{"type": "array", "items": map[string]any{"type": "object"}},
	}
	for _, key := range []string{"program", "id", "request_id", "model_id", "task", "prompt", "workdir", "title", "message", "verdict", "evidence", "presentation", "name", "description", "avatar", "prompt_text", "prompt_hash", "contact_id", "text", "member", "host_contact", "expected_host_contact", "reason", "expected_version"} {
		properties[key] = schemaString()
	}
	properties["contact_id"] = map[string]any{"type": "string", "description": "Required top-level target for identity_enter and session_create. Use the exact id returned by agents(action=contacts), rather than a role name or an instance id."}
	properties["brief"] = map[string]any{"type": "string", "description": "For program_send, a short human-facing summary of the assignment. Keep agent instructions in message."}
	properties["category"] = schemaEnum("all", "chat", "image", "video")
	for _, key := range []string{"revision", "timeout_seconds", "max_tokens", "cursor", "limit", "since", "before", "generation", "after"} {
		properties[key] = map[string]any{"type": "integer"}
	}
	properties["timeout_ms"] = map[string]any{"type": "integer", "description": "Optional wait interval up to 25000 ms. For program_result, use the program and generation from program_send. For wait, use an owned specialist task id."}
	return ToolDefinition{Type: "function", Name: "agents", Description: MatrixAgentManual(), Parameters: schemaObject(properties, "action")}
}

func executeAgents(ctx context.Context, call ToolCall) ToolboxResult {
	r := ToolboxResult{State: "failed", Description: "智能体"}
	fail := func(message string) ToolboxResult {
		r.Error = &ShellError{Code: "agents_error", Message: message}
		return r
	}
	if err := permittedCall(ctx, call); err != nil {
		return fail(err.Error())
	}
	var args map[string]json.RawMessage
	if json.Unmarshal([]byte(call.Function.Arguments), &args) != nil || args == nil {
		return fail("arguments must be an object")
	}
	manager, ok := ctx.Value(agentManagerKey{}).(agentManagerContext)
	if !ok || manager.manager == nil {
		return fail("Agent 调度器未初始化")
	}
	var data any
	var err error
	if call.Function.Name == "core_link" {
		var action string
		_ = json.Unmarshal(args["action"], &action)
		if programDelegationAction("core_link", action) {
			if manager.manager.workspace == nil {
				return fail("程序调度需要正在运行的 Eyra 母体")
			}
			data, err = manager.manager.workspace.motherConversationCall(ctx, manager.owner, rawJSON(args))
		} else {
			data, err = manager.manager.coreLinkCall(ctx, manager.owner, json.RawMessage(call.Function.Arguments))
		}
	} else {
		// The old UI query keeps its chat-list shape. Model-facing agents owns
		// the complete public model pool, including image and video readiness.
		if string(args["action"]) == `"models"` && len(args["category"]) == 0 {
			args["category"] = json.RawMessage(`"all"`)
		}
		data, err = manager.manager.Call(ctx, manager.owner, rawJSON(args))
	}
	if err != nil {
		return fail(err.Error())
	}
	r.Data, err = json.Marshal(data)
	if err != nil {
		return fail(err.Error())
	}
	r.OK, r.State = true, "completed"
	return r
}
