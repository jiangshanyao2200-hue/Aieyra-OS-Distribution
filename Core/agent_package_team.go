// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: validatePackageTeamLocked; validatePackageTeamIdentityLocked
// Impact: python -B scripts/code-atlas.py show Core/agent_package_team.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"fmt"
	"strings"

	tool "github.com/aieyra/aieyra-os/tool/contract"
)

// A declared role binds an actual instance of the declared dependency. Ad hoc
// teams use an explicit role, with the same ownership and cycle checks.
func (m *AgentManager) validatePackageTeamLocked(id, supervisor, role string) error {
	return m.validatePackageTeamIdentityLocked(id, m.jobs[id].record.Spec.AgentPackage, supervisor, role)
}

func (m *AgentManager) validatePackageTeamIdentityLocked(id, identity, supervisor, role string) error {
	if supervisor == "" {
		if role != "" {
			return fmt.Errorf("an unassigned instance cannot retain a team role")
		}
		return nil
	}
	if strings.TrimSpace(role) == "" || len(role) > 96 {
		return fmt.Errorf("an explicit team role is required")
	}
	for other, j := range m.jobs {
		if other != id && j.record.Instance != nil && j.record.Instance.Supervisor == supervisor && j.record.Instance.TeamRole == role {
			return fmt.Errorf("team role is already assigned; detach the prior member first")
		}
	}
	if supervisor == "primary" {
		return nil
	}
	p := m.jobs[supervisor]
	if p == nil || p.record.Instance == nil {
		return fmt.Errorf("supervisor instance is unavailable")
	}
	team := p.record.Instance.Current.Team
	if team == nil {
		return nil
	}
	member, _, _ := tool.ParsePackageID(identity)
	for _, row := range team.Members {
		if row.Role == role && row.Agent == member {
			_, digest, _ := tool.ParsePackageID(identity)
			if p.record.Instance.Current.Dependencies[member] != digest {
				return fmt.Errorf("member version differs from the supervisor's declared dependency")
			}
			return nil
		}
	}
	return fmt.Errorf("member identity or role is outside the declared team")
}
