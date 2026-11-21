// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/cmd/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestTUIForwardsSharedCLIOptions
// Impact: python -B scripts/code-atlas.py show Core/cmd/aieyra-os/tui_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package main

import (
	"reflect"
	"testing"
)

func TestTUIForwardsSharedCLIOptions(t *testing.T) {
	got := tuiArgs("config.json", "retired", "work", "prompts", "fixture")
	want := []string{"chat", "--config", "config.json", "--resume", "retired", "--workdir", "work", "--prompt-dir", "prompts", "--model", "fixture"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("options lost: %v", got)
	}
	if got := tuiArgs("", "", "", "", ""); !reflect.DeepEqual(got, []string{"chat"}) {
		t.Fatalf("default bootstrap changed: %v", got)
	}
}
