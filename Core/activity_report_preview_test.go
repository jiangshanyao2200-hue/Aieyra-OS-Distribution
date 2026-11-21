// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestReportActivityCarriesContent
// Impact: python -B scripts/code-atlas.py show Core/activity_report_preview_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestReportActivityCarriesContent(t *testing.T) {
	for _, tool := range []string{"report", "workspace"} {
		args, _ := json.Marshal(map[string]string{"action": "report", "title": "周报", "format": "md", "content": "正文"})
		v := activityPreview(ToolCall{Function: FunctionCall{Name: tool, Arguments: string(args)}}, "a", "")
		if !strings.Contains(string(v.InputPreview), "正文") || !strings.Contains(string(v.InputPreview), "周报") {
			t.Fatalf("%s: %s", tool, v.InputPreview)
		}
	}
	args, _ := json.Marshal(map[string]string{"action": "reports"})
	if v := activityPreview(ToolCall{Function: FunctionCall{Name: "report", Arguments: string(args)}}, "a", ""); len(v.InputPreview) != 0 {
		t.Fatalf("listing has no content: %s", v.InputPreview)
	}
}
