// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/protocol/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TerminalSession; TerminalOptions; TerminalSettingsVersion; TerminalSettingsRequest; TerminalSettingsResponse; TerminalAPIRequest; TerminalAPIConnection; TerminalAPIModel; TerminalAPIState; TerminalRunner
// Impact: python -B scripts/code-atlas.py show Contracts/protocol/terminal.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package protocol

import (
	"context"
	"encoding/json"
	"io"
)

// TerminalSession is a capability supplied by the CLI host. The presentation
// owns neither credentials nor an executor; every operation uses the same core.
type TerminalSession struct {
	ID   string
	Call func(context.Context, string, any, any) error
}

type TerminalOptions struct {
	Session      TerminalSession
	Open         func(context.Context, string) (TerminalSession, error)
	Input        io.Reader
	Output       io.Writer
	Version      string
	Control      bool
	SettingsOnly bool
	API          func(context.Context, string, TerminalAPIRequest) (TerminalAPIState, error)
	Settings     func(context.Context, TerminalSettingsRequest) (TerminalSettingsResponse, error)
}

// TerminalSettingsVersion versions the transport, not the settings schema.
const TerminalSettingsVersion = 1

// Settings operations and results belong to the shared settings service. The
// terminal transport deliberately adds no model, credential or editing rules.
type TerminalSettingsRequest struct {
	Version   int             `json:"version"`
	Action    string          `json:"action"`
	Arguments json.RawMessage `json:"arguments"`
}

type TerminalSettingsResponse struct {
	Version int             `json:"version"`
	Result  json.RawMessage `json:"result"`
}

// Native settings capability: secrets are accepted as a draft, never returned.
type TerminalAPIRequest struct {
	Revision, ConnectionID, Provider, BaseURL, Key, Model, Protocol, Verified string
	ModelName, ContextSource                                                  string
	ContextWindow                                                             int
}
type TerminalAPIConnection struct {
	ID, Provider, BaseURL string
	HasKey                bool
}
type TerminalAPIModel struct {
	ID, Name, Protocol string
	ContextWindow      int
	ContextSource      string
}
type TerminalAPIState struct {
	Revision, Path, ConnectionID, Provider, BaseURL, Model, Protocol, Verified string
	ModelName, ContextSource                                                   string
	ContextWindow                                                              int
	HasKey                                                                     bool
	Connections                                                                []TerminalAPIConnection
	Models                                                                     []TerminalAPIModel
}

// A renderer returns handled=false when its input/output is not a terminal.
type TerminalRunner func(context.Context, TerminalOptions) (handled bool, err error)
