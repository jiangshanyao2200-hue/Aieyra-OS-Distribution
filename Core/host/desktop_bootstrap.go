// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/host/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: RunDesktopMaintenance; RunDesktopWorker; OpenDesktopSettings
// Impact: python -B scripts/code-atlas.py show Core/host/desktop_bootstrap.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package host

import (
	"flag"
	"fmt"
	"io"
	"strings"

	agent "github.com/aieyra/aieyra-os/CORE"
)

// Managed updates relaunch descriptor.executable, which can be the standalone
// Link entry. Dispatch them before selecting a module or opening a profile.
func RunDesktopMaintenance(args []string) (bool, error) {
	if len(args) == 0 || !strings.HasPrefix(args[0], "-") {
		return false, nil
	}
	name := strings.TrimLeft(strings.SplitN(args[0], "=", 2)[0], "-")
	if name == "extract-release-patch" {
		return true, runReleasePatch(args[1:])
	}
	if name != "apply-update" && name != "recover-update" && name != "update-probe" {
		return false, nil
	}
	fs := flag.NewFlagSet("desktop-maintenance", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	apply := fs.String("apply-update", "", "")
	recover := fs.String("recover-update", "", "")
	probe := fs.String("update-probe", "", "")
	parent := fs.Int("update-parent", 0, "")
	if err := fs.Parse(args); err != nil {
		return true, err
	}
	count := 0
	for _, value := range []string{*apply, *recover, *probe} {
		if value != "" {
			count++
		}
	}
	if count != 1 || fs.NArg() != 0 {
		return true, fmt.Errorf("exactly one desktop maintenance operation is required")
	}
	if *apply != "" {
		return true, RunManagedUpdate(*apply, *parent)
	}
	if *recover != "" {
		return true, RecoverUpdatePlan(*recover, *parent)
	}
	return true, ProbeManagedUpdate(*probe)
}

// RunDesktopWorker dispatches self-executable workers before any window or
// module-name handling. Both graphical entrypoints can own the shared Core.
func RunDesktopWorker(args []string, in io.Reader, out io.Writer) (bool, error) {
	if len(args) != 1 {
		return false, nil
	}
	switch args[0] {
	case agent.ModelDiagnosticWorkerFlag:
		return true, agent.RunModelDiagnosticWorker(in, out)
	case agent.MatrixWorkerFlag:
		return true, agent.RunMatrixModelWorker(in, out)
	case "-browser-secret-seal":
		return true, runBrowserSecretWorker(true, in, out)
	case "-browser-secret-open":
		return true, runBrowserSecretWorker(false, in, out)
	default:
		return false, nil
	}
}

// OpenDesktopSettings binds the original private profile before resolving
// prompts. Module launchers and the OS use exactly the same configuration path.
func OpenDesktopSettings(config, promptDir string) (*agent.Settings, func(), error) {
	s, err := LoadChatSettings(config)
	if err != nil {
		return nil, nil, err
	}
	release, err := agent.UsePrivateProfile(s.Path())
	if err != nil {
		return nil, nil, err
	}
	if promptDir != "" {
		s.PromptDir = promptDir
	}
	if _, err = LoadPrompts(s); err != nil {
		release()
		return nil, nil, err
	}
	return s, release, nil
}
