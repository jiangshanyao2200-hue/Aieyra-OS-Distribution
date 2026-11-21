// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestPackagePreviewRetainsOutputInsteadOfGenericToolboxSentence
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/package_preview_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPackagePreviewRetainsOutputInsteadOfGenericToolboxSentence(t *testing.T) {
	raw := json.RawMessage(`{"package":"mod:example.statistics@` + strings.Repeat("a", 64) + `","output":"See data","state":"running","data":{"cell_id":"cell","has_more":true,"output":[{"type":"text","text":"first"},{"type":"text","text":"second"}],"error":{"message":"actual error"}}}`)
	result := previewText(raw)
	for _, want := range []string{"first", "second", "actual error", "running", "has_more", "cell"} {
		if !strings.Contains(result, want) {
			t.Fatal("CLI lost receipt field", want, result)
		}
	}
}
