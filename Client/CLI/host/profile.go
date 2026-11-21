// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: runProfile
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/profile.go
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
	"path/filepath"

	"github.com/aieyra/aieyra-os/CORE/userdata"
	"github.com/aieyra/aieyra-os/contracts/storage"
)

func runProfile(ctx context.Context, args []string, out, diagnostic io.Writer) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: profile init|inspect --root DIRECTORY; profile prepare --root INSTALLATION; profile migrate|cancel --from-config FILE --root DIRECTORY")
	}
	action := args[0]
	fs := flag.NewFlagSet("profile "+action, flag.ContinueOnError)
	fs.SetOutput(diagnostic)
	source := fs.String("from-config", "", "existing configuration to migrate offline")
	root := fs.String("root", "", "private user-data directory")
	if err := fs.Parse(args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if *root == "" || fs.NArg() != 0 {
		return fmt.Errorf("profile requires --root DIRECTORY")
	}
	if action == "migrate" || action == "cancel" {
		if *source == "" {
			return fmt.Errorf("profile %s requires --from-config FILE", action)
		}
		if action == "cancel" {
			if err := userdata.CancelMigration(*source, *root); err != nil {
				return err
			}
			return json.NewEncoder(out).Encode(map[string]any{"cancelled": true, "originals_retained": true, "partial_destination_retained": true})
		}
		p, err := userdata.Migrate(ctx, *source, *root)
		if err != nil {
			return err
		}
		return json.NewEncoder(out).Encode(p)
	}
	if *source != "" {
		return fmt.Errorf("--from-config is only supported by profile migrate or cancel")
	}
	if action == "prepare" {
		p, err := userdata.PreparePortable(*root)
		if err != nil {
			return err
		}
		return json.NewEncoder(out).Encode(p)
	}
	if action == "init" {
		p, err := userdata.Init(*root)
		if err != nil {
			return err
		}
		return json.NewEncoder(out).Encode(p)
	}
	if action == "inspect" {
		abs, err := filepath.Abs(*root)
		if err != nil {
			return err
		}
		m, err := storage.ReadMarker(abs)
		if err != nil {
			return err
		}
		return json.NewEncoder(out).Encode(map[string]any{"root": abs, "declaration": m})
	}
	return fmt.Errorf("unknown profile action: %s", action)
}
