// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestDesktopWorkersDispatchBeforeModuleSelection; TestDesktopMaintenanceIsHandledWithoutStartingAWorkspace
// Impact: python -B scripts/code-atlas.py show Core/host/desktop_bootstrap_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package host

import (
	"bytes"
	"strings"
	"testing"

	agent "github.com/aieyra/aieyra-os/CORE"
)

func TestDesktopWorkersDispatchBeforeModuleSelection(t *testing.T) {
	for _, flag := range []string{agent.MatrixWorkerFlag, agent.ModelDiagnosticWorkerFlag} {
		var out bytes.Buffer
		handled, err := RunDesktopWorker([]string{flag}, strings.NewReader("invalid worker input"), &out)
		if !handled || err == nil && out.Len() == 0 {
			t.Fatalf("worker %q was not dispatched: handled=%v err=%v", flag, handled, err)
		}
	}
	for _, args := range [][]string{nil, {"--module=link"}, {agent.MatrixWorkerFlag, "extra"}} {
		var out bytes.Buffer
		if handled, err := RunDesktopWorker(args, strings.NewReader(""), &out); handled || err != nil || out.Len() != 0 {
			t.Fatalf("non-worker arguments dispatched: %v", args)
		}
	}
}

func TestDesktopMaintenanceIsHandledWithoutStartingAWorkspace(t *testing.T) {
	for _, args := range [][]string{{"-apply-update", "missing-plan"}, {"--recover-update=missing-plan"}, {"-update-probe", "missing-probe"}, {"--apply-update=a", "--recover-update=b"}, {"--apply-update="}} {
		if handled, err := RunDesktopMaintenance(args); !handled || err == nil {
			t.Fatalf("invalid maintenance must fail before GUI startup: %v %v %v", args, handled, err)
		}
	}
	for _, args := range [][]string{{"--module=link"}, {"-p", "-apply-update"}, {"cli", "--help"}} {
		if handled, err := RunDesktopMaintenance(args); handled || err != nil {
			t.Fatal("ordinary arguments mistaken for maintenance", args, handled, err)
		}
	}
}
