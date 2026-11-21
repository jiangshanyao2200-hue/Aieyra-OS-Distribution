// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: run; main
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/cmd/aieyra-link-lan/main.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Standalone LAN transport. The host only enrolls ordinary project workers;
// the portable client exposes the original Agent API on loopback.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/aieyra/aieyra-link/link"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

func run(ctx context.Context, args []string) error {
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" || args[0] == "-h" {
		fmt.Println("Aieyra Link LAN " + link.LANVersion + "\nrun       Automatically discover and connect to your LAN office\nserve     Advertise a local Control office for automatic collaboration\ndiscover  Scan the LAN once\nversion   Print version\nUse run --help or serve --help for options.")
		return nil
	}
	if args[0] == "version" {
		fmt.Println(link.LANVersion)
		return nil
	}
	flags := flag.NewFlagSet(args[0], flag.ContinueOnError)
	userDir, e := os.UserConfigDir()
	if e != nil {
		return e
	}
	data := flags.String("data", filepath.Join(userDir, "aieyra-link-lan"), "private identity and state directory")
	nameDefault, _ := os.Hostname()
	if nameDefault == "" {
		nameDefault = "Aieyra device"
	}
	name := flags.String("name", nameDefault, "device name (retained after first connection)")
	listenDefault := "127.0.0.1:17921"
	if args[0] == "serve" {
		listenDefault = "0.0.0.0:17920"
	}
	listen := flags.String("listen", listenDefault, "listener address")
	control := flags.String("control-url", "http://127.0.0.1:17930", "local Control office (serve only)")
	project := flags.String("project", "os", "host project (serve only)")
	if e = flags.Parse(args[1:]); e == flag.ErrHelp {
		return nil
	} else if e != nil {
		return e
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected arguments")
	}
	switch args[0] {
	case "run":
		return link.RunLAN(ctx, *data, *listen, *name, os.Stdout)
	case "serve":
		return link.ServeLAN(ctx, *data, *listen, *control, *project, *name, os.Stdout)
	case "discover":
		scan, e := link.DiscoverAutoLAN(ctx, 3*time.Second)
		if e != nil {
			return e
		}
		return json.NewEncoder(os.Stdout).Encode(scan)
	default:
		return fmt.Errorf("unknown command; use help")
	}
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if os.Getenv("AIEYRA_OS_OWNER_STDIN") == "1" {
		go func() { _, _ = io.Copy(io.Discard, os.Stdin); stop() }()
	}
	if e := run(ctx, os.Args[1:]); e != nil && ctx.Err() == nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
