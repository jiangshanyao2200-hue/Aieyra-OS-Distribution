// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/parameters/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: setCatalogPath; ApplyCatalog; slicesHas
// Impact: python -B scripts/code-atlas.py show API/parameters/catalog.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package parameters

func setCatalogPath(body map[string]any, path []string, value any) {
	for _, part := range path[:len(path)-1] {
		next, ok := body[part].(map[string]any)
		if !ok {
			next = map[string]any{}
			body[part] = next
		}
		body = next
	}
	body[path[len(path)-1]] = value
}

// A reviewed provider/protocol owns its thinking fields, including defaults.
// Generic OpenAI/Anthropic mappings must not overwrite this contract.
func ApplyCatalog(s Profile, body map[string]any, stream bool) bool {
	if s.Rule == nil {
		return false
	}
	rule := s.Rule
	for _, key := range []string{"reasoning", "thinking", "output_config", "reasoning_effort", "thinking_budget", "enable_thinking", "tool_stream"} {
		delete(body, key)
	}
	opts := cloneOptions(rule.Defaults)
	if opts == nil {
		opts = map[string]any{}
	}
	for _, spec := range rule.ParameterSpecs {
		if value, has := s.Options[spec.Key]; has && ValidValue(spec, value) {
			opts[spec.Key] = value
			continue
		}
		if s.Adapter != "deepseek" {
			continue
		}
		switch spec.Key {
		case "reasoning_enabled":
			opts[spec.Key] = s.ThinkingEnabled
		case "reasoning_effort":
			if ValidValue(spec, s.ReasoningEffort) {
				opts[spec.Key] = s.ReasoningEffort
			}
		case "thinking_mode":
			if !s.ThinkingEnabled {
				opts[spec.Key] = "disabled"
			} else if slicesHas(spec.Values, "adaptive") {
				opts[spec.Key] = "adaptive"
			} else {
				opts[spec.Key] = "enabled"
			}
		}
	}
	if rule.AlwaysThinking {
		opts["reasoning_enabled"] = true
		if _, has := opts["thinking_mode"]; has {
			opts["thinking_mode"] = "enabled"
		}
	}
	if rule.StreamOnly && !stream {
		opts["reasoning_enabled"] = false
		opts["thinking_mode"] = "disabled"
	}
	if _, has := s.Options["reasoning_budget"]; has && !rule.IgnoreBudget {
		delete(opts, "reasoning_effort")
	}
	if rule.IgnoreBudget {
		delete(opts, "reasoning_budget")
	}
	if opts["reasoning_enabled"] == false || opts["thinking_mode"] == "disabled" {
		delete(opts, "reasoning_effort")
		delete(opts, "reasoning_budget")
	}
	for _, spec := range rule.ParameterSpecs {
		if value, has := opts[spec.Key]; has && ValidValue(spec, value) {
			setCatalogPath(body, spec.WirePath, value)
		}
	}
	return true
}

func slicesHas(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
