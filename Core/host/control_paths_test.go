// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestIndependentControlWindowIsRetired
// Impact: python -B scripts/code-atlas.py show Core/host/control_paths_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package host

import (
	"strings"
	"testing"
)

func TestIndependentControlWindowIsRetired(t *testing.T) {
	if err := LaunchControlGUI(); err == nil || !strings.Contains(err.Error(), "Aieyra OS") {
		t.Fatalf("independent window launch: %v", err)
	}
}
