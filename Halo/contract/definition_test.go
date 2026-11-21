// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Halo/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: TestSharedCases
// Impact: python -B scripts/code-atlas.py show Halo/contract/definition_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

import (
	"encoding/json"
	"os"
	"testing"
)

func TestSharedCases(t *testing.T) {
	raw, err := os.ReadFile("cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name  string          `json:"name"`
		Valid bool            `json:"valid"`
		Value json.RawMessage `json:"value"`
	}
	if err = json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			_, err := Decode(c.Value)
			if (err == nil) != c.Valid {
				t.Fatalf("valid=%v error=%v", c.Valid, err)
			}
		})
	}
}
