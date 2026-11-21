// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/request/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Image; ResolveImages; chatImages; responseImageContent
// Impact: python -B scripts/code-atlas.py show API/request/images.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package request

import "fmt"

// Image is a verified attachment snapshot supplied by the host. API never
// opens archive paths. Text explains an unavailable attachment instead of
// silently dropping it. Detail is used only by protocols that support it.
type Image struct {
	DataURL, Detail, Label, Text string
}

// ResolveImages is called during construction only, never on marshal or retry.
type ResolveImages func(Message) []Image

// Keep tool results contiguous: image observations follow the complete batch.
// Positions refer to the normalized history, after leading systems are merged.
func chatImages(messages []Message, resolve ResolveImages) []any {
	if resolve == nil {
		return nil
	}
	var inserts []any
	var parts []any
	for i, m := range messages {
		if len(m.Images) > 0 {
			text := m.Content
			if m.Role != RoleUser {
				text = fmt.Sprintf("Image observations from %s (tool_call_id=%s):", m.Name, m.ToolCallID)
			}
			parts = append(parts, map[string]any{"type": "text", "text": text})
			for _, image := range resolve(m) {
				if image.Label != "" && m.Role == RoleUser {
					parts = append(parts, map[string]any{"type": "text", "text": image.Label})
				}
				if image.DataURL != "" {
					parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]any{"url": image.DataURL}})
				} else {
					parts = append(parts, map[string]any{"type": "text", "text": image.Text})
				}
			}
		}
		if len(parts) > 0 && (m.Role != RoleTool || i+1 == len(messages) || messages[i+1].Role != RoleTool) {
			if inserts == nil {
				inserts = make([]any, len(messages))
			}
			inserts[i] = map[string]any{"role": RoleUser, "content": parts}
			parts = nil
		}
	}
	return inserts
}

func responseImageContent(m Message, resolve ResolveImages) []any {
	parts := []any{map[string]any{"type": "input_text", "text": m.Content}}
	for _, image := range resolve(m) {
		if image.Label != "" && m.Role == RoleUser {
			parts = append(parts, map[string]any{"type": "input_text", "text": image.Label})
		}
		if image.DataURL != "" {
			parts = append(parts, map[string]any{"type": "input_image", "image_url": image.DataURL, "detail": image.Detail})
		} else {
			parts = append(parts, map[string]any{"type": "input_text", "text": image.Text})
		}
	}
	return parts
}
