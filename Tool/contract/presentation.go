// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: presentationKey; ValidatePresentation
// Impact: python -B scripts/code-atlas.py show Tool/contract/presentation.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

import (
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"regexp"
)

// Declarative views select trusted renderer components; they carry no HTML,
// CSS, network URLs to execute, callbacks, or privileged renderer JavaScript.

var presentationKey = regexp.MustCompile("^[a-zA-Z][a-zA-Z0-9_]{0,63}$")

func ValidatePresentation(p *protocol.ToolPresentation) error {
	if p == nil {
		return nil
	}
	switch p.Kind {
	case "terminal", "reader", "search", "editor", "browser", "toolbox", "table", "cards":
	default:
		return fmt.Errorf("unknown declarative view kind")
	}
	if len(p.Title) > 180 || len(p.Columns) > 12 {
		return fmt.Errorf("presentation exceeds limits")
	}
	for _, column := range p.Columns {
		if !presentationKey.MatchString(column.Key) || len(column.Label) > 100 {
			return fmt.Errorf("invalid presentation column")
		}
	}
	return nil
}
