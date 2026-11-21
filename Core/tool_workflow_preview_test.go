// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestLargeWorkflowPreviewRetainsStepsAndNamedOutputs; TestWorkflowPreviewBoundsAllAdmittedStepsAndOutputs
// Impact: python -B scripts/code-atlas.py show Core/tool_workflow_preview_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestLargeWorkflowPreviewRetainsStepsAndNamedOutputs(t *testing.T) {
	original := rawJSON(map[string]any{
		"schema": "aieyra.workbox-state/1", "id": "owned-workflow", "state": "completed", "revision": 7,
		"title": "本场交付", "definition": map[string]any{"steps": []any{map[string]any{"id": "write", "title": "写入产物"}}},
		"steps":   []any{map[string]any{"id": "write", "state": "completed", "receipt": "actual-receipt", "result": map[string]any{"file": "report.md"}}},
		"outputs": map[string]any{"file": "report.md", "text": strings.Repeat("中文<&🙂\n", 20000)},
	})
	digest := sha256.Sum256(original)
	saved := ToolboxResult{Package: "mod:example.workflow@" + strings.Repeat("a", 64), OK: true, State: "completed", Data: original}
	preview := boundedPackagePreview(saved)
	if len(preview) > 64<<10 || !json.Valid(preview) {
		t.Fatal("workflow preview exceeds its wire budget", len(preview))
	}
	var result struct {
		PreviewTruncated bool `json:"preview_truncated"`
		Data             struct {
			Schema, ID, State string
			Revision          int
			Steps             []struct{ ID, State, Receipt string }
			Outputs           map[string]json.RawMessage
		}
	}
	if err := json.Unmarshal(preview, &result); err != nil {
		t.Fatal(err)
	}
	i := result.Data
	if !result.PreviewTruncated || i.Schema != "aieyra.workbox-state/1" || i.ID != "owned-workflow" || i.State != "completed" || i.Revision != 7 || len(i.Steps) != 1 || i.Steps[0].ID != "write" || i.Steps[0].State != "completed" || i.Steps[0].Receipt != "actual-receipt" || string(i.Outputs["file"]) != `"report.md"` || !bytes.Contains(i.Outputs["text"], []byte(`"preview_truncated":true`)) {
		t.Fatal("workflow presentation contract lost", string(preview))
	}
	if sha256.Sum256(original) != digest || !bytes.Equal(saved.Data, original) {
		t.Fatal("preview modified original receipt")
	}
}

func TestWorkflowPreviewBoundsAllAdmittedStepsAndOutputs(t *testing.T) {
	steps, definition := []any{}, []any{}
	outputs := map[string]any{}
	for n := 0; n < 32; n++ {
		id := fmt.Sprintf("step-%02d", n)
		steps = append(steps, map[string]any{"id": id, "state": "completed", "receipt": strings.Repeat("r", 500), "error": strings.Repeat("\"", 1000), "result": strings.Repeat("\"<&中文", 1000)})
		definition = append(definition, map[string]any{"id": id, "title": strings.Repeat("阶", 50), "arguments": map[string]any{"text": strings.Repeat("大", 1000)}})
		outputs[id] = strings.Repeat("\"<&中文", 1000)
	}
	data := rawJSON(map[string]any{"schema": "aieyra.workbox-state/1", "id": "all-steps", "state": "completed", "steps": steps, "definition": map[string]any{"steps": definition}, "outputs": outputs})
	preview := boundedPackagePreview(ToolboxResult{Package: "mod:example.workflow@" + strings.Repeat("a", 64), OK: true, State: "completed", Data: data})
	if len(preview) > 64<<10 || !json.Valid(preview) || !bytes.Contains(preview, []byte(`"id":"step-31"`)) {
		t.Fatal("full admitted workflow lost its last step or bound", len(preview))
	}
}
