// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkspaceFeedReplayAndReset
// Impact: python -B scripts/code-atlas.py show Core/workspace_events_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "testing"

func TestWorkspaceFeedReplayAndReset(t *testing.T) {
	var f workspaceFeed
	for i := 0; i < 520; i++ {
		f.publish("matrix", "state", i)
	}
	events, cursor, reset := f.read(0)
	if len(events) != 512 || cursor != 520 || !reset {
		t.Fatalf("replay: %d %d %v", len(events), cursor, reset)
	}
	events, _, reset = f.read(519)
	if len(events) != 1 || events[0].Cursor != 520 || reset {
		t.Fatal("incremental replay lost ordering")
	}
	_, _, reset = f.read(999)
	if !reset {
		t.Fatal("core restart must invalidate a future cursor")
	}
}
