// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestCompactionRecoveryRespectsLimitsAndProviderDecisions
// Impact: python -B scripts/code-atlas.py show Core/compaction_recovery_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestCompactionRecoveryRespectsLimitsAndProviderDecisions(t *testing.T) {
	for _, row := range []struct {
		name string
		err  error
		stop bool
	}{
		{"temporary server", &APIError{StatusCode: 503, Code: "service_unavailable"}, false},
		{"wrapped temporary server", fmt.Errorf("compact: %w", &APIError{StatusCode: 502}), false},
		{"explicit policy with misleading status", &APIError{StatusCode: 503, Code: "content_policy_violation"}, true},
		{"quota with misleading status", &APIError{StatusCode: 503, Code: "insufficient_quota"}, true},
		{"billing with misleading status", &APIError{StatusCode: 500, Message: "credit balance exhausted"}, true},
		{"unavailable model", &APIError{StatusCode: 503, Code: "model_not_found"}, true},
		{"cooling account", &APIError{StatusCode: 503, Code: "accounts_cooling_down"}, true},
		{"wait instruction", &APIError{StatusCode: 503, RetryAfter: time.Minute}, true},
		{"rate limit", &APIError{StatusCode: 429}, true},
		{"auth", &APIError{StatusCode: 401}, true},
		{"invalid request", &APIError{StatusCode: 400}, true},
		{"request budget", errors.New("agent request budget exhausted"), true},
		{"invalid summary", errors.New("summary malformed"), false},
	} {
		t.Run(row.name, func(t *testing.T) {
			if got := compactionMustStop(context.Background(), row.err, 4000, 8000); got != row.stop {
				t.Fatalf("stop=%v want=%v", got, row.stop)
			}
			if !compactionMustStop(context.Background(), row.err, 8001, 8000) {
				t.Fatal("hard input limit bypassed")
			}
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			if !compactionMustStop(ctx, row.err, 4000, 8000) {
				t.Fatal("user cancellation bypassed")
			}
		})
	}
}
