// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkboxLongJSONKeepsLogicalOutputAcrossRestart; TestWorkboxSeparateTextCallsRemainSeparateResults
// Impact: python -B scripts/code-atlas.py show Core/workbox_output121_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"

	toolruntime "github.com/aieyra/aieyra-os/tool/runtime"
	"github.com/aieyra/aieyra-os/tool/workbox"
)

func TestWorkboxLongJSONKeepsLogicalOutputAcrossRestart(t *testing.T) {
	m := shellTestManager(t)
	source, err := toolruntime.JavaScript(CustomTool{
		Schema: map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false},
		Code:   `return {value:"中文".repeat(900),count:900};`,
	}, json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	delay, zero := 30000, 0
	result, _ := m.execution.execute(context.Background(), executionCall("exec", ExecRequest{Code: source, YieldTimeMS: &delay, MaxOutputTokens: 256}), "long-json121")
	if !result.OK || result.State != "completed" || !result.HasMore {
		t.Fatalf("long result did not retain ordinary paged reads: %+v", result)
	}
	var paged strings.Builder
	for pages := 0; ; pages++ {
		for _, output := range result.Output {
			if !utf8.ValidString(output.Text) {
				t.Fatal("paged output split a UTF-8 character")
			}
			paged.WriteString(output.Text)
		}
		if !result.HasMore {
			break
		}
		if pages >= 32 {
			t.Fatal("paged output failed to finish")
		}
		result, _ = m.execution.execute(context.Background(), executionCall("wait", WaitRequest{CellID: result.CellID, YieldTimeMS: &zero, MaxTokens: 256}), "long-json-page121")
		if !result.OK || result.State != "completed" {
			t.Fatalf("long result page failed: %+v", result)
		}
	}
	snapshot, ok := m.executionByKey("long-json121")
	if !ok || len(snapshot.Output) != 1 || snapshot.Output[0].Text != paged.String() || !json.Valid([]byte(paged.String())) {
		t.Fatalf("one text() call lost its logical boundary: %+v", snapshot)
	}
	bound, state, receipt, detail := workflowCellResult(snapshot)
	if state != "completed" || receipt != snapshot.CellID || detail != "" {
		t.Fatalf("workflow result failed: %s %s %s", state, receipt, detail)
	}
	value, err := workbox.Bind(map[string]any{"$step": "source", "path": "/value"}, nil, map[string]json.RawMessage{"source": bound})
	if err != nil || value != strings.Repeat("中文", 900) {
		t.Fatalf("downstream field binding failed: %v", err)
	}
	m.Close()
	restored, err := NewShellManager(m.root, m.dir)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	recovered, ok := restored.executionByKey("long-json121")
	if !ok || len(recovered.Output) != 1 {
		t.Fatalf("restored output boundary changed: %+v", recovered)
	}
	after, state, receipt, detail := workflowCellResult(recovered)
	if string(after) != string(bound) || state != "completed" || receipt != snapshot.CellID || detail != "" {
		t.Fatal("restart changed the original JSON result or receipt")
	}
}

func TestWorkboxSeparateTextCallsRemainSeparateResults(t *testing.T) {
	m := shellTestManager(t)
	result := runCell(t, m, `text('{"value":');text('"separate calls"}');`, "separate-text121")
	if len(result.Output) != 2 || !json.Valid([]byte(selectedText(result))) {
		t.Fatalf("fixture did not produce distinct JSON fragments: %+v", result)
	}
	bound, state, _, _ := workflowCellResult(result)
	var receipt ExecResult
	if state != "completed" || json.Unmarshal(bound, &receipt) != nil || receipt.CellID != result.CellID || len(receipt.Output) != 2 {
		t.Fatal("independent text() calls were guessed into one JSON result")
	}
	// Old journals have no evidence that separate text entries were storage
	// fragments. Recovery must keep them intact instead of guessing a merge.
	legacy := ExecResult{OK: true, State: "completed", CellID: "legacy", Output: []ExecOutput{{Type: "text", Text: `{"value":`}, {Type: "text", Text: `"old fragments"}`}}}
	bound, _, _, _ = workflowCellResult(legacy)
	if json.Unmarshal(bound, &receipt) != nil || receipt.CellID != "legacy" || len(receipt.Output) != 2 {
		t.Fatal("legacy ambiguous output was silently reinterpreted")
	}
}
