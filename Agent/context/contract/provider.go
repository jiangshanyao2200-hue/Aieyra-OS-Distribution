// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/context/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Description; Input; Candidate; Assessment; Provider; Common; Describe; Assemble; Evaluate; Cut; Recall; Export; Import; Migrate
// Impact: python -B scripts/code-atlas.py show Agent/context/contract/provider.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package contract is the executable context-provider boundary. The host owns
// source authorization, model settings, tool execution and durable commits.
package contract

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	budget "github.com/aieyra/aieyra-os/agent/context"
	"github.com/aieyra/aieyra-os/agent/context/history"
	"github.com/aieyra/aieyra-os/agent/context/summary"
	port "github.com/aieyra/aieyra-os/contracts/context"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"io"
)

type Description struct {
	Reference           port.Reference `json:"reference"`
	Contract            int            `json:"contract"`
	Name                string         `json:"name"`
	Storage             string         `json:"checkpoint_storage"`
	RecentUserOriginals int            `json:"recent_user_originals"`
}

type Input struct {
	Previous    json.RawMessage
	Messages    []protocol.Message
	Prefix      []protocol.Message
	Instruction string
}

// A Candidate has no persistence authority. The host checks range, cancellation,
// reduction and source revision again before committing it exactly once.
type Candidate struct {
	Summary    *summary.Summary
	PacketText string
}

type Assessment struct {
	Tokens       int `json:"tokens"`
	InputLimit   int `json:"input_limit"`
	WorkingLimit int `json:"working_limit"`
	Threshold    int `json:"threshold"`
}

type Provider interface {
	Describe() Description
	Assemble(prefix, history []protocol.Message) []protocol.Message
	Evaluate(budget.Budget, []protocol.Message, *budget.TokenMeter) Assessment
	Cut([]protocol.Message, int, bool, string) int
	Recall([]protocol.Message, int, string, int, string) string
	Compact(context.Context, Input, summary.CompletionFunc) (Candidate, error)
	Export(port.State) ([]byte, error)
	Import([]byte, string) (port.State, error)
	Migrate(port.State, string) (port.State, error)
}

// Common implements wire-preserving assembly and portable state handling.
// Concrete providers choose their own summarization and storage requirements.
type Common struct{ Description Description }

func (p Common) Describe() Description { return p.Description }
func (p Common) Assemble(prefix, messages []protocol.Message) []protocol.Message {
	out := append(protocol.CloneMessages(prefix), protocol.CloneMessages(messages)...)
	return out
}
func (p Common) Evaluate(b budget.Budget, messages []protocol.Message, meter *budget.TokenMeter) Assessment {
	return Assessment{Tokens: meter.Estimate(messages), InputLimit: b.InputLimit(), WorkingLimit: b.WorkingLimit(), Threshold: b.Threshold()}
}
func (p Common) Cut(m []protocol.Message, keep int, emergency bool, recall string) int {
	return history.CompactWorkCut(m, keep, emergency, recall)
}
func (p Common) Recall(m []protocol.Message, covered int, query string, tokens int, recall string) string {
	return history.Recall(m, covered, query, tokens, recall)
}
func (p Common) Export(state port.State) ([]byte, error) {
	if err := state.Validate(); err != nil {
		return nil, err
	}
	data, err := json.Marshal(state)
	if len(data) > 4<<20 {
		return nil, fmt.Errorf("context state exceeds 4 MiB")
	}
	return data, err
}
func (p Common) Import(data []byte, session string) (port.State, error) {
	var state port.State
	if len(data) > 4<<20 {
		return state, fmt.Errorf("context state exceeds 4 MiB")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil {
		return state, err
	}
	if decoder.Decode(new(any)) != io.EOF {
		return port.State{}, fmt.Errorf("context state must contain one JSON value")
	}
	if err := state.Validate(); err != nil {
		return state, err
	}
	if state.Session != session {
		return port.State{}, fmt.Errorf("context state belongs to another session")
	}
	return state, nil
}
func (p Common) Migrate(state port.State, session string) (port.State, error) {
	data, err := p.Export(state)
	if err != nil {
		return port.State{}, err
	}
	next, err := p.Import(data, session)
	if err != nil {
		return port.State{}, err
	}
	if ns, ok := next.Namespaces[p.Description.Reference.ID]; ok && ns.Schema != p.Description.Reference.StateSchema {
		return port.State{}, fmt.Errorf("context state migration is unavailable for schema %d", ns.Schema)
	}
	next.Provider = p.Description.Reference
	return next, nil
}
