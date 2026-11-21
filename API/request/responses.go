// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/request/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ResponseReasoning; ResponsesRequest; rawJSON; BuildResponses; SetPromptCacheKey
// Impact: python -B scripts/code-atlas.py show API/request/responses.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package request

import (
	"encoding/json"
	"strings"
)

type ResponseReasoning struct {
	Effort  string `json:"effort,omitempty"`
	Summary string `json:"summary,omitempty"`
}

type ResponsesRequest struct {
	extra           map[string]any
	Include         []string           `json:"include,omitempty"`
	Model           string             `json:"model"`
	Input           []json.RawMessage  `json:"input"`
	Stream          bool               `json:"stream"`
	Reasoning       *ResponseReasoning `json:"reasoning,omitempty"`
	Store           bool               `json:"store"`
	MaxOutputTokens int                `json:"max_output_tokens,omitempty"`
	Temperature     *float64           `json:"temperature,omitempty"`
	TopP            *float64           `json:"top_p,omitempty"`
	User            string             `json:"user,omitempty"`
	Text            *struct {
		Format ResponseFormat `json:"format"`
	} `json:"text,omitempty"`
	Tools      []ToolDefinition `json:"tools,omitempty"`
	ToolChoice string           `json:"tool_choice,omitempty"`
}

func rawJSON(v any) json.RawMessage { b, _ := json.Marshal(v); return b }
func BuildResponses(s Profile, messages []Message, stream bool, tools []ToolDefinition, resolveImages ResolveImages) *ResponsesRequest {
	messages = labelRuntimeObservations(messages)
	legacy := BuildChat(s, nil, stream, nil)
	r := &ResponsesRequest{Model: s.Model, Stream: stream, MaxOutputTokens: s.MaxTokens, Temperature: legacy.Temperature, TopP: legacy.TopP, User: legacy.UserID, Tools: tools, Input: []json.RawMessage{}}
	r.extra = cloneOptions(s.Extra)
	if s.Generic && (s.OpenCode || strings.HasPrefix(strings.TrimPrefix(s.Model, "openai/"), "gpt-")) {
		r.Include = []string{"reasoning.encrypted_content"}
	}
	if !s.Generic {
		r.Reasoning = &ResponseReasoning{Effort: "none"}
		if s.ThinkingEnabled {
			r.Reasoning.Effort = s.ReasoningEffort
		}
	}
	if s.ResponseFormat == "json_object" {
		r.Text = &struct {
			Format ResponseFormat `json:"format"`
		}{ResponseFormat{Type: "json_object"}}
	}
	if len(tools) > 0 {
		r.ToolChoice = "auto"
	}
	// Relays may collect every system item into instructions, including GPT
	// Responses. Keep transient runtime context after history so a clock or
	// tool notice cannot rewrite the otherwise reusable instruction prefix.
	if s.Generic {
		messages = runtimeSystemAsUser(messages)
	}
	for _, m := range messages {
		if len(m.ResponseItems) > 0 && (m.Provider == s.Provider || m.Provider == "" && !s.Generic) {
			for _, item := range m.ResponseItems {
				r.Input = append(r.Input, append(json.RawMessage(nil), item...))
			}
			continue
		}
		if m.Role == RoleTool {
			var output any = m.Content
			if len(m.Images) > 0 && resolveImages != nil {
				output = responseImageContent(m, resolveImages)
			}
			r.Input = append(r.Input, rawJSON(map[string]any{"type": "function_call_output", "call_id": m.ToolCallID, "output": output}))
			continue
		}
		if m.Role == RoleAssistant && m.ReasoningContent != "" && !s.Generic && (m.Provider == "" || m.Provider == s.Provider) {
			r.Input = append(r.Input, rawJSON(map[string]any{"type": "reasoning", "content": []any{map[string]any{"type": "reasoning_text", "text": m.ReasoningContent}}}))
		}
		if m.Content != "" || m.Role != RoleAssistant {
			var content any = m.Content
			if m.Role == RoleUser && len(m.Images) > 0 && resolveImages != nil {
				content = responseImageContent(m, resolveImages)
			}
			r.Input = append(r.Input, rawJSON(map[string]any{"type": "message", "role": m.Role, "content": content}))
		}
		for _, call := range m.ToolCalls {
			r.Input = append(r.Input, rawJSON(map[string]any{"type": "function_call", "call_id": call.ID, "name": call.Function.Name, "arguments": call.Function.Arguments}))
		}
	}
	return r
}

// SetPromptCacheKey only fills a missing key and never overwrites an explicit option.
func (r *ResponsesRequest) SetPromptCacheKey(key string) {
	if key == "" {
		return
	}
	if r.extra == nil {
		r.extra = map[string]any{}
	}
	if _, ok := r.extra["prompt_cache_key"]; !ok {
		r.extra["prompt_cache_key"] = key
	}
}
