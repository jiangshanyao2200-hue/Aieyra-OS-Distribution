// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/contract/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: AgentSpec
// Impact: python -B scripts/code-atlas.py show Agent/contract/task.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

import (
	"encoding/json"
	contextport "github.com/aieyra/aieyra-os/contracts/context"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

type AgentSpec struct {
	AgentPackage      string                        `json:"agent_package,omitempty"`
	WorkflowID        string                        `json:"workflow_id,omitempty"`
	WorkflowPackage   string                        `json:"workflow_package,omitempty"`
	WorkflowRetention string                        `json:"workflow_retention,omitempty"`
	ContextProvider   *contextport.Reference        `json:"context_provider,omitempty"`
	Kind              string                        `json:"kind,omitempty"`
	ProfileID         string                        `json:"profile_id,omitempty"`
	GroupID           string                        `json:"group_id,omitempty"`
	Attachments       []protocol.ComposerAttachment `json:"attachments,omitempty"`
	WorkspaceRole     string                        `json:"workspace_role,omitempty"`
	RequestID         string                        `json:"request_id"`
	ModelID           string                        `json:"model_id"`
	Task              string                        `json:"task"`
	Prompt            string                        `json:"prompt"`
	Workdir           string                        `json:"workdir"`
	Tools             []string                      `json:"tools"`
	Title             string                        `json:"title,omitempty"`
	MaxRequests       int                           `json:"max_requests"` // Legacy compatibility; request counts never stop a task.
	TimeoutSeconds    int                           `json:"timeout_seconds"`
	MaxTokens         int                           `json:"max_tokens"`
	Contract          *AgentContract                `json:"contract,omitempty"`
	// A conversation agent's own thinking choice, laid over its model's pool parameters.
	ModelParameters json.RawMessage `json:"model_parameters,omitempty"`
}
