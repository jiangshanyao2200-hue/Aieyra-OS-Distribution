// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Program/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: TestNativeProcessUsesModuleEntryWithoutWeakeningSandbox
// Impact: python -B scripts/code-atlas.py show Program/contract/definition_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

import (
	"encoding/json"
	"testing"
)

func TestNativeProcessUsesModuleEntryWithoutWeakeningSandbox(t *testing.T) {
	for _, tc := range []struct {
		name, native, host, entry string
		declared, valid           bool
	}{
		{"native process", "link", "process", "ui/control.mjs", true, true},
		{"missing entry", "link", "process", "ui/control.mjs", false, false},
		{"process html", "link", "process", "ui/index.html", true, false},
		{"surface module", "notes", "surface", "ui/control.mjs", true, false},
		{"surface html", "notes", "surface", "ui/index.html", true, true},
		{"unbound navigation", "", "process", "ui/control.mjs", true, false},
		{"sandbox module", "", "", "ui/control.mjs", true, false},
		{"sandbox html", "", "", "ui/index.html", true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := Definition{Schema: "aieyra.program/1", Mode: "human", Desktop: Desktop{Entry: tc.entry, Native: tc.native}}
			if tc.host != "" {
				p.Desktop.Navigation = &Navigation{Tab: "dock-link", Host: tc.host}
			}
			raw, err := json.Marshal(p)
			if err != nil {
				t.Fatal(err)
			}
			_, err = Decode(raw, map[string]bool{tc.entry: tc.declared})
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v error=%v", tc.valid, err)
			}
		})
	}
}
