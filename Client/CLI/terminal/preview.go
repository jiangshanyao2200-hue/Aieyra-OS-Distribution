// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: previewText
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/preview.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"bytes"
	"encoding/json"
	patchtext "github.com/aieyra/aieyra-os/tool/base/official/apply_patch/presentation/text"
	terminaltext "github.com/aieyra/aieyra-os/tool/base/official/terminal/presentation/text"
	viewtext "github.com/aieyra/aieyra-os/tool/base/official/view_image/presentation/text"
	searchtext "github.com/aieyra/aieyra-os/tool/base/official/web_search/presentation/text"
	packagetext "github.com/aieyra/aieyra-os/tool/presentation/text"
	imagetext "github.com/aieyra/aieyra-os/tool/toolbox/official/imagegen/presentation/text"
	videotext "github.com/aieyra/aieyra-os/tool/toolbox/official/videogen/presentation/text"
)

// Read-only projections of real tool receipts; no executor dependency and no
// invented output. Unknown structures keep all their fields as indented JSON.
func previewText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	if value, ok := packagetext.Preview(raw); ok {
		return value
	}
	var p struct {
		Output, Text, State string
	}
	if json.Unmarshal(raw, &p) != nil {
		return safeText(string(raw))
	}
	if value, ok := terminaltext.Preview(raw); ok {
		return value
	}
	if p.Output != "" {
		return p.Output
	}
	if p.Text != "" {
		return p.Text
	}
	if value, ok := patchtext.Preview(raw, previewText); ok {
		return value
	}
	if value, ok := videotext.Preview(raw); ok {
		return value
	}
	if value, ok := imagetext.Preview(raw); ok {
		return value
	}
	if value, ok := viewtext.Preview(raw); ok {
		return value
	}
	if value, ok := searchtext.Preview(raw); ok {
		return value
	}
	var pretty bytes.Buffer
	if json.Indent(&pretty, raw, "", "  ") == nil {
		return pretty.String()
	}
	return string(raw)
}
