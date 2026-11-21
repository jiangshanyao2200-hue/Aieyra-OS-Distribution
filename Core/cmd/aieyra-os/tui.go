// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/cmd/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: renderChatDump; tuiArgs; runTUI
// Impact: python -B scripts/code-atlas.py show Core/cmd/aieyra-os/tui.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	agent "github.com/aieyra/aieyra-os/CORE"
	app "github.com/aieyra/aieyra-os/CORE/host"
	"github.com/aieyra/aieyra-os/client/CLI/host"
	"github.com/aieyra/aieyra-os/client/CLI/terminal"
)

func renderChatDump(s *agent.Settings, width, height int) {
	terminal.Dump(os.Stdout, app.Version, s.Model, width, height)
}

// The compatibility switch uses the same host and renderer as Aieyra CLI.
func tuiArgs(config, resume, workdir, promptDir, model string) []string {
	args := []string{"chat"}
	for _, option := range [][2]string{{"--config", config}, {"--resume", resume}, {"--workdir", workdir}, {"--prompt-dir", promptDir}, {"--model", model}} {
		if option[1] != "" {
			args = append(args, option[0], option[1])
		}
	}
	return args
}

func runTUI(config, resume, workdir, promptDir, model string) error {
	restore, err := app.PrepareTerminalConsole()
	if err != nil {
		return err
	}
	defer restore()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return cli.RunWithTerminal(ctx, tuiArgs(config, resume, workdir, promptDir, model), os.Stdin, os.Stdout, os.Stderr, app.Version, terminal.Run)
}
