// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: packageRuntimeKey; packageRuntimeContext; program
// Impact: python -B scripts/code-atlas.py show Core/agent_package_program.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"

	"github.com/aieyra/aieyra-os/CORE/modules"
)

type packageRuntimeKey struct{}
type packageRuntimeContext struct {
	manager *AgentManager
	record  AgentRecord
}

// Package instances cannot use the primary user's module/settings facade.
// Their Program port admits only an explicitly pinned dependency and uses the
// existing Program host and operation receipts, including for delegated work.
func (r packageRuntimeContext) program(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var p struct {
		Action    string                     `json:"action"`
		Operation string                     `json:"operation"`
		Arguments map[string]json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if p.Action == "workflow" {
		return r.workflow(ctx, p.Operation, rawJSON(p.Arguments))
	}
	if p.Action != "program" || !slices.Contains([]string{"describe", "open", "snapshot", "invoke", "close"}, p.Operation) {
		return nil, fmt.Errorf("Agent software_api accepts only declared Program operations")
	}
	if r.manager.packageProgram == nil {
		return nil, fmt.Errorf("this client has no Program host; use a Desktop host for this dependency")
	}
	var id string
	if json.Unmarshal(p.Arguments["id"], &id) != nil || id == "" {
		return nil, fmt.Errorf("Program identity is required")
	}
	i := r.record.Instance
	if i == nil {
		r.manager.mu.Lock()
		if parent := r.manager.jobs[r.record.Parent]; parent != nil {
			i = copyRecord(parent.record).Instance
		}
		r.manager.mu.Unlock()
	}
	if i == nil || !slices.Contains(i.Current.Definition.Runtime.Programs, id) {
		return nil, fmt.Errorf("Program is not declared by this Agent")
	}
	digest := i.Current.Dependencies[id]
	resolved, err := r.manager.toolPackages().Call(ctx, modules.Request{Action: "resolve", ID: id})
	if err != nil {
		return nil, err
	}
	if digest == "" || resolved.Item == nil || resolved.Item.Digest != digest {
		return nil, fmt.Errorf("Program dependency changed; the Agent's existing binding is retained")
	}
	p.Arguments["expected_digest"] = rawJSON(digest)
	if p.Operation == "invoke" {
		var request string
		if json.Unmarshal(p.Arguments["request_id"], &request) != nil || request == "" || len(request) > 128 {
			return nil, fmt.Errorf("Program invocation needs a bounded stable request_id")
		}
		p.Arguments["request_id"] = rawJSON("agent-" + workflowHash(r.record.ID+"\x00"+request))
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return r.manager.packageProgram(ctx, rawJSON(p))
}
