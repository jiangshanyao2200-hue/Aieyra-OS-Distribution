// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/contract/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestContractBoundsPathsAndCopy
// Impact: python -B scripts/code-atlas.py show Agent/contract/delivery_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

import "testing"

func TestContractBoundsPathsAndCopy(t *testing.T) {
	c := &AgentContract{Acceptance: []string{" all inputs "}, Deliverables: []string{"src/a.txt"}}
	copy, err := CloneContract(c)
	if err != nil {
		t.Fatal(err)
	}
	c.Acceptance[0] = "weakened"
	if copy.Acceptance[0] != "all inputs" {
		t.Fatal(copy)
	}
	for _, p := range []string{"../outside", "..\\outside", "C:\\private\\outside", "/outside", "a:stream", ".", ""} {
		if _, err := CloneContract(&AgentContract{Acceptance: []string{"x"}, Deliverables: []string{p}}); err == nil {
			t.Errorf("accepted %q", p)
		}
	}
	if _, err := CloneContract(&AgentContract{Acceptance: []string{"x"}, Deliverables: []string{"a", "A"}}); err == nil {
		t.Fatal("duplicate target")
	}
}
