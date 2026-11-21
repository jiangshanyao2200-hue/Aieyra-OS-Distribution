// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: safeText; sanitizePaste
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/text.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"strings"
	"unicode"
)

func safeText(s string) string {
	var out strings.Builder
	state := byte(0)
	for _, r := range s {
		switch state {
		case 1: // ESC
			switch r {
			case '[':
				state = 2
			case ']', 'P', '^', '_':
				state = 3
			default:
				state = 0
			}
			continue
		case 2: // CSI parameters and final byte
			if r >= 0x40 && r <= 0x7e {
				state = 0
			}
			continue
		case 3: // OSC/DCS/APC payload through BEL or ST
			if r == 7 || r == 0x9c {
				state = 0
			} else if r == 0x1b {
				state = 4
			}
			continue
		case 4:
			if r == '\\' {
				state = 0
			} else {
				state = 3
			}
			continue
		}
		switch r {
		case 0x1b:
			state = 1
		case 0x9b:
			state = 2
		case 0x90, 0x9d, 0x9e, 0x9f:
			state = 3
		default:
			if r == '\n' || r == '\t' || !unicode.IsControl(r) && r != 0x7f {
				out.WriteRune(r)
			}
		}
	}
	return out.String()
}

// Preserve graphemes, indentation and trailing newlines. Only terminal controls
// and platform line-ending differences are removed at the presentation boundary.
func sanitizePaste(s string) (string, bool) {
	s = safeText(strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n"))
	return s, s != ""
}
