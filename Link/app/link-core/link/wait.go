// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/app/link-core/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: Wait
// Impact: python -B scripts/code-atlas.py show Link/app/link-core/link/wait.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package link

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// Wait observes the original message. Disconnecting never resubmits or cancels it.
func (c *Client) Wait(ctx context.Context, id string) (Message, error) {
	if !validID(id) {
		return Message{}, fmt.Errorf("valid message ID required")
	}
	for {
		var m Message
		if err := c.Call(ctx, "/v1/messages", map[string]string{"id": id}, &m); err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return m, fmt.Errorf("result wait ended; message %s remains on its original executor: %w", id, err)
			}
			return m, err
		}
		if finalState(m.State) || m.State == "waiting_user" {
			return m, nil
		}
		select {
		case <-ctx.Done():
			return m, fmt.Errorf("result wait ended; message %s remains on its original executor: %w", id, ctx.Err())
		case <-time.After(300 * time.Millisecond):
		}
	}
}
