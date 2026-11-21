// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: hideUpdateProcess; rejectUpdateHardlink; waitUpdateParent
// Impact: python -B scripts/code-atlas.py show Core/host/managed_update_other.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build !windows

package host

import (
	"fmt"
	"os"
	"os/exec"
	"reflect"
	"time"
)

func hideUpdateProcess(command *exec.Cmd) {}
func rejectUpdateHardlink(file string) error {
	info, err := os.Stat(file)
	if err != nil {
		return err
	}
	stat := reflect.Indirect(reflect.ValueOf(info.Sys()))
	if stat.IsValid() {
		n := stat.FieldByName("Nlink")
		if n.IsValid() && n.CanUint() && n.Uint() > 1 {
			return fmt.Errorf("hard links are not update targets")
		}
	}
	return nil
}
func waitUpdateParent(pid int) (func(time.Duration) error, func(), error) {
	return nil, nil, fmt.Errorf("desktop update handoff requires Windows")
}
