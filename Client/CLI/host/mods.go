// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: runMods
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/mods.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package cli

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"

	"github.com/aieyra/aieyra-os/CORE/extensionhost"
	"github.com/aieyra/aieyra-os/CORE/modules"
	"github.com/aieyra/aieyra-os/CORE/platform"
	"github.com/aieyra/aieyra-os/contracts/storage"
)

// Package management is independent of model configuration, chat, and renderers.
// JSON carries the exact inspected revision, digest, grants and stable request ID.
func runMods(ctx context.Context, args []string, in io.Reader, out, diagnostic io.Writer) error {
	fs := flag.NewFlagSet("mods", flag.ContinueOnError)
	fs.SetOutput(diagnostic)
	config := fs.String("config", "", "configuration identity (file need not exist)")
	fs.Usage = func() {
		fmt.Fprintln(out, "Aieyra CLI mods [--config FILE]\nRead one JSON request from stdin; write one JSON result.\nActions: capabilities, inspect, list, install, enable, disable, resolve, rollback, remove.\nThe compatibility target is Desktop. This command never opens a program or a model.\nMutations require request_id, expected_revision, expected_digest; enable also requires exact grants.")
	}
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("mods accepts one JSON request on stdin")
	}
	file, err := resolveConfig(*config)
	if err != nil {
		return err
	}
	raw, err := io.ReadAll(io.LimitReader(in, 1048577))
	if err != nil {
		return err
	}
	if len(raw) > 1048576 {
		return fmt.Errorf("package request exceeds 1 MiB")
	}
	var p modules.Request
	if err = json.Unmarshal(raw, &p); err != nil {
		return err
	}
	release, err := storage.Enter(file)
	if err != nil {
		return err
	}
	defer release()
	layout := platform.ResolveLayout(platform.AppRoot(), file, "")
	host := extensionhost.Desktop()
	if p.Action == "capabilities" {
		return json.NewEncoder(out).Encode(map[string]any{"ok": true, "host": host, "layout": layout})
	}
	r, err := extensionhost.New(layout.Packages, host).Call(ctx, p)
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(r)
}
