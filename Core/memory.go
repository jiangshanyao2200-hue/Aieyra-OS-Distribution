// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: memoryStore; memoryRow; openMemoryStore; memString; memInt; memoryTerms; fastPendingDefault; deepSearchTerms
// Impact: python -B scripts/code-atlas.py show Core/memory.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import memoryservice "github.com/aieyra/aieyra-os/CORE/memoryservice"

type memoryStore = memoryservice.Store
type memoryRow = memoryservice.Row

func openMemoryStore(file string, now func() int64, startedAt int64) (*memoryStore, error) {
	return memoryservice.Open(file, memoryservice.Options{Now: now, StartedAt: startedAt, Resource: runtimePrompt, EstimateTokens: func(s string) int { return EstimateMessages([]Message{{Role: RoleUser, Content: s}}) }})
}
func memString(v any) string        { return memoryservice.String(v) }
func memInt(v any) int64            { return memoryservice.Int(v) }
func memoryTerms(s string) []string { return memoryservice.Terms(s) }

const fastPendingDefault = memoryservice.PendingDefault
const deepSearchTerms = memoryservice.SearchTermsLimit
