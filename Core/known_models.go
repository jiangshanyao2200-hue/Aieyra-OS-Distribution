// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: upgradeKnownProfile; enrichNativeThinking
// Impact: python -B scripts/code-atlas.py show Core/known_models.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"slices"
	"strings"
)

// 旧接入流程的8K是客户端占位值；只迁移来源明确的占位，不提高供应商声明的限制。
func upgradeKnownProfile(p *APIProfile) {
	upgradeCatalogProfile(p)
	if p.Provider != "bailian" {
		if model, ok := nativeModelReference(p.Model); ok {
			p.Reasoning = model.Reasoning
			enrichNativeThinking(p, model)
		}
	}
	if p.Provider == "bailian" {
		upgradeCatalogProfile(p)
		return
	}
	id := strings.TrimPrefix(p.Model, "openai/")
	var efforts []string
	switch id {
	case "gpt-6-astra":
		efforts = []string{"low", "medium", "high", "xhigh", "max"}
	case "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra":
		efforts = []string{"none", "low", "medium", "high", "xhigh", "max"}
	default:
		upgradeCatalogProfile(p)
		return
	}
	if p.Protocol != ProtocolResponses && p.Protocol != ProtocolChat {
		upgradeCatalogProfile(p)
		return
	}
	p.Reasoning = true
	if p.ContextWindowSource == "conservative_client_budget" {
		p.ContextWindow = 1050000
		p.ContextWindowSource = "bundled_model_reference"
		p.OutputLimit = 128000
	}
	has, hasFast := false, false
	for i := range p.ParameterSpecs {
		if p.ParameterSpecs[i].Key == "service_tier" {
			hasFast = true
		}
		if p.ParameterSpecs[i].Key == "reasoning_effort" {
			has = true
		}
		if p.ParameterSpecs[i].Key == "max_tokens" && len(p.ParameterSpecs[i].WirePath) == 0 && p.ContextWindowSource == "bundled_model_reference" {
			p.ParameterSpecs[i].Max = float64(p.OutputLimit)
		}
	}
	if !has {
		p.ParameterSpecs = append(p.ParameterSpecs, ParameterSpec{Key: "reasoning_effort", Type: "enum", Values: efforts})
	}
	if !hasFast {
		p.ParameterSpecs = append(p.ParameterSpecs, ParameterSpec{Key: "service_tier", Type: "enum", Values: []string{"default", "fast"}})
	}
}

// Exact native references add missing controls only. They do not select a
// value, override channel mappings or certify the relay's tool capability.
func enrichNativeThinking(p *APIProfile, model ModelCatalogEntry) {
	if _, reviewed := catalogRule(p); reviewed {
		return
	}
	if p.Provider == "openrouter" {
		return
	}
	if p.Protocol != ProtocolResponses && p.Protocol != ProtocolChat && p.Protocol != ProtocolMessages && p.Protocol != ProtocolGoogle {
		return
	}
	has := map[string]bool{}
	for _, spec := range p.ParameterSpecs {
		has[spec.Key] = true
	}
	add := func(spec ParameterSpec) {
		if !has[spec.Key] {
			p.ParameterSpecs = append(p.ParameterSpecs, spec)
			has[spec.Key] = true
		}
	}
	for _, option := range model.ReasoningOptions {
		switch option.Type {
		case "effort":
			if len(option.Values) > 0 {
				add(ParameterSpec{Key: "reasoning_effort", Type: "enum", Values: slices.Clone(option.Values)})
			}
		case "toggle":
			if p.Protocol == ProtocolMessages {
				add(ParameterSpec{Key: "reasoning_enabled", Type: "boolean"})
			}
		case "budget_tokens":
			if p.Protocol == ProtocolMessages || p.Protocol == ProtocolGoogle {
				maximum := option.Max
				if p.OutputLimit > 0 {
					maximum = min(maximum, p.OutputLimit-1)
				}
				if maximum >= option.Min {
					add(ParameterSpec{Key: "reasoning_budget", Type: "integer", Min: float64(option.Min), Max: float64(maximum)})
				}
			}
		}
	}
	if p.Protocol == ProtocolResponses && model.Reasoning {
		add(ParameterSpec{Key: "reasoning_summary", Type: "enum", Values: []string{"auto", "concise", "detailed"}})
	}
}
