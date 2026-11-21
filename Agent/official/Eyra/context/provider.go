package contextpolicy

import (
	"context"
	"github.com/aieyra/aieyra-os/agent/context/contract"
	"github.com/aieyra/aieyra-os/agent/context/summary"
	port "github.com/aieyra/aieyra-os/contracts/context"
)

var Reference = port.Reference{ID: "aieyra.context.pac", Version: "1.0.0", StateSchema: 1}

type Provider struct{ contract.Common }

func New() Provider {
	return Provider{contract.Common{Description: contract.Description{Reference: Reference, Contract: port.Version, Name: "Eyra PAC", Storage: "memory", RecentUserOriginals: RecentUserLimit}}}
}
func (p Provider) Compact(ctx context.Context, in contract.Input, complete summary.CompletionFunc) (contract.Candidate, error) {
	if err := ctx.Err(); err != nil {
		return contract.Candidate{}, err
	}
	answer, finish, err := complete(ctx, CompactRequest(in.Prefix, in.Instruction))
	if err != nil {
		return contract.Candidate{}, err
	}
	if err = ctx.Err(); err != nil {
		return contract.Candidate{}, err
	}
	answer.FinishReason = finish
	text, err := SegmentText(answer)
	return contract.Candidate{PacketText: text}, err
}
