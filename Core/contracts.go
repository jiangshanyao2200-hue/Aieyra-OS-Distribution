// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Message; ToolCall; FunctionCall; Usage; ImageAttachment; ToolDefinition; WorkspaceEvent; WorkspaceCursor; WorkspaceGreeting; WorkspaceDocument; ToolPresentation; ToolPresentationColumn; WorkspaceLive; AgentUsage; AgentRequestTiming
// Impact: python -B scripts/code-atlas.py show Core/contracts.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "github.com/aieyra/aieyra-os/contracts/protocol"

// Public aliases keep callers source-compatible; protocol owns these definitions.
type Message = protocol.Message
type ToolCall = protocol.ToolCall
type FunctionCall = protocol.FunctionCall
type Usage = protocol.Usage
type ImageAttachment = protocol.ImageAttachment
type ToolDefinition = protocol.ToolDefinition
type WorkspaceEvent = protocol.WorkspaceEvent
type WorkspaceCursor = protocol.WorkspaceCursor
type WorkspaceGreeting = protocol.WorkspaceGreeting
type WorkspaceDocument = protocol.WorkspaceDocument
type ToolPresentation = protocol.ToolPresentation
type ToolPresentationColumn = protocol.ToolPresentationColumn
type WorkspaceLive = protocol.WorkspaceLive

type AgentUsage = protocol.AgentUsage
type AgentRequestTiming = protocol.AgentRequestTiming
