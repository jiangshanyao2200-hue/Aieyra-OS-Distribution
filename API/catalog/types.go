// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/catalog/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Entry; ReasoningOption; Profile; Catalog; Parse; Count; rawJSON; detached; NativeModel; LookupProfile; Capacity; Rule
// Impact: python -B scripts/code-atlas.py show API/catalog/types.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package catalog queries model references supplied by the host. It has no
// filesystem, credential, network or application-configuration dependencies.
package catalog

import (
	"encoding/json"
	"github.com/aieyra/aieyra-os/api/parameters"
)

type Entry struct {
	Kind               string            `json:"kind,omitempty"`
	TextOnly           bool              `json:"text_only,omitempty"`
	Provider           string            `json:"provider"`
	ID                 string            `json:"id"`
	Family             string            `json:"family"`
	Tier               string            `json:"tier"`
	Rank               int               `json:"rank"`
	Summary            string            `json:"summary_zh"`
	Protocols          []string          `json:"protocols"`
	ContextWindow      int               `json:"context_window"`
	MaxOutput          int               `json:"max_output"`
	MaxInput           int               `json:"max_input,omitempty"`
	Reasoning          bool              `json:"reasoning,omitempty"`
	ReasoningOptions   []ReasoningOption `json:"reasoning_options,omitempty"`
	ToolCalls          *bool             `json:"tool_calls"`
	Vision             *bool             `json:"vision"`
	RecommendedContext int               `json:"recommended_context_window"`
	RecommendedOutput  int               `json:"recommended_output_tokens"`
	RecommendedCompact *int              `json:"recommended_compact_at_tokens"`
	Rules              []parameters.Rule `json:"rules"`
	Availability       json.RawMessage   `json:"availability,omitempty"`
	Activation         json.RawMessage   `json:"activation,omitempty"`
}

type ReasoningOption struct {
	Type   string   `json:"type"`
	Values []string `json:"values,omitempty"`
	Min    int      `json:"min,omitempty"`
	Max    int      `json:"max,omitempty"`
}

type Profile struct{ Provider, BaseURL, Model, Protocol string }

type Catalog struct {
	models, native            []Entry
	nativeIndex, channelIndex map[string]Entry
}

func Parse(data []byte) (Catalog, error) {
	var document struct {
		Models []Entry `json:"models"`
		Native []Entry `json:"native_models"`
	}
	if err := json.Unmarshal(data, &document); err != nil {
		return Catalog{}, err
	}
	c := Catalog{models: document.Models, native: document.Native,
		nativeIndex: make(map[string]Entry, len(document.Native)), channelIndex: make(map[string]Entry, len(document.Models))}
	for _, row := range c.native {
		c.nativeIndex[row.ID] = row
	}
	for _, row := range c.models {
		c.channelIndex[row.Provider+"\x00"+row.ID] = row
	}
	return c, nil
}

func (c Catalog) Count() int        { return len(c.models) }
func rawJSON(v any) json.RawMessage { raw, _ := json.Marshal(v); return raw }

// Query results are detached: editing a returned rule never changes another
// request's shared catalog or its provider defaults.
func detached[T any](value T) T { var out T; _ = json.Unmarshal(rawJSON(value), &out); return out }
func (c Catalog) NativeModel(id string) (Entry, bool) {
	row, ok := c.nativeModel(id)
	return detached(row), ok
}
func (c Catalog) LookupProfile(p Profile) (Entry, bool) {
	row, ok := c.lookup(p)
	return detached(row), ok
}
func (c Catalog) Capacity(p Profile) (Entry, bool) {
	row, ok := c.capacity(p)
	return detached(row), ok
}
func (c Catalog) Rule(p Profile) (parameters.Rule, bool) {
	rule, ok := c.rule(p)
	return detached(rule), ok
}
