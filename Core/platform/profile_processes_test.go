// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/platform/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestProfileProcessExplicitConfigMustBeAnExactArgument
// Impact: python -B scripts/code-atlas.py show Core/platform/profile_processes_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package platform

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestProfileProcessExplicitConfigMustBeAnExactArgument(t *testing.T) {
	app := t.TempDir()
	config := filepath.Join(app, "Config", "config.json")
	data := filepath.Join(app, "Data")
	other := filepath.Join(t.TempDir(), "alternate config.json")
	exe := filepath.Join(app, "Aieyra OS.exe")
	rows := []profileProcess{
		{PID: 1, Executable: exe, Command: `"` + exe + `" --description "has-config-in-text"`},
		{PID: 2, Executable: exe, Command: `"` + exe + `" --config "` + other + `"`},
		{PID: 3, Executable: exe, Command: `"` + exe + `" --config="` + other + `"`},
		{PID: 4, Executable: exe, Command: `"` + exe + `" --config relative.json`},
		{PID: 5, Executable: exe, Command: `"` + exe + `" --config "` + config + `"`},
		{PID: 6, Executable: exe, Command: `"` + exe + `" --config "unterminated`},
	}
	if got := matchingProfileProcesses(rows, app, config, data); !reflect.DeepEqual(got, []int{1, 4, 5, 6}) {
		t.Fatal(got)
	}
}
