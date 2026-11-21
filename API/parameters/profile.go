// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/parameters/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Spec; Rule; Profile
// Impact: python -B scripts/code-atlas.py show API/parameters/profile.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package parameters maps validated model options to provider fields without
// accessing application settings, catalog files, or private credentials.
package parameters

import "github.com/aieyra/aieyra-os/contracts/protocol"

type Spec struct {
	WirePath []string `json:"wire_path,omitempty"`
	Source   string   `json:"source,omitempty"`
	Key      string   `json:"key"`
	Type     string   `json:"type"`
	Min      float64  `json:"min,omitempty"`
	Max      float64  `json:"max,omitempty"`
	Values   []string `json:"values,omitempty"`
}

type Rule struct {
	Protocol       string         `json:"protocol"`
	ParameterSpecs []Spec         `json:"parameter_specs"`
	Defaults       map[string]any `json:"defaults"`
	AlwaysThinking bool           `json:"always_thinking"`
	StreamOnly     bool           `json:"stream_only"`
	IgnoreBudget   bool           `json:"ignore_budget"`
	Verification   string         `json:"verification,omitempty"`
}

// Profile is a host snapshot. The host selects the reviewed rule and validates
// descriptor provenance; this package validates values and encodes the fields.
type Profile struct {
	Protocol, Adapter, NativeProvider, ResponseFormat, ReasoningEffort string
	Generic, OpenCode, OpenRouter, Legacy, Reasoning, ThinkingEnabled  bool
	Options                                                            map[string]any
	Specs                                                              []Spec
	Rule                                                               *Rule
}

const (
	ProtocolChat      = protocol.ProtocolChat
	ProtocolResponses = protocol.ProtocolResponses
	ProtocolGoogle    = protocol.ProtocolGoogle
	ProtocolMessages  = protocol.ProtocolMessages
)
