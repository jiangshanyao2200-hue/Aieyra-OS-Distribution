// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/protocol/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Message; ReasoningPart; PublicReasoning; ToolCall; FunctionCall; Usage; usageWire; UnmarshalJSON; MarshalJSON; CachedTokens; ImageAttachment; ToolDefinition; WorkspaceEvent; WorkspaceCursor; WorkspaceGreeting; WorkspaceDocument; ToolPresentation; ToolPresentationColumn; WorkspaceLive; WorkspaceStreamPart; WorkspaceReasoning; String; RPCRequest
// Impact: python -B scripts/code-atlas.py show Contracts/protocol/types.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package protocol defines shared, transport-neutral data contracts.
package protocol

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Model wire protocols shared by settings, request encoders and transports.
const (
	ProtocolResponses = "responses"
	ProtocolChat      = "chat_completions"
	ProtocolMessages  = "anthropic_messages"
	ProtocolGoogle    = "google_generate"
)

// Message carries a conversation message and its provider continuation data.
type Message struct {
	Role         string `json:"role"`
	FinishReason string `json:"-"`
	// ContextObservation is host provenance, restored from a typed archive
	// event. It is neither a user turn nor a provider wire field.
	ContextObservation bool `json:"-"`
	// 图片资产与正文分开保存，只在构造已验证协议的请求时编码。
	Content string            `json:"content,omitempty"`
	Images  []ImageAttachment `json:"image_attachments,omitempty"`
	// ReasoningContent 仅思考模式返回。携带 tools 时必须回传，否则官方返回 400。
	ReasoningContent string          `json:"reasoning_content,omitempty"`
	ReasoningDetails json.RawMessage `json:"reasoning_details,omitempty"`
	NativeContent    json.RawMessage `json:"native_content,omitempty"`
	RouterReasoning  string          `json:"reasoning,omitempty"`
	ToolCalls        []ToolCall      `json:"tool_calls,omitempty"`
	// Incomplete calls are audit data only and never enter an executable turn.
	IncompleteTools []ToolCall        `json:"incomplete_tool_calls,omitempty"`
	ToolCallID      string            `json:"tool_call_id,omitempty"`
	Name            string            `json:"name,omitempty"`
	ResponseItems   []json.RawMessage `json:"response_items,omitempty"`
	ResponseID      string            `json:"response_id,omitempty"`
	Provider        string            `json:"provider_identity,omitempty"`
}

// ReasoningPart is a view of public provider text, never opaque continuation
// data. Kind is text, summary, or unknown for older unclassified archives.
type ReasoningPart struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
}

// PublicReasoning recovers the provider's categories and ordering from the
// already-persisted Responses items without adding another message payload.
// If old/partial data cannot account for the flattened text, preserve that
// original text with an unknown category instead of guessing its provenance.
func (m Message) PublicReasoning() []ReasoningPart {
	var parts []ReasoningPart
	var text strings.Builder
	valid := true
	for _, raw := range m.ResponseItems {
		var item struct {
			Type    string `json:"type"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
			Summary []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"summary"`
		}
		if json.Unmarshal(raw, &item) != nil {
			valid = false
			break
		}
		if item.Type != "reasoning" && item.Type != "message" {
			continue
		}
		for _, p := range item.Content {
			if p.Type == "reasoning_text" && p.Text != "" {
				parts = append(parts, ReasoningPart{Kind: "text", Text: p.Text})
				text.WriteString(p.Text)
			}
		}
		if item.Type == "reasoning" {
			for _, p := range item.Summary {
				if p.Type == "summary_text" && p.Text != "" {
					parts = append(parts, ReasoningPart{Kind: "summary", Text: p.Text})
					text.WriteString(p.Text)
				}
			}
		}
	}
	if valid && len(parts) > 0 && (m.ReasoningContent == "" || text.String() == m.ReasoningContent) {
		return parts
	}
	if m.ReasoningContent != "" {
		return []ReasoningPart{{Kind: "unknown", Text: m.ReasoningContent}}
	}
	return nil
}

// ToolCall identifies one requested function invocation.
type ToolCall struct {
	Index    *int         `json:"index,omitempty"`
	ID       string       `json:"id,omitempty"`
	Type     string       `json:"type,omitempty"`
	Function FunctionCall `json:"function"`
	// 供应商附带的不透明数据（Gemini 的 thought_signature），同一供应商续写时原样带回。
	ExtraContent json.RawMessage `json:"extra_content,omitempty"`
}

// FunctionCall contains the function name and its JSON arguments.
type FunctionCall struct {
	Name      string `json:"name,omitempty"`
	Arguments string `json:"arguments,omitempty"`
}

// Usage preserves reported token and cache counters; clients format their views.
// 缓存与思考计数只在供应商真的给了对应字段时才算“已报告”（显式 0 也算）；缺字段、
// details 为 {} 都是未知，不能被当成 0 命中。经 worker JSON 往返后这一区别也不能丢。
type Usage struct {
	PromptTokens          int `json:"prompt_tokens"`
	CompletionTokens      int `json:"completion_tokens"`
	TotalTokens           int `json:"total_tokens"`
	PromptCacheHitTokens  int `json:"prompt_cache_hit_tokens"`
	PromptCacheMissTokens int `json:"prompt_cache_miss_tokens"`
	// CacheHitKnown：顶层 prompt_cache_hit_tokens（DeepSeek）或原生协议的缓存读数确实出现过。
	CacheHitKnown       bool `json:"-"`
	CacheMissKnown      bool `json:"-"`
	PromptTokensDetails *struct {
		CachedTokens int `json:"cached_tokens"`
	} `json:"prompt_tokens_details,omitempty"`
	CompletionTokensDetails *struct {
		ReasoningTokens int `json:"reasoning_tokens"`
	} `json:"completion_tokens_details,omitempty"`
}

type usageWire struct {
	PromptTokens          int  `json:"prompt_tokens"`
	CompletionTokens      int  `json:"completion_tokens"`
	TotalTokens           int  `json:"total_tokens"`
	PromptCacheHitTokens  *int `json:"prompt_cache_hit_tokens,omitempty"`
	PromptCacheMissTokens *int `json:"prompt_cache_miss_tokens,omitempty"`
	PromptTokensDetails   *struct {
		CachedTokens *int `json:"cached_tokens,omitempty"`
	} `json:"prompt_tokens_details,omitempty"`
	CompletionTokensDetails *struct {
		ReasoningTokens *int `json:"reasoning_tokens,omitempty"`
	} `json:"completion_tokens_details,omitempty"`
}

func (u *Usage) UnmarshalJSON(data []byte) error {
	var w usageWire
	if err := json.Unmarshal(data, &w); err != nil {
		return err
	}
	*u = Usage{PromptTokens: w.PromptTokens, CompletionTokens: w.CompletionTokens, TotalTokens: w.TotalTokens}
	if w.PromptCacheHitTokens != nil {
		u.PromptCacheHitTokens, u.CacheHitKnown = *w.PromptCacheHitTokens, true
	}
	if w.PromptCacheMissTokens != nil {
		u.PromptCacheMissTokens, u.CacheMissKnown = *w.PromptCacheMissTokens, true
	}
	if d := w.PromptTokensDetails; d != nil && d.CachedTokens != nil {
		u.PromptTokensDetails = &struct {
			CachedTokens int `json:"cached_tokens"`
		}{*d.CachedTokens}
	}
	if d := w.CompletionTokensDetails; d != nil && d.ReasoningTokens != nil {
		u.CompletionTokensDetails = &struct {
			ReasoningTokens int `json:"reasoning_tokens"`
		}{*d.ReasoningTokens}
	}
	return nil
}

// MarshalJSON 只写出已报告的缓存字段，未知的不会在下一次解析时变成“报告了 0”。
func (u Usage) MarshalJSON() ([]byte, error) {
	w := usageWire{PromptTokens: u.PromptTokens, CompletionTokens: u.CompletionTokens, TotalTokens: u.TotalTokens}
	if u.CacheHitKnown || u.PromptCacheHitTokens > 0 {
		hit := u.PromptCacheHitTokens
		w.PromptCacheHitTokens = &hit
	}
	if u.CacheMissKnown || u.PromptCacheMissTokens > 0 {
		miss := u.PromptCacheMissTokens
		w.PromptCacheMissTokens = &miss
	}
	if d := u.PromptTokensDetails; d != nil {
		cached := d.CachedTokens
		w.PromptTokensDetails = &struct {
			CachedTokens *int `json:"cached_tokens,omitempty"`
		}{&cached}
	}
	if d := u.CompletionTokensDetails; d != nil {
		reasoning := d.ReasoningTokens
		w.CompletionTokensDetails = &struct {
			ReasoningTokens *int `json:"reasoning_tokens,omitempty"`
		}{&reasoning}
	}
	return json.Marshal(w)
}

// CachedTokens 返回已报告的缓存命中数；ok=false 表示供应商没有报告缓存（不是 0 命中）。
func (u Usage) CachedTokens() (int, bool) {
	if u.PromptTokensDetails != nil {
		return u.PromptTokensDetails.CachedTokens, true
	}
	return u.PromptCacheHitTokens, u.CacheHitKnown || u.PromptCacheHitTokens > 0
}

type ImageAttachment struct {
	// The user's name for the attachment; the model sees it beside the image.
	Name string `json:"name,omitempty"`
	// Its stable 图N label from the composer; older messages number by position.
	Label  string `json:"label,omitempty"`
	Asset  string `json:"asset"`
	SHA256 string `json:"sha256"`
	MIME   string `json:"mime"`
	Detail string `json:"detail"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Bytes  int    `json:"bytes"`
}

type ToolDefinition struct {
	Type        string `json:"type"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Parameters  any    `json:"parameters"`
	Strict      bool   `json:"strict"`
}

// WorkspaceEvent is a presentation envelope, never a model protocol message.
type WorkspaceEvent struct {
	Cursor uint64 `json:"cursor"`
	At     string `json:"at"`
	Role   string `json:"role"`
	Kind   string `json:"kind"`
	Data   any    `json:"data,omitempty"`
}

type WorkspaceCursor struct {
	Revision uint64            `json:"revision"`
	Activity map[string]int64  `json:"activity_cursors"`
	Live     map[string]uint64 `json:"live_cursors"`
}

type WorkspaceGreeting struct {
	State           string `json:"state"`
	Phase           string `json:"phase,omitempty"`
	AfterGeneration int    `json:"after_generation"`
	AfterMessageID  string `json:"after_message_id"`
	Text            string `json:"text"`
	Resumed         bool   `json:"resumed,omitempty"`
	Error           string `json:"error,omitempty"`
	Detail          string `json:"detail,omitempty"`
	Revision        uint64 `json:"revision"`
	Usage           *Usage `json:"usage,omitempty"`
}

type WorkspaceDocument struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Format    string `json:"format"`
	At        string `json:"at"`
	Pinned    bool   `json:"pinned,omitempty"`
	Dismissed bool   `json:"dismissed,omitempty"`
	Read      bool   `json:"read,omitempty"`
	Kind      string `json:"kind,omitempty"`
	Revision  uint64 `json:"revision,omitempty"`
}

type ToolPresentation struct {
	Kind    string                   `json:"kind"`
	Title   string                   `json:"title,omitempty"`
	Columns []ToolPresentationColumn `json:"columns,omitempty"`
}

type ToolPresentationColumn struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

type WorkspaceLive struct {
	AgentID            string                `json:"agent_id,omitempty"`
	Generation         int                   `json:"generation,omitempty"`
	TurnID             string                `json:"turn_id,omitempty"`
	BodyID             string                `json:"body_id"`
	BodyAt             int64                 `json:"body_at,omitempty"`
	BodyUpdatedAt      int64                 `json:"body_updated_at,omitempty"`
	Phase              string                `json:"phase"`
	Text               string                `json:"text"`
	Thought            string                `json:"thought"`
	ThoughtKind        string                `json:"thought_kind,omitempty"`
	ThoughtAt          int64                 `json:"thought_at,omitempty"`
	ReasoningStartedAt int64                 `json:"reasoning_started_at,omitempty"`
	ReasoningHistory   []WorkspaceReasoning  `json:"reasoning_history,omitempty"`
	ReasoningSeen      bool                  `json:"reasoning_seen"`
	Revision           uint64                `json:"revision"`
	HideThought        bool                  `json:"-"`
	StreamOutputIndex  int                   `json:"-"`
	StreamOutputSeen   bool                  `json:"-"`
	StreamBodyParts    []WorkspaceStreamPart `json:"-"`
	StreamThoughtParts []WorkspaceStreamPart `json:"-"`
	NewBody            bool                  `json:"new_body"`
}

// Internal display contributions. Copy on write keeps published snapshots immutable.
// Only public provider text is kept here; these fields never enter the UI protocol.
type WorkspaceStreamPart struct {
	OutputIndex  int
	ContentIndex int
	Text         string
}

// Local arrival boundaries, never a reconstruction of hidden model reasoning.
// Millisecond timestamps are comparable with other UI receipts after conversion.
type WorkspaceReasoning struct {
	ID         string `json:"id"`
	StartedAt  int64  `json:"started_at"`
	FinishedAt int64  `json:"finished_at"`
}

func (u Usage) String() string {
	if u.TotalTokens == 0 {
		return ""
	}
	s := fmt.Sprintf("tokens %d（输入 %d / 输出 %d）", u.TotalTokens, u.PromptTokens, u.CompletionTokens)
	if u.PromptCacheHitTokens > 0 {
		s += fmt.Sprintf(" · 缓存命中 %d", u.PromptCacheHitTokens)
	}
	if u.CompletionTokensDetails != nil && u.CompletionTokensDetails.ReasoningTokens > 0 {
		s += fmt.Sprintf(" · 思考 %d", u.CompletionTokensDetails.ReasoningTokens)
	}
	return s
}

type RPCRequest struct {
	Action    string          `json:"action"`
	Arguments json.RawMessage `json:"arguments"`
}
