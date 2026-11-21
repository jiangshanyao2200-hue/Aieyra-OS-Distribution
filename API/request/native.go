// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/request/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: BuildNative
// Impact: python -B scripts/code-atlas.py show API/request/native.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package request

import (
	"encoding/json"
	"github.com/aieyra/aieyra-os/api/codec"
	"strings"
)

// 原生协议复用同一工具事务：流式只更新显示，完整结束后才发布可执行消息。
func BuildNative(s Profile, messages []Message, stream bool, tools []ToolDefinition) map[string]any {
	messages = labelRuntimeObservations(messages)
	google := s.Protocol == ProtocolGoogle
	var system []string
	turns := []any{}
	for _, m := range messages {
		if m.Role == RoleSystem {
			if len(turns) == 0 {
				system = append(system, m.Content)
				continue
			}
			m.Role = RoleUser
			if !m.ContextObservation || m.Name == "" {
				m.Content = "[Aieyra runtime context]\n" + m.Content
			}
		}
		role := m.Role
		var parts []any
		if m.Role == RoleAssistant && m.Provider == s.Provider && len(m.NativeContent) > 0 {
			_ = json.Unmarshal(m.NativeContent, &parts)
			if !google && len(m.ToolCalls) > 0 {
				callIdx := 0
				for _, part := range parts {
					if p, ok := part.(map[string]any); ok && p["type"] == "tool_use" && callIdx < len(m.ToolCalls) {
						if codec.StringValue(p["id"]) == "" && m.ToolCalls[callIdx].ID != "" {
							p["id"] = m.ToolCalls[callIdx].ID
						}
						callIdx++
					}
				}
			}
		}
		if google && len(parts) > 0 {
			replay := make([]any, 0, len(parts))
			for _, part := range parts {
				if p, ok := part.(map[string]any); ok && codec.EmptyGoogleTextPart(p) {
					continue
				}
				replay = append(replay, part)
			}
			parts = replay
		}
		if len(parts) == 0 {
			if m.Role == RoleTool {
				role = RoleUser
				if google {
					name := m.Name
					if name == "" {
						for _, old := range messages {
							for _, call := range old.ToolCalls {
								if call.ID == m.ToolCallID {
									name = call.Function.Name
								}
							}
						}
					}
					response := map[string]any{"name": name, "response": map[string]any{"output": m.Content}}
					if !strings.HasPrefix(m.ToolCallID, "google_") {
						response["id"] = m.ToolCallID
					}
					parts = append(parts, map[string]any{"functionResponse": response})
				} else {
					parts = append(parts, map[string]any{"type": "tool_result", "tool_use_id": m.ToolCallID, "content": m.Content})
				}
			} else {
				if m.Content != "" {
					if google {
						parts = append(parts, map[string]any{"text": m.Content})
					} else {
						parts = append(parts, map[string]any{"type": "text", "text": m.Content})
					}
				}
				for _, call := range m.ToolCalls {
					var args any
					_ = json.Unmarshal([]byte(call.Function.Arguments), &args)
					if google {
						fn := map[string]any{"name": call.Function.Name, "args": args}
						if !strings.HasPrefix(call.ID, "google_") {
							fn["id"] = call.ID
						}
						parts = append(parts, map[string]any{"functionCall": fn})
					} else {
						parts = append(parts, map[string]any{"type": "tool_use", "id": call.ID, "name": call.Function.Name, "input": args})
					}
				}
			}
		}
		if len(m.Images) > 0 {
			if google {
				parts = append(parts, map[string]any{"text": "Stored images omitted on this text-only channel."})
			} else {
				parts = append(parts, map[string]any{"type": "text", "text": "Stored images omitted on this text-only channel."})
			}
		}
		if len(parts) == 0 {
			continue
		}
		key := "content"
		if google {
			key = "parts"
			if role == RoleAssistant {
				role = "model"
			}
		}
		// Anthropic 不接受相邻多条 user；多工具结果必须在一个用户回合内。
		if len(turns) > 0 {
			last := turns[len(turns)-1].(map[string]any)
			if last["role"] == role {
				last[key] = append(last[key].([]any), parts...)
				continue
			}
		}
		turns = append(turns, map[string]any{"role": role, key: parts})
	}
	if google {
		body := map[string]any{"contents": turns}
		if len(system) > 0 {
			body["systemInstruction"] = map[string]any{"parts": []any{map[string]any{"text": strings.Join(system, "\n\n")}}}
		}
		if s.MaxTokens > 0 {
			body["generationConfig"] = map[string]any{"maxOutputTokens": s.MaxTokens}
		}
		if len(tools) > 0 {
			defs := []any{}
			for _, t := range tools {
				defs = append(defs, map[string]any{"name": t.Name, "description": t.Description, "parametersJsonSchema": t.Parameters})
			}
			body["tools"] = []any{map[string]any{"functionDeclarations": defs}}
		}
		MergeParameterMaps(body, cloneOptions(s.Extra))
		return body
	}
	body := map[string]any{"model": s.Model, "messages": turns, "max_tokens": s.OutputLimit, "stream": stream}
	if len(system) > 0 {
		body["system"] = strings.Join(system, "\n\n")
	}
	if len(tools) > 0 {
		defs := []any{}
		for _, t := range tools {
			defs = append(defs, map[string]any{"name": t.Name, "description": t.Description, "input_schema": t.Parameters})
		}
		body["tools"] = defs
	}
	MergeParameterMaps(body, cloneOptions(s.Extra))
	return body
}
