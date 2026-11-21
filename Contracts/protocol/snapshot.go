// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/protocol/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: CloneMessages; cloneCalls
// Impact: python -B scripts/code-atlas.py show Contracts/protocol/snapshot.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package protocol

import "slices"

// CloneMessages owns every mutable field, including opaque continuation data.
// A value/JSON round trip would lose non-wire metadata such as FinishReason.
func CloneMessages(messages []Message) []Message {
	out := slices.Clone(messages)
	for i := range out {
		m := &out[i]
		m.Images = slices.Clone(m.Images)
		m.ReasoningDetails = slices.Clone(m.ReasoningDetails)
		m.NativeContent = slices.Clone(m.NativeContent)
		m.ToolCalls = cloneCalls(m.ToolCalls)
		m.IncompleteTools = cloneCalls(m.IncompleteTools)
		m.ResponseItems = slices.Clone(m.ResponseItems)
		for j := range m.ResponseItems {
			m.ResponseItems[j] = slices.Clone(m.ResponseItems[j])
		}
	}
	return out
}

func cloneCalls(calls []ToolCall) []ToolCall {
	out := slices.Clone(calls)
	for i := range out {
		out[i].ExtraContent = slices.Clone(out[i].ExtraContent)
		if out[i].Index != nil {
			index := *out[i].Index
			out[i].Index = &index
		}
	}
	return out
}
