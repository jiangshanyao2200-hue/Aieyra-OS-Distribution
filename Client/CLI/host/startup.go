// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: startup
// Impact: python -B scripts/code-atlas.py show Client/CLI/host/startup.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package cli

import (
	"context"
	"fmt"
	"io"
	"time"
)

// The core owns startup and dream delivery in both hosts. Input always wins:
// retain the first line while cancelling preparation, including piped input.
// Greeting/status text goes to diagnostic so JSON stdout remains machine-readable.
func (c *client) startup(ctx context.Context, lines <-chan inputLine, diagnostic io.Writer) (*inputLine, error) {
	skip := func(line inputLine, open bool) (*inputLine, error) {
		stop, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := c.call(stop, "workspace.greet", map[string]bool{"skip": true}, nil); err != nil {
			return nil, err
		}
		if !open {
			line.err = io.EOF
		}
		return &line, nil
	}
	// Give an already-buffered pipe/scanner time to deliver without a model call.
	ready := time.NewTimer(40 * time.Millisecond)
	defer ready.Stop()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case line, open := <-lines:
		return skip(line, open)
	case <-ready.C:
	}
	if err := c.call(ctx, "workspace.greet", nil, nil); err != nil {
		return nil, err
	}
	tick := time.NewTicker(100 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			_, _ = skip(inputLine{}, false)
			return nil, ctx.Err()
		case line, open := <-lines:
			return skip(line, open)
		case <-tick.C:
			var snapshot struct {
				Greeting struct{ State, Text, Error string }
			}
			if err := c.call(ctx, "workspace.snapshot", nil, &snapshot); err != nil {
				return nil, err
			}
			switch snapshot.Greeting.State {
			case "online":
				_, err := fmt.Fprintln(diagnostic, terminalText(snapshot.Greeting.Text))
				return nil, err
			case "offline":
				_, err := fmt.Fprintln(diagnostic, terminalText(snapshot.Greeting.Error))
				return nil, err
			case "skipped":
				return nil, nil
			}
		}
	}
}
