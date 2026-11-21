// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/parameters/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Learned
// Impact: python -B scripts/code-atlas.py show API/parameters/learned.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package parameters

import "strings"

func Learned(s Profile) map[string]any {
	out := map[string]any{}
	defer stripSamplingOptions(out)
	options := cloneOptions(s.Options)
	for _, f := range s.Specs {
		if s.Rule != nil && (strings.HasPrefix(f.Key, "reasoning_") || f.Key == "thinking_mode" || f.Key == "tool_stream") {
			continue
		}
		value, ok := options[f.Key]
		if !ok || len(f.WirePath) == 0 || !ValidValue(f, value) {
			continue
		}
		target := out
		for _, part := range f.WirePath[:len(f.WirePath)-1] {
			if target[part] == nil {
				target[part] = map[string]any{}
			}
			next, ok := target[part].(map[string]any)
			if !ok {
				target = nil
				break
			}
			target = next
		}
		if target != nil {
			target[f.WirePath[len(f.WirePath)-1]] = value
		}
	}
	return out
}
