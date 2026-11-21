// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workspaceFeed; publish; read
// Impact: python -B scripts/code-atlas.py show Core/workspace_events.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"sync"
	"time"
)

// Cursors are monotonic for one core lifetime; a renderer can reconnect using
// a snapshot when the bounded replay window has advanced past its cursor.

type workspaceFeed struct {
	mu           sync.Mutex
	cursor       uint64
	events       []WorkspaceEvent
	archive      *SessionArchive
	archiveError error
}

func (f *workspaceFeed) publish(role, kind string, data any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cursor++
	f.events = append(f.events, WorkspaceEvent{Cursor: f.cursor, At: time.Now().UTC().Format(time.RFC3339Nano), Role: role, Kind: kind, Data: data})
	if kind != "history_reset" {
		if f.archive == nil {
			f.archive = &SessionArchive{ephemeral: true}
		}
		if err := f.archive.Append("host", f.events[len(f.events)-1]); err != nil {
			f.archiveError = err
		}
	}
	if len(f.events) > 512 {
		copy(f.events, f.events[len(f.events)-512:])
		f.events = f.events[:512]
	}
}

func (f *workspaceFeed) read(after uint64) ([]WorkspaceEvent, uint64, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	reset := after > f.cursor || len(f.events) > 0 && after+1 < f.events[0].Cursor
	result := make([]WorkspaceEvent, 0)
	for _, e := range f.events {
		if e.Cursor > after {
			result = append(result, e)
		}
	}
	return result, f.cursor, reset
}
