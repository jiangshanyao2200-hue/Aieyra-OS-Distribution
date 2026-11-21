// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/cmd/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: main
// Impact: python -B scripts/code-atlas.py show Core/cmd/aieyra-link/main.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package main

import (
	"context"
	"fmt"
	"github.com/aieyra/aieyra-os/CORE/host/linkclient"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := linkclient.Run(ctx, os.Args[1:], os.Stdin, os.Stdout, os.Stderr); err != nil {
		if code, child := linkclient.ExitCode(err); child {
			os.Exit(code)
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
