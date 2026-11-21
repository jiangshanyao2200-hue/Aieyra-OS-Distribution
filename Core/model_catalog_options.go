// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: validateCatalogThinking
// Impact: python -B scripts/code-atlas.py show Core/model_catalog_options.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "strings"

func validateCatalogThinking(s *Settings, p *APIProfile) error {
	rule, ok := catalogRule(p)
	if !ok {
		return nil
	}
	for key, value := range s.ModelOptions {
		if !strings.HasPrefix(key, "reasoning_") && key != "thinking_mode" {
			continue
		}
		if key == "reasoning_budget" && rule.IgnoreBudget {
			continue
		}
		found := false
		for _, spec := range rule.ParameterSpecs {
			if spec.Key == key && validModelOption(spec, value) {
				found = true
				break
			}
		}
		if !found {
			return fmtCatalogParameter(key)
		}
		if rule.AlwaysThinking && (key == "reasoning_enabled" && value == false || key == "thinking_mode" && value == "disabled") {
			return fmtCatalogParameter("此模型始终思考")
		}
	}
	return nil
}
