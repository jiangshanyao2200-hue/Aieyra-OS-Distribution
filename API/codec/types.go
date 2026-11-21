// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/codec/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Message; ToolCall; FunctionCall; Usage; ToolDefinition; Event; EventKind; rawJSON
// Impact: python -B scripts/code-atlas.py show API/codec/types.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package codec converts provider bytes to shared messages and events.
// Partial tools remain non-executable until a complete validated response.
package codec

import (
	"encoding/json"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

type Message = protocol.Message
type ToolCall = protocol.ToolCall
type FunctionCall = protocol.FunctionCall
type Usage = protocol.Usage
type ToolDefinition = protocol.ToolDefinition
type Event = protocol.Event
type EventKind = protocol.EventKind

const (
	RoleSystem          = protocol.RoleSystem
	RoleUser            = protocol.RoleUser
	RoleAssistant       = protocol.RoleAssistant
	RoleTool            = protocol.RoleTool
	EventDelta          = protocol.EventDelta
	EventReasoning      = protocol.EventReasoning
	EventUsage          = protocol.EventUsage
	EventFinish         = protocol.EventFinish
	EventDone           = protocol.EventDone
	EventError          = protocol.EventError
	EventWarn           = protocol.EventWarn
	EventResponse       = protocol.EventResponse
	EventToolPreparing  = protocol.EventToolPreparing
	EventReasoningDone  = protocol.EventReasoningDone
	EventBodyPreparing  = protocol.EventBodyPreparing
	EventRetry          = protocol.EventRetry
	EventTextCorrection = protocol.EventTextCorrection
	EventReasoningStart = protocol.EventReasoningStart
)

func rawJSON(v any) json.RawMessage { b, _ := json.Marshal(v); return b }
