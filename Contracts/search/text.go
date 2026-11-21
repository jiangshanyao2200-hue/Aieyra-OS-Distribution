// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/search/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: SafeURL; PrefixBytes
// Impact: python -B scripts/code-atlas.py show Contracts/search/text.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package search

import (
	"net/url"
	"unicode/utf8"
)

func SafeURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Hostname() != "" && u.User == nil && len(raw) <= 2000
}
func PrefixBytes(s string, n int) string {
	if n >= len(s) {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}
