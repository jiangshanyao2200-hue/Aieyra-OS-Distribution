// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/request/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Message; ToolCall; ToolDefinition; ChatToolDefinition; Profile
// Impact: python -B scripts/code-atlas.py show API/request/profile.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package request encodes immutable model options and prepared assets into
// provider requests. It does not load private settings or read attachment files.
package request

import (
	"github.com/aieyra/aieyra-os/api/codec"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

type Message = protocol.Message
type ToolCall = protocol.ToolCall
type ToolDefinition = protocol.ToolDefinition
type ChatToolDefinition = codec.ChatToolDefinition

const (
	RoleSystem        = protocol.RoleSystem
	RoleUser          = protocol.RoleUser
	RoleAssistant     = protocol.RoleAssistant
	RoleTool          = protocol.RoleTool
	ProtocolResponses = protocol.ProtocolResponses
	ProtocolChat      = protocol.ProtocolChat
	ProtocolMessages  = protocol.ProtocolMessages
	ProtocolGoogle    = protocol.ProtocolGoogle
)

// Profile supplies already validated vendor options. Builders detach Extra;
// callers must not mutate inputs concurrently with request construction.
type Profile struct {
	Model, Protocol, Provider, ReasoningField     string
	Generic, OpenCode, OpenRouter                 bool
	TextOnly                                      bool
	MaxTokens, OutputLimit                        int
	ThinkingType, ReasoningEffort                 string
	ThinkingEnabled, IncludeUsage, SupportsImages bool
	ResponseFormat, UserID, UnsupportedImageText  string
	Extra                                         map[string]any
}
