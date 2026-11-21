// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/privacy/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: RedactSecretEncodings
// Impact: python -B scripts/code-atlas.py show Contracts/privacy/text.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package privacy

import (
	"encoding/json"
	"sort"
	"strings"
)

// Payloads can contain JSON strings containing tool arguments, themselves JSON.
// Replace escaped representations as well as plain keys, longest first, without
// decoding or truncating immutable originals or loading settings per field.
func RedactSecretEncodings(text string, keys []string) string {
	seen := map[string]bool{}
	for _, key := range keys {
		if key == "" {
			continue
		}
		seen[key] = true
		for i := 0; i < 4; i++ {
			b, _ := json.Marshal(key)
			key = string(b[1 : len(b)-1])
			seen[key] = true
		}
	}
	variants := make([]string, 0, len(seen))
	for key := range seen {
		variants = append(variants, key)
	}
	sort.Slice(variants, func(i, j int) bool { return len(variants[i]) > len(variants[j]) })
	for _, key := range variants {
		text = strings.ReplaceAll(text, key, "[redacted]")
	}
	return text
}
