// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: main
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/cmd/aieyra-link/main.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package main

import (
	"context"
	"fmt"
	"github.com/aieyra/aieyra-link/link"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	args := os.Args[1:]
	diagnostic := len(args) == 0 || len(args) == 1 && (args[0] == "help" || args[0] == "version" || args[0] == "--help" || args[0] == "-h")
	if !diagnostic {
		owned, release, err := moduleContext(ctx)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		defer release()
		ctx = owned
	}
	if err := link.Run(ctx, args, os.Stdout, os.Stderr); err != nil {
		if ctx.Err() != nil {
			return
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
