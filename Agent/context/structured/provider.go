// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/context/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Reference; Provider; New; Compact
// Impact: python -B scripts/code-atlas.py show Agent/context/structured/provider.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package structured supplies an independent archive-only context provider.
package structured

import (
	"context"
	"github.com/aieyra/aieyra-os/agent/context/contract"
	"github.com/aieyra/aieyra-os/agent/context/summary"
	port "github.com/aieyra/aieyra-os/contracts/context"
)

var Reference = port.Reference{ID: "aieyra.context.structured", Version: "1.0.0", StateSchema: 1}

type Provider struct{ contract.Common }

func New() Provider {
	return Provider{contract.Common{Description: contract.Description{Reference: Reference, Contract: port.Version, Name: "结构化会话摘要", Storage: "archive", RecentUserOriginals: 100}}}
}
func (p Provider) Compact(ctx context.Context, in contract.Input, complete summary.CompletionFunc) (contract.Candidate, error) {
	s, err := summary.Compact(ctx, in.Previous, in.Messages, in.Instruction, complete)
	return contract.Candidate{Summary: s}, err
}
