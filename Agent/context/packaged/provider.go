// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/context/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Definition; Decode; Provider; New; Cut; Compact
// Impact: python -B scripts/code-atlas.py show Agent/context/packaged/provider.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package packaged implements portable, declarative context policies. Packages
// supply retention and summary guidance; the common provider boundary retains
// wire data, budget accounting, source validation and scoped state migration.
package packaged

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"

	"github.com/aieyra/aieyra-os/agent/context/contract"
	"github.com/aieyra/aieyra-os/agent/context/history"
	"github.com/aieyra/aieyra-os/agent/context/summary"
	port "github.com/aieyra/aieyra-os/contracts/context"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

type Definition struct {
	Schema          string `json:"schema"`
	ID              string `json:"id"`
	Version         string `json:"version"`
	Name            string `json:"name"`
	StateSchema     int    `json:"state_schema"`
	Engine          string `json:"engine"`
	KeepTurns       int    `json:"keep_turns"`
	SummaryGuidance string `json:"summary_guidance"`
}

func Decode(data []byte) (Definition, error) {
	var d Definition
	if len(data) > 32<<10 || !utf8.Valid(data) {
		return d, fmt.Errorf("context policy must be at most 32 KiB of UTF-8")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&d); err != nil {
		return d, err
	}
	if decoder.Decode(new(any)) != io.EOF {
		return d, fmt.Errorf("context policy must contain one JSON value")
	}
	ref := port.Reference{ID: d.ID, Version: d.Version, StateSchema: d.StateSchema}
	if err := ref.Validate(); err != nil {
		return d, err
	}
	if d.Schema != "aieyra.context/1" || d.Engine != "structured" || d.StateSchema != 1 || d.KeepTurns < 1 || d.KeepTurns > 100 || strings.TrimSpace(d.Name) == "" || len(d.Name) > 160 || strings.TrimSpace(d.SummaryGuidance) == "" || len(d.SummaryGuidance) > 16<<10 || strings.ContainsRune(d.SummaryGuidance, 0) || strings.ContainsRune(d.Name, 0) {
		return d, fmt.Errorf("unsupported context engine, schema, retention or summary guidance")
	}
	return d, nil
}

type Provider struct {
	contract.Common
	definition Definition
}

func New(d Definition, digest string) (Provider, error) {
	// Revalidate callers as well as file decoders; no mutable package data escapes.
	data, err := json.Marshal(d)
	if err != nil {
		return Provider{}, err
	}
	if _, err = Decode(data); err != nil {
		return Provider{}, err
	}
	ref := port.Reference{ID: d.ID, Version: d.Version, StateSchema: d.StateSchema, Digest: digest}
	if err = ref.Validate(); err != nil || digest == "" {
		return Provider{}, fmt.Errorf("context provider requires an exact package digest")
	}
	return Provider{Common: contract.Common{Description: contract.Description{Reference: ref, Contract: port.Version, Name: d.Name, Storage: "archive", RecentUserOriginals: history.RecentUserLimit}}, definition: d}, nil
}

func (p Provider) Cut(messages []protocol.Message, keep int, emergency bool, recall string) int {
	// A package may keep more complete turns; emergency boundaries still belong
	// to the common history implementation and never split a tool/result pair.
	return history.CompactWorkCut(messages, max(keep, p.definition.KeepTurns), emergency, recall)
}

func (p Provider) Compact(ctx context.Context, in contract.Input, complete summary.CompletionFunc) (contract.Candidate, error) {
	instruction := in.Instruction + "\n\n" + p.definition.SummaryGuidance
	s, err := summary.Compact(ctx, in.Previous, in.Messages, instruction, complete)
	return contract.Candidate{Summary: s}, err
}
