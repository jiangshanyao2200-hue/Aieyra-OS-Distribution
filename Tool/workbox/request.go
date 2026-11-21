// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/workbox/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: Request; DecodeRequest; RequestSchema; CommandManual
// Impact: python -B scripts/code-atlas.py show Tool/workbox/request.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package workbox

import "encoding/json"

// Request is shared by direct clients and the on-demand Toolbox entry. Input
// is validated by the imported workflow, commands by the host's revision gate.
type Request struct {
	Action           string         `json:"action"`
	ID               string         `json:"id,omitempty"`
	RequestID        string         `json:"request_id,omitempty"`
	ExpectedRevision *uint64        `json:"expected_revision,omitempty"`
	Input            map[string]any `json:"input,omitempty"`
	Step             string         `json:"step,omitempty"`
	ModelID          string         `json:"model_id,omitempty"`
	Workdir          string         `json:"workdir,omitempty"`
}

func DecodeRequest(raw []byte) (Request, error) { var r Request; err := strict(raw, &r); return r, err }
func RequestSchema() map[string]any {
	var schema map[string]any
	_ = json.Unmarshal([]byte(`{"type":"object","properties":{"action":{"type":"string","enum":["create","status","run","pause","resume","cancel","approve","recover","create_agent"]},"id":{"type":"string"},"request_id":{"type":"string"},"expected_revision":{"type":"integer"},"input":{"type":"object"},"step":{"type":"string"},"model_id":{"type":"string"},"workdir":{"type":"string"}},"required":["action"],"additionalProperties":false}`), &schema)
	return schema
}

const CommandManual = `Workflow commands: create with input, absolute workdir and request_id; status with id.
All mutations of an existing instance require id, a unique request_id and expected_revision from its latest status. Retrying the same request_id never reapplies a command.
run/resume starts the saved plan until completion or a review/pause boundary. pause stops at the next boundary; cancel stops owned execution and retains receipts. approve requires the exact awaiting-review step. recover only inspects previous receipts and repairs saved image responses; it never replays a tool. Use run after a successful recovery.
create_agent requires the template, model_id and the parent's agents permission; it creates a separate specialist with the workflow's intersected capabilities and budget.
For agentTemplate.package it links one idle standard Agent instance; send through the Agent service to start it. The private workflow port is restricted to this instance and excludes approval or further specialist creation. Legacy inline templates retain their immediate-start behavior.
Updated/disabled packages cannot start new steps. status/cancel/recover remain available for existing instances. Unknown results require inspection, never a fresh create or repeat generation. Inspect state, step receipts and outputs; completion is not inferred from accepted commands.`
