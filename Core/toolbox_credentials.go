// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: archiveToolCall; archiveToolMessage
// Impact: python -B scripts/code-atlas.py show Core/toolbox_credentials.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
)

// 已识别的凭据参数只在当前执行调用中保留。摘要标记同时保留幂等身份，恢复绝不重跑。
func archiveToolCall(call ToolCall) ToolCall {
	if call.Function.Name != "toolbox" {
		return call
	}
	var args map[string]any
	if json.Unmarshal([]byte(call.Function.Arguments), &args) != nil || (args["name"] != "settings" && args["name"] != "software_api" && args["name"] != "system") {
		return call
	}
	inner, ok := args["arguments"].(map[string]any)
	if !ok {
		return call
	}
	changed := false
	var redact func(any)
	redact = func(raw any) {
		if items, ok := raw.([]any); ok {
			for _, item := range items {
				redact(item)
			}
			return
		}
		value, ok := raw.(map[string]any)
		if !ok {
			return
		}
		for name, child := range value {
			if name == "api_key" || name == "api_key_history" {
				if items, ok := child.([]any); ok {
					for i, item := range items {
						slot := map[string]any{"api_key": item}
						redact(slot)
						items[i] = slot["api_key"]
					}
					continue
				}
				key, ok := child.(string)
				if ok && key != "" && !(strings.HasPrefix(key, "[credential-sha256:") && len(key) == 84 && strings.HasSuffix(key, "]")) {
					sum := sha256.Sum256([]byte(key))
					value[name] = "[credential-sha256:" + hex.EncodeToString(sum[:]) + "]"
					changed = true
				}
			} else {
				redact(child)
			}
		}
	}
	redact(inner)
	if !changed {
		return call
	}
	raw, _ := json.Marshal(args)
	call.Function.Arguments = string(raw)
	return call
}
func archiveToolMessage(m Message) Message {
	m.ToolCalls = append([]ToolCall(nil), m.ToolCalls...)
	changed := false
	for i, call := range m.ToolCalls {
		m.ToolCalls[i] = archiveToolCall(call)
		changed = changed || m.ToolCalls[i].Function.Arguments != call.Function.Arguments
	}
	if !changed {
		return m
	}
	// 不保留含相同敏感参数的原始协议 item；请求构造按 ToolCalls 重建完整配对。
	m.ResponseItems = nil
	m.NativeContent = nil
	m.ReasoningDetails = nil
	return m
}
