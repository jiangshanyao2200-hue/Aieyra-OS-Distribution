// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/presentation/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: Preview
// Impact: python -B scripts/code-atlas.py show Tool/presentation/text/preview.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package text projects package tool receipts without losing output pages or errors.
package text

import (
	"bytes"
	"encoding/json"
	"github.com/aieyra/aieyra-os/tool/contract"
)

// The package's aieyra.tool-text/1 format=json contract preserves the entire
// receipt, including state, cell identity, output, errors and has_more.
func Preview(raw json.RawMessage) (string, bool) {
	var p struct {
		Package string `json:"package"`
	}
	if json.Unmarshal(raw, &p) != nil || !contract.ValidPackageID(p.Package) {
		return "", false
	}
	var pretty bytes.Buffer
	if json.Indent(&pretty, raw, "", "  ") != nil {
		return "", false
	}
	return pretty.String(), true
}
