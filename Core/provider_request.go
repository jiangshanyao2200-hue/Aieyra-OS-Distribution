// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: parameterProfile; requestProfile
// Impact: python -B scripts/code-atlas.py show Core/provider_request.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"github.com/aieyra/aieyra-os/api/catalog"
	"github.com/aieyra/aieyra-os/api/parameters"
	"github.com/aieyra/aieyra-os/api/request"
)

func parameterProfile(s *Settings) parameters.Profile {
	profile := parameters.Profile{
		Protocol: s.Protocol(), Generic: s.GenericAdapter(), OpenCode: s.OpenCode(), OpenRouter: s.OpenRouter(),
		Legacy: s.ModelPoolVersion == 0, ResponseFormat: s.ResponseFormat, ReasoningEffort: s.ReasoningEffort,
		ThinkingEnabled: s.ThinkingEnabled(), Options: s.ModelOptions,
	}
	if model, ok := nativeModelReference(s.Model); ok {
		profile.NativeProvider = model.Provider
	}
	if p := s.activePoolProfile(); p != nil {
		profile.Adapter, profile.Reasoning = p.Adapter, p.Reasoning
		if rule, ok := catalogRule(p); ok {
			profile.Rule = &rule
		}
		for _, spec := range p.ParameterSpecs {
			if validProfileParameterPath(p, spec) {
				profile.Specs = append(profile.Specs, spec)
			}
		}
	}
	return profile
}

func requestProfile(s *Settings, stream bool) request.Profile {
	options := parameterProfile(s)
	extra := parameters.Learned(options)
	parameters.ApplyGeneric(options, extra, stream)
	return request.Profile{
		TextOnly: catalog.MuseKind(s.BaseURL, s.Model) == "chat",
		Model:    s.Model, Protocol: s.Protocol(), Provider: s.ProviderIdentity(), ReasoningField: s.ChatReasoningField(),
		Generic: s.GenericAdapter(), OpenCode: s.OpenCode(), OpenRouter: s.OpenRouter(),
		MaxTokens: s.MaxTokens, OutputLimit: s.NativeOutputLimit(), ThinkingType: s.ThinkingType, ReasoningEffort: s.NormalizedEffort(),
		ThinkingEnabled: s.ThinkingEnabled(), IncludeUsage: s.IncludeUsage, SupportsImages: SupportsToolImages(s),
		ResponseFormat: s.ResponseFormat, UserID: s.UserID, UnsupportedImageText: runtimePrompt("Matrix/辅助指令/历史图片不可用.txt"), Extra: extra,
	}
}
