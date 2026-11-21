// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: packagesCall
// Impact: python -B scripts/code-atlas.py show Core/workspace_modules.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aieyra/aieyra-os/CORE/extensionhost"
	"github.com/aieyra/aieyra-os/CORE/modules"
	"github.com/aieyra/aieyra-os/CORE/platform"
)

func (w *Workspace) packagesCall(ctx context.Context, args json.RawMessage) (any, error) {
	if w.host == nil || w.split != nil {
		return nil, fmt.Errorf("package management requires the primary host")
	}
	var p modules.Request
	if err := json.Unmarshal(args, &p); err != nil {
		return nil, err
	}
	layout := platform.ResolveLayout(platform.AppRoot(), w.host.config, "")
	host := extensionhost.Desktop()
	if w.isTerminal() {
		host.Client = "cli"
		host.Kinds = nil
		host.Capabilities = nil
	}
	if p.Action == "capabilities" {
		return map[string]any{"ok": true, "host": host, "layout": layout}, nil
	}
	result, err := extensionhost.New(layout.Packages, host).Call(ctx, p)
	if err == nil && result.OK && (p.Action == "install" || p.Action == "enable") && !w.isTerminal() {
		m, e := w.host.conversationManager()
		if e != nil {
			return nil, e
		}
		if e = m.syncInstalledProgramContacts(ctx); e != nil {
			return nil, e
		}
	}
	return result, err
}
