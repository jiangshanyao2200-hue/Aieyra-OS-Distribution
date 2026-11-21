// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/protocol/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ValidSingleLineText
// Impact: python -B scripts/code-atlas.py show Contracts/protocol/text.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package protocol

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// ValidSingleLineText checks nonempty bounded text without control or format characters.
func ValidSingleLineText(s string, limit int) bool {
	if strings.TrimSpace(s) == "" || !utf8.ValidString(s) || utf8.RuneCountInString(s) > limit {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) || unicode.In(r, unicode.Cf) {
			return false
		}
	}
	return true
}
