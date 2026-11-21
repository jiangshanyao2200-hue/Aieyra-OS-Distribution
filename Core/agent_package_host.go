// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ensurePackageAgentHost
// Impact: python -B scripts/code-atlas.py show Core/agent_package_host.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// Standard Agent instances share the existing task executor and its kernel
// ownership lock. This host has no primary Workspace and therefore inherits no
// private Eyra prompt, PAC or implicit workspace role.
func (m *AgentManager) ensurePackageAgentHost(required bool) (*AgentManager, error) {
	if service := m.packageHost.Load(); service != nil {
		return service, nil
	}
	if m.workspace == nil || !m.workspace.Mode().unified() || m.workspace.split != nil {
		return nil, nil
	}
	m.packageInitMu.Lock()
	defer m.packageInitMu.Unlock()
	if service := m.packageHost.Load(); service != nil {
		return service, nil
	}
	if m.ctx.Err() != nil {
		return nil, fmt.Errorf("Agent host is closed")
	}
	if m.admissionFrozen() {
		return nil, fmt.Errorf("更新交接中，Agent服务暂不新建")
	}
	dir := filepath.Join(PrivatePaths(m.config).Agents, "runtime")
	if !required {
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			return nil, nil
		} else if err != nil {
			return nil, err
		}
	}
	service, err := newAgentManager(m.config, workflowHash("aieyra.package-agents/1")[:32], m.service, dir)
	if err != nil {
		return nil, fmt.Errorf("Agent service is unavailable; existing ownership and records are retained: %w", err)
	}
	service.packageService = true
	if m.workspace.host != nil {
		service.linkContacts = m.workspace.host.conversationManager
	}
	service.packageWorkbox = func() (*AgentManager, error) { return m.ensureWorkboxHost(true) }
	service.taskProjection = m.workspace
	if m.workspace.Mode() == HostOS && !m.workspace.isTerminal() {
		service.packageProgram = func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
			return m.service.CallTool(ctx, "desktop", m.workspace.state.ID, raw)
		}
	}
	service.taskWindow = func(string, string) error { return nil }
	service.taskWindowHide = func(string) error { return nil }
	service.recoverLinkReceipts()
	m.packageHost.Store(service)
	return service, nil
}
