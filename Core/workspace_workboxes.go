// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workboxesCall
// Impact: python -B scripts/code-atlas.py show Core/workspace_workboxes.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	tool "github.com/aieyra/aieyra-os/tool/contract"
)

// The authenticated primary client uses the same workflow service as Toolbox.
// It inspects the private user workflow service; task and split hosts cannot
// acquire that authority. Legacy callers retain their own manager tree scope.
func (w *Workspace) workboxesCall(ctx context.Context, raw json.RawMessage) (any, error) {
	if w.host == nil || w.split != nil || w.manager == nil {
		return nil, fmt.Errorf("workflow management requires the primary host")
	}
	var p struct {
		Action  string          `json:"action"`
		Package string          `json:"package"`
		Owner   string          `json:"owner"`
		Command json.RawMessage `json:"command"`
		Offset  int             `json:"offset"`
		Limit   int             `json:"limit"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if !tool.ValidPackageID(p.Package) {
		return nil, fmt.Errorf("complete workflow package identity required")
	}
	m := w.manager
	w.mu.Lock()
	actor := w.state.Roles[WorkspaceMatrix]
	workdir := w.state.Workdir
	w.mu.Unlock()
	if actor == "" {
		actor = m.owner
	}
	ctx = WithToolPermissions(ctx, append(w.permissions(WorkspaceMatrix), "agents"))
	ctx = context.WithValue(ctx, nativeWorkflowKey{}, true)
	var routeErr error
	m, actor, ctx, routeErr = m.workflowTarget(ctx, actor)
	if routeErr != nil {
		return nil, routeErr
	}
	owners := map[string]bool{m.owner: true}
	m.mu.Lock()
	for id := range m.jobs {
		if m.ownsLocked(m.owner, id) {
			owners[id] = true
		}
	}
	m.mu.Unlock()
	if p.Owner != "" {
		if !owners[p.Owner] {
			return nil, fmt.Errorf("workflow owner is outside this workspace")
		}
		actor = p.Owner
	}
	ctx = context.WithValue(WithAgentManager(ctx, m, actor, nil), workspaceContextKey{}, workspaceContext{w, WorkspaceMatrix})
	if !toolAllowed(ctx, p.Package) {
		return nil, fmt.Errorf("workflow capability is disabled")
	}
	switch p.Action {
	case "describe":
		v, _, _, err := m.workflowPackage(ctx, p.Package)
		if err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "title": v.Title, "definition": v.Definition, "workdir": workdir}, nil
	case "list":
		if p.Limit == 0 {
			p.Limit = 50
		}
		if p.Limit < 1 || p.Limit > 100 || p.Offset < 0 {
			return nil, fmt.Errorf("invalid workflow page")
		}
		rows := []workboxSummary{}
		for owner := range owners {
			root := filepath.Join(PrivatePaths(m.config).Workflows, workflowHash(owner))
			entries, err := os.ReadDir(root)
			if os.IsNotExist(err) {
				continue
			}
			if err != nil {
				return nil, err
			}
			for _, entry := range entries {
				if !entry.IsDir() || !validWorkflowID(entry.Name()) {
					continue
				}
				store, _ := m.workflowStore(owner, entry.Name())
				d, e := store.summary()
				if e != nil {
					return nil, e
				}
				if d.Package == p.Package && d.Owner == owner {
					rows = append(rows, d)
				}
			}
		}
		sort.Slice(rows, func(a, b int) bool {
			if rows[a].Created == rows[b].Created {
				return rows[a].ID < rows[b].ID
			}
			return rows[a].Created > rows[b].Created
		})
		total := len(rows)
		start := min(p.Offset, total)
		end := min(start+p.Limit, total)
		return map[string]any{"ok": true, "instances": rows[start:end], "total": total, "next_offset": end}, nil
	case "call":
		// A native user click authorizes the command, not undeclared capabilities.
		// The workflow still validates package grants and all dependency versions.
		i, err := m.workflowCall(ctx, actor, p.Package, p.Command)
		out := map[string]any{"ok": err == nil, "instance": i}
		if err != nil {
			out["error"] = err.Error()
		}
		return out, nil
	default:
		return nil, fmt.Errorf("unknown workflow service action")
	}
}
