// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ModelCatalogEntry; ModelReasoningOption; ModelCatalogRule; catalogProfile; ModelCatalog; catalogRule; reviewedParameterSpec; nativeModelReference; profileCapacityReference; lookupCatalogProfile; verifiedCatalogGateway; verifiedBailianEndpoint; enrichCatalogProfile; profileContextLimit; upgradeCatalogProfile
// Impact: python -B scripts/code-atlas.py show Core/model_catalog.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"github.com/aieyra/aieyra-os/api/catalog"
	"github.com/aieyra/aieyra-os/api/parameters"
	"strings"
)

type ModelCatalogEntry = catalog.Entry
type ModelReasoningOption = catalog.ReasoningOption
type ModelCatalogRule = parameters.Rule

func catalogProfile(p *APIProfile) catalog.Profile {
	return catalog.Profile{Provider: p.Provider, BaseURL: p.BaseURL, Model: p.Model, Protocol: p.Protocol}
}
func ModelCatalog(provider, baseURL string) []ModelCatalogEntry {
	return currentCatalog().Entries(provider, baseURL)
}
func catalogRule(p *APIProfile) (ModelCatalogRule, bool) {
	return currentCatalog().Rule(catalogProfile(p))
}
func reviewedParameterSpec(f ParameterSpec) bool { return currentCatalog().ReviewedSpec(f) }
func nativeModelReference(id string) (ModelCatalogEntry, bool) {
	return currentCatalog().NativeModel(id)
}
func profileCapacityReference(p *APIProfile) (ModelCatalogEntry, bool) {
	return currentCatalog().Capacity(catalogProfile(p))
}
func lookupCatalogProfile(p *APIProfile) (ModelCatalogEntry, bool) {
	return currentCatalog().LookupProfile(catalogProfile(p))
}
func verifiedCatalogGateway(raw string) bool  { return catalog.VerifiedGateway(raw) }
func verifiedBailianEndpoint(raw string) bool { return catalog.VerifiedBailianEndpoint(raw) }

// The host owns persisted profile migration; query and wire policy live in API.
func enrichCatalogProfile(p *APIProfile) {
	if catalog.MuseKind(p.BaseURL, p.Model) == "chat" {
		p.ToolCalls, p.Vision, p.Reasoning = false, false, false
		p.ParameterSpecs = []ParameterSpec{{Key: "stream", Type: "boolean"}}
		var saved map[string]any
		if json.Unmarshal(p.Parameters, &saved) == nil && saved != nil {
			saved["max_tokens"], saved["response_format"], saved["model_options"] = 0, "text", map[string]any{}
			p.Parameters = rawJSON(saved)
		}
		return
	}
	rule, ok := catalogRule(p)
	if !ok {
		return
	}
	keys := map[string]bool{}
	for _, spec := range rule.ParameterSpecs {
		keys[spec.Key] = true
	}
	kept := []ParameterSpec{}
	for _, spec := range p.ParameterSpecs {
		if !keys[spec.Key] && !strings.HasPrefix(spec.Key, "reasoning_") && spec.Key != "thinking_mode" && spec.Key != "tool_stream" {
			kept = append(kept, spec)
		}
	}
	var specs []ParameterSpec
	_ = json.Unmarshal(rawJSON(rule.ParameterSpecs), &specs)
	p.ParameterSpecs = append(kept, specs...)
	p.Reasoning = rule.AlwaysThinking || len(rule.ParameterSpecs) > 0
	var params map[string]any
	if json.Unmarshal(p.Parameters, &params) == nil {
		if options, ok := params["model_options"].(map[string]any); ok {
			for key, value := range options {
				if !strings.HasPrefix(key, "reasoning_") && key != "thinking_mode" && key != "tool_stream" {
					continue
				}
				valid := false
				for _, spec := range rule.ParameterSpecs {
					if spec.Key == key && validModelOption(spec, value) {
						valid = true
						break
					}
				}
				if !valid || rule.AlwaysThinking && (key == "reasoning_enabled" && value == false || key == "thinking_mode" && value == "disabled") {
					delete(options, key)
				}
			}
			if options["reasoning_enabled"] == false || options["thinking_mode"] == "disabled" {
				delete(options, "reasoning_effort")
				delete(options, "reasoning_budget")
			}
			p.Parameters = rawJSON(params)
		}
	}
}

func profileContextLimit(p *APIProfile) int {
	limit := p.ContextWindowLimit
	if entry, ok := profileCapacityReference(p); ok && entry.ContextWindow > 0 && (limit <= 0 || entry.ContextWindow < limit) {
		limit = entry.ContextWindow
	}
	if (p.ContextWindowSource == "provider_catalog" || p.ContextWindowSource == "official_model_reference" || p.ContextWindowSource == "bundled_model_reference") && p.ContextWindow > 0 && (limit <= 0 || p.ContextWindow < limit) {
		limit = p.ContextWindow
	}
	return limit
}

// Capacity comes from reviewed references and explicit provider ceilings.
// Old client/user budgets are not model capacities; compaction remains a
// separate persisted choice, including an explicit zero.
func upgradeCatalogProfile(p *APIProfile) {
	placeholder := p.ContextWindowSource == "conservative_client_budget"
	if limit := profileContextLimit(p); limit > 0 {
		switch p.ContextWindowSource {
		case "", "user", "user_config", "conservative_client_budget":
			p.ContextWindow = limit
			if p.ContextWindowSource == "" || p.ContextWindowSource == "user" || p.ContextWindowSource == "user_config" || placeholder {
				p.ContextWindowSource = "provider_catalog"
				if entry, ok := profileCapacityReference(p); ok && entry.ContextWindow == limit {
					p.ContextWindowSource = "bundled_model_reference"
				}
			}
		}
	}
	if !placeholder {
		return
	}
	entry, found := profileCapacityReference(p)
	if found {
		_, exact := lookupCatalogProfile(p)
		if exact && entry.ToolCalls != nil {
			p.ToolCalls = *entry.ToolCalls
		}
		if exact && entry.Vision != nil {
			p.Vision = *entry.Vision
		}
	}
	minimum := 8192
	if limit := profileContextLimit(p); limit > 0 {
		minimum = min(minimum, limit)
	}
	if p.ContextWindow < minimum {
		p.ContextWindow = minimum
	}
	if found && entry.MaxOutput > 0 {
		p.OutputLimit = entry.MaxOutput
	} else {
		limit := max(1, p.ContextWindow/4)
		if p.OutputLimit <= 0 || p.OutputLimit > limit {
			p.OutputLimit = limit
		}
	}
	for i := range p.ParameterSpecs {
		if p.ParameterSpecs[i].Key == "max_tokens" && len(p.ParameterSpecs[i].WirePath) == 0 {
			p.ParameterSpecs[i].Max = float64(p.OutputLimit)
		}
	}
	// Replace an excessive placeholder output selection in this profile only.
	var params map[string]any
	if json.Unmarshal(p.Parameters, &params) == nil {
		if output, ok := numberOption(params["max_tokens"]); ok && output > float64(p.OutputLimit) {
			params["max_tokens"] = p.OutputLimit
			p.Parameters = rawJSON(params)
		}
	}
}
