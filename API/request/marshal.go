// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/request/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: cloneOptions; cloneValue; mergeRequestOptions; MarshalJSON; MarshalJSON; MergeParameterMaps
// Impact: python -B scripts/code-atlas.py show API/request/marshal.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package request

import "encoding/json"

// Detach JSON-shaped options from the host snapshot. In particular, assigning
// a session cache key to one request must not change a reusable profile.
func cloneOptions(options map[string]any) map[string]any {
	if options == nil {
		return nil
	}
	copy := make(map[string]any, len(options))
	for key, value := range options {
		copy[key] = cloneValue(value)
	}
	return copy
}

func cloneValue(value any) any {
	switch value := value.(type) {
	case map[string]any:
		return cloneOptions(value)
	case []any:
		copy := make([]any, len(value))
		for i, item := range value {
			copy[i] = cloneValue(item)
		}
		return copy
	case []string:
		return append([]string(nil), value...)
	case json.RawMessage:
		return append(json.RawMessage(nil), value...)
	default:
		return value
	}
}

func mergeRequestOptions(base any, extra map[string]any) ([]byte, error) {
	raw, err := json.Marshal(base)
	if err != nil || len(extra) == 0 {
		return raw, err
	}
	var body map[string]json.RawMessage
	if err = json.Unmarshal(raw, &body); err != nil {
		return nil, err
	}
	for k, v := range extra {
		if nested, ok := v.(map[string]any); ok && body[k] != nil {
			var existing map[string]any
			if json.Unmarshal(body[k], &existing) == nil && existing != nil {
				MergeParameterMaps(existing, nested)
				body[k] = rawJSON(existing)
				continue
			}
		}
		body[k] = rawJSON(v)
	}
	return json.Marshal(body)
}
func (r ChatRequest) MarshalJSON() ([]byte, error) {
	if r.textOnly {
		// Emit only verified fields. Historical tool facts remain readable as
		// text; no native tool call, image, reasoning or cache key is invented.
		messages := make([]map[string]string, 0, len(r.Messages))
		for _, m := range r.Messages {
			role, content := m.Role, m.Content
			if role == RoleTool {
				role, content = RoleUser, "[Historical tool result "+m.ToolCallID+"]\n"+content
			}
			if len(m.ToolCalls) > 0 {
				calls, _ := json.Marshal(m.ToolCalls)
				content += "\n[Historical tool calls]\n" + string(calls)
			}
			messages = append(messages, map[string]string{"role": role, "content": content})
		}
		body := map[string]any{"model": r.Model, "messages": messages, "stream": r.Stream}
		if r.Stream {
			body["stream_options"] = StreamOptions{IncludeUsage: true}
		}
		return json.Marshal(body)
	}
	type request ChatRequest
	extra := r.extra
	if (r.requireReasoningContent || r.imageMessages != nil) && r.Messages != nil {
		// BuildRequest has already removed reasoning from other providers.
		// Empty means no reasoning was supplied; never invent replacement text.
		extra = make(map[string]any, len(r.extra)+1)
		for key, value := range r.extra {
			extra[key] = value
		}
		messages := make([]any, 0, len(r.Messages))
		for i, message := range r.Messages {
			var wire any = message
			if r.requireReasoningContent && message.Role == RoleAssistant {
				wire = struct {
					Message
					ReasoningContent string `json:"reasoning_content"`
				}{message, message.ReasoningContent}
			}
			// A user's image parts replace that user's wire content; tool image
			// observations remain after the complete tool-result sequence.
			if !(message.Role == RoleUser && i < len(r.imageMessages) && r.imageMessages[i] != nil) {
				messages = append(messages, wire)
			}
			if i < len(r.imageMessages) && r.imageMessages[i] != nil {
				messages = append(messages, r.imageMessages[i])
			}
		}
		extra["messages"] = messages
	}
	return mergeRequestOptions(request(r), extra)
}
func (r ResponsesRequest) MarshalJSON() ([]byte, error) {
	type request ResponsesRequest
	return mergeRequestOptions(request(r), r.extra)
}

// 只合并对象中的新字段，已有标准字段继续使用已构造的值。
func MergeParameterMaps(body, extra map[string]any) {
	for k, v := range extra {
		nested, ok := v.(map[string]any)
		existing, has := body[k].(map[string]any)
		if ok && has {
			MergeParameterMaps(existing, nested)
		} else if _, present := body[k]; !present {
			body[k] = v
		}
	}
}
