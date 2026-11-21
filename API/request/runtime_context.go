// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/request/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: labelRuntimeObservations
// Impact: python -B scripts/code-atlas.py show API/request/runtime_context.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package request

// Names are internal metadata and most providers do not transmit them. Carry
// the section key in observation text so an appended removal unambiguously
// supersedes that section, including observations represented as user turns.
// Only the transport copy changes; saved history and user text stay intact.
func labelRuntimeObservations(messages []Message) []Message {
	var out []Message
	for i, m := range messages {
		if !m.ContextObservation || m.Name == "" {
			continue
		}
		if out == nil {
			out = append([]Message(nil), messages...)
		}
		out[i].Content = "[Aieyra runtime context]\nsection: " + m.Name + "\n" + m.Content
	}
	if out == nil {
		return messages
	}
	return out
}
