// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: takeEmphasis
// Impact: python -B scripts/code-atlas.py show Client/CLI/mdrender/emphasis.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package mdrender

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// Delimiter runs retain nested emphasis without treating identifier underscores
// or unfinished streamed markers as formatting. Code and escapes stay literal.
func takeEmphasis(s string, start int) (body string, consumed, count int, ok bool) {
	mark := s[start]
	if mark == '_' && start > 0 {
		r, _ := utf8.DecodeLastRuneInString(s[:start])
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return
		}
	}
	count = 1
	for start+count < len(s) && s[start+count] == mark {
		count++
	}
	if count > 3 || start+count >= len(s) {
		return "", 0, 0, false
	}
	r, _ := utf8.DecodeRuneInString(s[start+count:])
	if unicode.IsSpace(r) {
		return "", 0, 0, false
	}
	for i := start + count; i < len(s); {
		if s[i] == '\\' && i+1 < len(s) {
			i += 2
			continue
		}
		if s[i] == '`' {
			n := 1
			for i+n < len(s) && s[i+n] == '`' {
				n++
			}
			if end := strings.Index(s[i+n:], strings.Repeat("`", n)); end >= 0 {
				i += n + end + n
				continue
			}
		}
		if s[i] != mark {
			i++
			continue
		}
		run := 1
		for i+run < len(s) && s[i+run] == mark {
			run++
		}
		prev, _ := utf8.DecodeLastRuneInString(s[:i])
		next, _ := utf8.DecodeRuneInString(s[i+run:])
		if !unicode.IsSpace(prev) && run >= count && !(count == 1 && run == 2) &&
			(mark != '_' || !unicode.IsLetter(next) && !unicode.IsDigit(next)) {
			end := i + run - count
			if end > start+count {
				return s[start+count : end], i + run - start, count, true
			}
		}
		i += run
	}
	return "", 0, 0, false
}
