// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: compactionMustStop
// Impact: python -B scripts/code-atlas.py show Core/compaction_recovery.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"errors"
	"strings"
)

// Compaction is maintenance: a temporary server outage may defer it when the
// original input still fits. Explicit refusals, account limits, Retry-After and
// exhausted local budgets remain terminal. The next call is normal work with
// exact original context, never a replay of executed tools or another summary.
func compactionMustStop(ctx context.Context, err error, estimate, inputLimit int) bool {
	if ctx.Err() != nil || estimate > inputLimit || strings.Contains(err.Error(), "budget exhausted") {
		return true
	}
	var api *APIError
	if errors.As(err, &api) {
		return api.RetryAfter > 0 || transientRequestError(err) == "" || classifyAgentFailure(err, "").Code != "provider_unavailable"
	}
	return false
}
