// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: packageMemoryWorkspace; instanceMemoryWorkspace
// Impact: python -B scripts/code-atlas.py show Core/agent_package_memory.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"path/filepath"
)

// The existing Memory service operates on an explicit instance directory.
// Model connections remain host references; no credentials or personal prompt
// files are copied into this directory or into an exported Agent package.
func (m *AgentManager) packageMemoryWorkspace(r AgentRecord) *Workspace {
	return m.instanceMemoryWorkspace(r)
}

// The persistent runtime ID scopes memory, including invited/group members.
// A contact template never confers access to another session or the host.
func (m *AgentManager) instanceMemoryWorkspace(r AgentRecord) *Workspace {
	service := NewSettingsService(m.config)
	service.memoryDirectory = filepath.Join(PrivatePaths(m.config).Agents, r.ID, "memory")
	return &Workspace{privateAgentScope: true, config: m.config, dir: filepath.Join(PrivatePaths(m.config).Agents, r.ID), manager: m, service: service,
		state: workspaceState{ID: r.ID, Workdir: r.Spec.Workdir, Roles: map[string]string{WorkspaceMatrix: r.ID}}, live: map[string]WorkspaceLive{}}
}
