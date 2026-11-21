// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: packageManagementActorLocked; packageManagementPermission; packageFixedRoleEnabled
// Impact: python -B scripts/code-atlas.py show Core/agent_package_management.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"
	"slices"

	tool "github.com/aieyra/aieyra-os/tool/contract"
)

// The caller is supplied by the existing agents dispatcher, never by JSON.
// Definition management is limited to direct, explicitly supervised members.
func (m *AgentManager) packageManagementActorLocked(actor string) error {
	if actor == "primary" {
		return nil
	}
	j := m.jobs[actor]
	if j == nil || j.record.Instance == nil || j.record.Instance.Disabled || !activeAgent(j.record.State) || !slices.Contains(j.record.Spec.Tools, "agents") {
		return fmt.Errorf("active assigned supervisor with agents capability required")
	}
	return nil
}

func (m *AgentManager) packageManagementPermission(ctx context.Context, actor string) error {
	if !toolAllowed(ctx, "agents") {
		return fmt.Errorf("agents capability required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.packageManagementActorLocked(actor)
}

// A model must not work around a disabled fixed role by cloning its package.
// User-created independent instances remain separate from fixed-role settings.
func (m *AgentManager) packageFixedRoleEnabled(identity string) error {
	id, _, _ := tool.ParsePackageID(identity)
	role := map[string]string{"aieyra.vaya": WorkspaceProject, "aieyra.cota": WorkspaceExecution}[id]
	if role != "" && (m.taskProjection == nil || !m.taskProjection.teamRoleOn(role)) {
		return fmt.Errorf("fixed role is disabled; only the user can enable it")
	}
	return nil
}
