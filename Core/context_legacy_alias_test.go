// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestLegacyContextAliasesUseCurrentCompactionAndDurableReceipt
// Impact: python -B scripts/code-atlas.py show Core/context_legacy_alias_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"testing"
)

func TestLegacyContextAliasesUseCurrentCompactionAndDurableReceipt(t *testing.T) {
	w := &Workspace{}
	c := &contextCompaction{}
	ctx := context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{workspace: w, role: WorkspaceMatrix})
	ctx = context.WithValue(ctx, contextCompactionKey{}, c)
	ctx = context.WithValue(ctx, compactBoundaryKey{}, true)
	ctx = context.WithValue(ctx, toolInvocationKey{}, "legacy-boundary:call")
	call := ToolCall{ID: "alias-call", Function: FunctionCall{Name: "memory", Arguments: `{"action":"context_clean"}`}}
	value := executeWorkspaceTool(ctx, call)
	result, ok := value.(map[string]any)
	if !ok || result["ok"] != true || c.snapshot() == nil || c.snapshot().State != "scheduled" || w.contextClean != nil {
		t.Fatal("legacy alias failed or revived the retired cleanup queue", value)
	}
	// A crash after the tool receipt commit must restore the same pending
	// compaction, even when the archive used the old public action name.
	turn := ToolTurn{Messages: []Message{{Role: RoleAssistant, ToolCalls: []ToolCall{call}}, {Role: RoleTool, ToolCallID: call.ID, Content: string(rawJSON(value))}}}
	restored := scheduledCompaction(turn)
	if restored == nil || restored.RequestID != c.snapshot().RequestID {
		t.Fatal("committed legacy receipt lost its compaction on recovery", restored)
	}
	statusCall := call
	statusCall.Function.Arguments = `{"action":"context_status"}`
	status := executeWorkspaceTool(ctx, statusCall)
	if row, ok := status.(map[string]any); !ok || row["ok"] != true || row["compaction"].(*CompactionState).RequestID != restored.RequestID {
		t.Fatal("legacy status returned a different maintenance flow", status)
	}
	turn.Messages[0].ToolCalls = []ToolCall{statusCall}
	turn.Messages[1].Content = string(rawJSON(status))
	if got := scheduledCompaction(turn); got != nil {
		t.Fatal("a status receipt scheduled new work", got)
	}
}
