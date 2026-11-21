// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/protocol/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: AgentUsage; AgentRequestTiming
// Impact: python -B scripts/code-atlas.py show Contracts/protocol/accounting.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package protocol

type AgentUsage struct {
	Model        string              `json:"model,omitempty"`
	OutputLimit  int                 `json:"output_limit,omitempty"`
	FinishReason string              `json:"finish_reason,omitempty"`
	SourceID     string              `json:"source_id,omitempty"`
	Kind         string              `json:"kind"`
	At           string              `json:"at,omitempty"`   // 请求完成时间（UTC），供本地请求记录
	Host         string              `json:"host,omitempty"` // 实际线路主机，不含路径与凭据
	Reported     bool                `json:"usage_reported"`
	Estimated    bool                `json:"usage_estimated,omitempty"`
	Request      int                 `json:"request"`
	Input        int                 `json:"input_tokens"`
	Output       int                 `json:"output_tokens"`
	Cached       *int                `json:"cached_tokens"`
	Reasoning    *int                `json:"reasoning_tokens"`
	DurationMS   int64               `json:"duration_ms"`
	Timing       *AgentRequestTiming `json:"timing,omitempty"`
}

type AgentRequestTiming struct {
	QueueMS      int64  `json:"queue_ms"`
	PrepareMS    int64  `json:"prepare_ms"`
	ConnectionMS *int64 `json:"connection_ms,omitempty"`
	FirstByteMS  *int64 `json:"first_byte_ms,omitempty"`
	FirstEventMS *int64 `json:"first_event_ms,omitempty"`
	ReasoningMS  *int64 `json:"reasoning_ms,omitempty"`
	TextMS       *int64 `json:"text_ms,omitempty"`
}
