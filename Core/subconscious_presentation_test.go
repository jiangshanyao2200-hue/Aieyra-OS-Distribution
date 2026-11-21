// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestRetiredSubconsciousSnapshotKeepsReadCompatibility
// Impact: python -B scripts/code-atlas.py show Core/subconscious_presentation_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "testing"

func TestRetiredSubconsciousSnapshotKeepsReadCompatibility(t *testing.T) {
	w := &Workspace{}
	view := w.subconsciousView()
	if view["retired"] != true || len(view["activities"].([]subActivity)) != 0 {
		t.Fatal("retired subsystem advertised live work", view)
	}
	// Already-held historical state can still be read, but reading cannot
	// emit new chat activity or mutate the retained snapshot.
	w.sub.activities = []subActivity{{ID: 7, Kind: "compact", State: "done", Steps: []string{"historical step"}}}
	w.sub.diary = &subDiary{ID: 3, Title: "Old shared diary", Created: 1}
	view = w.subconsciousView()
	rows := view["activities"].([]subActivity)
	rows[0].Steps[0] = "reader mutation"
	diary := view["diary"].(subDiary)
	diary.Title = "reader mutation"
	if w.sub.activities[0].Steps[0] != "historical step" || w.sub.diary.Title != "Old shared diary" {
		t.Fatal("legacy snapshot leaked mutable state")
	}
	events, _, _ := w.feed.read(0)
	if len(events) != 0 {
		t.Fatal("reading retired state emitted new chat messages", events)
	}
}
