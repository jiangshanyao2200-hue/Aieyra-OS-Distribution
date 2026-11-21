// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: samplingParameter; genericOptions
// Impact: python -B scripts/code-atlas.py show Core/model_options.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "github.com/aieyra/aieyra-os/api/parameters"

func samplingParameter(key string) bool { return parameters.Sampling(key) }

// Compatibility entry for diagnostics; actual encoding lives in API.
func genericOptions(s *Settings, body map[string]any, streaming ...bool) {
	stream := s.StreamEnabled()
	if len(streaming) > 0 {
		stream = streaming[0]
	}
	parameters.ApplyGeneric(parameterProfile(s), body, stream)
}
