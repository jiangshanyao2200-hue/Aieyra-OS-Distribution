// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: savedWorkflow; workflowResult
// Impact: python -B scripts/code-atlas.py show Core/workbox_toolbox.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"

	"github.com/aieyra/aieyra-os/contracts/protocol"
	"github.com/aieyra/aieyra-os/tool/workbox"
)

// Reading a persisted instance must not require its old package to remain
// enabled. Ownership, original package identity and the caller's grant still do.
func (m *AgentManager) savedWorkflow(ctx context.Context, actor, identity string, raw json.RawMessage) bool {
	a, err := workbox.DecodeRequest(raw)
	if err != nil || !validWorkflowID(a.ID) {
		return false
	}
	if next, owner, nextCtx, err := m.workflowTarget(ctx, actor); err != nil {
		return false
	} else if next != m {
		return next.savedWorkflow(nextCtx, owner, identity, raw)
	}

	owner, err := m.workflowOwner(actor, identity, a.ID)
	if err != nil {
		return false
	}
	store, err := m.workflowStore(owner, a.ID)
	if err != nil {
		return false
	}
	d, err := store.read()
	return err == nil && d.Instance.Package == identity && d.Instance.Owner == owner
}
func (t *ToolboxState) workflowResult(ctx context.Context, manager agentManagerContext, name string, raw json.RawMessage) ToolboxResult {
	i, err := manager.manager.workflowCall(ctx, manager.owner, name, raw)
	r := ToolboxResult{Package: name, OK: err == nil, State: i.State, Description: i.Title, Presentation: &protocol.ToolPresentation{Kind: "cards", Title: i.Title}, Data: rawJSON(i), Open: t.Clone().Open, Manuals: t.Clone().Manuals, Output: "Inspect workflow state, steps, receipts and outputs. Accepted commands do not imply completion."}
	if r.State == "" {
		r.State = "failed"
	}
	if err != nil {
		r.Error = &ShellError{Code: "workflow_error", Message: err.Error()}
	}
	return r
}
