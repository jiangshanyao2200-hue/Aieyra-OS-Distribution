// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestOfficialToolUnavailableHasLocalFailureClassification
// Impact: python -B scripts/code-atlas.py show Core/tool_official_failure_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"errors"
	"fmt"
	"testing"
)

func TestOfficialToolUnavailableHasLocalFailureClassification(t *testing.T) {
	failure := classifyAgentFailure(fmt.Errorf("execution: %w", &officialToolUnavailableError{name: "terminal"}), "")
	if failure.Code != "tool_package_disabled" || failure.Origin != "local" || failure.Retryable {
		t.Fatalf("unexpected local classification: %+v", failure)
	}
	// Provider text cannot manufacture a local package failure.
	if got := classifyAgentFailure(errors.New("tool_package_disabled: terminal"), ""); got.Code != "unclassified" {
		t.Fatalf("plain text was trusted: %+v", got)
	}
}
