// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: applyCatalogMaintenanceSettings
// Impact: python -B scripts/code-atlas.py show Core/model_catalog_maintenance.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"slices"
	"strings"
)

// The memory owner calls this on a cloned maintenance configuration, after
// generic compaction overrides. Persisted profile settings remain untouched.
func applyCatalogMaintenanceSettings(snapshot *Settings) {
	p := snapshot.activePoolProfile()
	if p == nil || snapshot.ModelPoolVersion != 1 {
		return
	}
	limit := max(1, p.ContextWindow/4)
	if p.OutputLimit > 0 {
		limit = min(limit, p.OutputLimit)
	}
	snapshot.MaxTokens = min(max(1, snapshot.MaxTokens), limit)
	rule, reviewed := catalogRule(p)
	if !reviewed {
		return
	}
	options := cloneOptions(snapshot.ModelOptions)
	if options == nil {
		options = map[string]any{}
	}
	for key := range options {
		if strings.HasPrefix(key, "reasoning_") || key == "thinking_mode" {
			delete(options, key)
		}
	}
	disabled := false
	for _, spec := range rule.ParameterSpecs {
		switch spec.Key {
		case "reasoning_enabled":
			options[spec.Key] = rule.AlwaysThinking
			disabled = !rule.AlwaysThinking
		case "thinking_mode":
			if !rule.AlwaysThinking && slices.Contains(spec.Values, "disabled") {
				options[spec.Key] = "disabled"
				disabled = true
			} else if mode, ok := rule.Defaults[spec.Key]; ok {
				options[spec.Key] = mode
			}
		}
	}
	if !disabled {
		for _, spec := range rule.ParameterSpecs {
			if spec.Key == "reasoning_effort" && len(spec.Values) > 0 {
				options[spec.Key] = spec.Values[0]
			}
		}
	}
	snapshot.ModelOptions = options
}
