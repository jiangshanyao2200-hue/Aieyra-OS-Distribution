// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/memoryservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestServiceRequiresExplicitHostDependenciesBeforeOpening; TestServiceUsesInjectedResourcesAndBudget
// Impact: python -B scripts/code-atlas.py show Core/memoryservice/contract_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package memory

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestServiceRequiresExplicitHostDependenciesBeforeOpening(t *testing.T) {
	file := filepath.Join(t.TempDir(), "data", "memory.sqlite")
	if _, err := Open(file, Options{}); err == nil {
		t.Fatal("missing host dependencies accepted")
	}
	if _, err := os.Stat(filepath.Dir(file)); !os.IsNotExist(err) {
		t.Fatal("created data before validating dependencies", err)
	}
}
func TestServiceUsesInjectedResourcesAndBudget(t *testing.T) {
	seen := map[string]int{}
	now := int64(1792560000000)
	s, err := Open(filepath.Join(t.TempDir(), "memory.sqlite"), Options{Now: func() int64 { return now }, Resource: func(key string) string { seen[key]++; return "host:" + key }, EstimateTokens: func(text string) int {
		if text != "阶段正文" {
			t.Fatalf("unexpected token input: %q", text)
		}
		return 321
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	pacTestTranscript(t, s, "project:a", "session/a", []Message{{Role: RoleUser, Content: "共同经历"}})
	pacTestSeal(t, s, "project:a", "session/a", "one", "阶段正文", 0, 0)
	snapshot := memoryCall(t, s, memoryRow{"action": "pac_snapshot"}, "project:a", "test")
	if memInt(snapshot["summary_tokens"]) != 321 {
		t.Fatal("host budget not used", snapshot)
	}
	out, err := s.Call(context.Background(), memoryRow{"action": "lookup", "query": "共同经历"}, "project:a", "test")
	if err != nil || out.(memoryRow)["notice"] != "host:Matrix/记忆/检索结果说明.txt" || seen["Matrix/记忆/检索结果说明.txt"] != 1 {
		t.Fatal("resource not injected", out, err)
	}
}
