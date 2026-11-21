// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: packageAgentTool
// Impact: python -B scripts/code-atlas.py show Core/agent_package_tool.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
)

func (m *AgentManager) packageAgentTool(ctx context.Context, actor string, raw json.RawMessage) (any, error) {
	if len(raw) > 128<<10 {
		return nil, fmt.Errorf("Agent command exceeds128KiB")
	}
	var p agentPackageCommand
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&p); err != nil {
		return nil, err
	}
	if d.Decode(new(any)) != io.EOF {
		return nil, fmt.Errorf("one Agent command required")
	}
	if bound, ok := ctx.Value(conversationLinkCallerKey{}).(conversationLinkCaller); ok && bound.ID == actor && m.workspace != nil && m.workspace.host != nil && m.primaryWorkflowActor(actor) {
		return m.workspace.motherPackageCall(ctx, actor, p)
	}
	if p.Action == "sources" {
		return m.agentPackageSources(ctx)
	}
	if p.Action == "models" {
		return m.Call(ctx, actor, rawJSON(map[string]any{"action": "models"}))
	}
	if m.packageService {
		return m.packageAgentCommand(ctx, actor, p)
	}
	if !m.primaryWorkflowActor(actor) {
		return nil, fmt.Errorf("Agent packages require an assigned supervisor")
	}
	next, err := m.ensurePackageAgentHost(true)
	if err != nil {
		return nil, err
	}
	if next == nil {
		return nil, fmt.Errorf("Agent service unavailable")
	}
	return next.packageAgentCommand(ctx, "primary", p)
}
