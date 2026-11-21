// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/memoryservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Message; transcriptRows; openMemoryStore; fastCall
// Impact: python -B scripts/code-atlas.py show Core/memoryservice/helpers_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package memory

import (
	"context"
	"encoding/json"
	budget "github.com/aieyra/aieyra-os/agent/context"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"testing"
)

type Message = protocol.Message

func transcriptRows(key string, pos int, m []Message, redact func(string) string) []TranscriptRow {
	return TranscriptRows(key, pos, m, redact)
}
func openMemoryStore(file string, now func() int64, started int64) (*Store, error) {
	return Open(file, Options{Now: now, StartedAt: started, Resource: func(key string) string { return key }, EstimateTokens: func(s string) int { return budget.EstimateMessages([]Message{{Role: RoleUser, Content: s}}) }})
}
func fastCall(t *testing.T, s *Store, a memoryRow) memoryRow {
	t.Helper()
	r, err := s.Call(context.Background(), a, "global", "test")
	if err != nil {
		t.Fatal(err)
	}
	var out memoryRow
	if err = json.Unmarshal(rawJSON(r), &out); err != nil {
		t.Fatal(err)
	}
	return out
}
