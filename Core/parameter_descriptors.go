// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: validParameterPath; validProfileParameterPath
// Impact: python -B scripts/code-atlas.py show Core/parameter_descriptors.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"github.com/aieyra/aieyra-os/api/parameters"
	"reflect"
	"strings"
)

func validParameterPath(f ParameterSpec) bool {
	return reviewedParameterSpec(f) || parameters.ValidPath(f)
}

func validProfileParameterPath(p *APIProfile, f ParameterSpec) bool {
	if strings.HasPrefix(f.Source, "bundled_catalog:") {
		rule, ok := catalogRule(p)
		if ok {
			for _, spec := range rule.ParameterSpecs {
				if reflect.DeepEqual(f, spec) {
					return true
				}
			}
		}
		return false
	}
	return validParameterPath(f)
}
