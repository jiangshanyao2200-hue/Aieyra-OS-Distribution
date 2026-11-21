// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/contract/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: InstanceDefinition; Instance; WorkflowBinding
// Impact: python -B scripts/code-atlas.py show Agent/contract/instance.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

// InstanceDefinition is a pinned public package snapshot. Private prompt
// overrides, team membership and migration receipts belong to the instance.
type InstanceDefinition struct {
	Package      string            `json:"package"`
	Team         *Team             `json:"team,omitempty"`
	Definition   Definition        `json:"definition"`
	Prompt       string            `json:"prompt"`
	Dependencies map[string]string `json:"dependencies"`
	AllowedTools []string          `json:"allowed_tools"`
	Tools        []string          `json:"tools"`
}

type Instance struct {
	Workflow            *WorkflowBinding    `json:"workflow,omitempty"`
	CreationRequestHash string              `json:"creation_request_hash,omitempty"`
	Schema              int                 `json:"schema"`
	Revision            int                 `json:"revision"`
	Current             InstanceDefinition  `json:"current"`
	Previous            *InstanceDefinition `json:"previous,omitempty"`
	Prompt              *string             `json:"prompt_override,omitempty"`
	Tools               *[]string           `json:"tools_override,omitempty"`
	Disabled            bool                `json:"disabled,omitempty"`
	TeamRole            string              `json:"team_role,omitempty"`
	Supervisor          string              `json:"supervisor,omitempty"`
	Requests            map[string]string   `json:"requests"`
}

// WorkflowBinding is a private host-created capability. A package may declare
// the port, but cannot choose an owner's workflow or export this binding.
type WorkflowBinding struct {
	ID           string `json:"id"`
	Owner        string `json:"owner"`
	Package      string `json:"package"`
	AgentPackage string `json:"agent_package"`
	Retention    string `json:"retention"`
}
