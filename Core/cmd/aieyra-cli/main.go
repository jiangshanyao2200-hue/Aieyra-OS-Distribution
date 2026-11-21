// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/cmd/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: main
// Impact: python -B scripts/code-atlas.py show Core/cmd/aieyra-cli/main.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// aieyra-cli is a native console host of the shared OS core.
package main

import (
	"context"
	"fmt"
	agent "github.com/aieyra/aieyra-os/CORE"
	"os"
	"os/signal"
	"syscall"

	"github.com/aieyra/aieyra-os/CORE/host"
	"github.com/aieyra/aieyra-os/CORE/host/linkclient"
	"github.com/aieyra/aieyra-os/client/CLI/host"
	"github.com/aieyra/aieyra-os/client/CLI/terminal"
)

func main() {
	if len(os.Args) == 2 && os.Args[1] == agent.ModelDiagnosticWorkerFlag {
		if err := agent.RunModelDiagnosticWorker(os.Stdin, os.Stdout); err != nil {
			os.Exit(1)
		}
		return
	}
	if len(os.Args) == 2 && os.Args[1] == agent.MatrixWorkerFlag {
		if err := agent.RunMatrixModelWorker(os.Stdin, os.Stdout); err != nil {
			os.Exit(1)
		}
		return
	}
	host.EnsureConsoleUTF8()
	profileMaintenance := len(os.Args) > 1 && os.Args[1] == "profile"
	if !agent.CurrentReleaseStage().CLI && !profileMaintenance {
		fmt.Fprintln(os.Stdout, "CLI 在基础能力打磨阶段暂未开放，请使用 Aieyra OS。恢复方式见 docs/阶段性隐藏功能清单.md。")
		return
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := cli.RunWithTerminal(ctx, os.Args[1:], os.Stdin, os.Stdout, os.Stderr, host.Version, terminal.Run); err != nil {
		if code, child := linkclient.ExitCode(err); child {
			os.Exit(code)
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
