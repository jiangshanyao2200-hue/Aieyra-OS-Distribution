// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/memoryservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: rawJSON; newID; memString; memInt; memoryTerms
// Impact: python -B scripts/code-atlas.py show Core/memoryservice/values.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package memory

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"github.com/aieyra/aieyra-os/contracts/protocol"
)

const (
	RoleUser      = protocol.RoleUser
	RoleAssistant = protocol.RoleAssistant
	RoleTool      = protocol.RoleTool
)

func rawJSON(v any) json.RawMessage    { b, _ := json.Marshal(v); return b }
func newID() string                    { var b [16]byte; _, _ = rand.Read(b[:]); return hex.EncodeToString(b[:]) }
func memString(v any) string           { return String(v) }
func memInt(v any) int64               { return Int(v) }
func memoryTerms(text string) []string { return Terms(text) }
