// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/protocol/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: RetryInfo; EventKind; Event
// Impact: python -B scripts/code-atlas.py show Contracts/protocol/model.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package protocol

// 对话角色。
const (
	RoleSystem    = "system"
	RoleUser      = "user"
	RoleAssistant = "assistant"
	RoleTool      = "tool"
)

// RetryInfo 只记录恢复所需的元数据，不含供应商正文、请求头或凭据。
type RetryInfo struct {
	OutputBytes int    `json:"output_bytes"`
	Attempt     int    `json:"attempt"`
	MaxAttempts int    `json:"max_attempts"`
	DelayMS     int64  `json:"delay_ms"`
	Category    string `json:"category"`
	Partial     bool   `json:"partial"`
	Usage       *Usage `json:"usage,omitempty"`
}

// 流式事件类型。
type EventKind int

const (
	EventDelta     EventKind = iota // 正文增量
	EventReasoning                  // 思考链增量
	EventUsage                      // 用量统计
	EventFinish                     // 带上了 finish_reason
	EventDone                       // 正常结束（收到 [DONE]）
	EventError                      // 出错（致命，调用方应中止并返回非零退出码）
	EventWarn                       // 警告（非致命：部分分片损坏但内容可用，调用方应提示但退出码为 0）
)

const (
	EventResponse       EventKind = 8  // 完整且经核对的 Responses 响应
	EventToolPreparing  EventKind = 9  // 工具参数尚在接收，不能执行
	EventReasoningDone  EventKind = 10 // 真实思考片段结束；不等待整个响应关闭
	EventBodyPreparing  EventKind = 11 // 正文已到达；即使等待更早正文排序，也立即结束思考展示
	EventRetry          EventKind = 12 // 下一次请求将从头开始，未提交片段须隔离
	EventTextCorrection EventKind = 14 // 替换已显示的正文/公开思考片段；不是增量。
	EventReasoningStart EventKind = 13 // 上游已开始思考项；不代表存在可公开的文字
)

// Event 是流式过程中的一个事件。
type Event struct {
	Retry          *RetryInfo
	Kind           EventKind
	Text           string
	ReasoningKind  string    // text 或 summary；供应商未提供的私有思考不能推断。
	OutputIndex    *int      // Responses 的输出项顺序；nil 表示供应商没有提供此依据。
	ContentIndex   *int      // Responses 片段标识；摘要使用 2048+summary_index。
	CorrectionKind EventKind // EventTextCorrection 的目标：EventDelta 或 EventReasoning。
	Usage          *Usage
	Err            error
	Finish         string
	Message        *Message
}
