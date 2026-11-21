// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: patchCall; TestPatchToolReplayAndRecoveryNeverReexecute
// Impact: python -B scripts/code-atlas.py show Core/patch_integration_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func patchCall(text string) ToolCall {
	b, _ := json.Marshal(PatchRequest{Patch: text, Description: "核对文件修改"})
	return ToolCall{ID: "patch", Function: FunctionCall{Name: "apply_patch", Arguments: string(b)}}
}

func TestPatchToolReplayAndRecoveryNeverReexecute(t *testing.T) {
	m := shellTestManager(t)
	e := &PlanEngine{}
	response := Message{Role: RoleAssistant, ToolCalls: []ToolCall{patchCall("*** Begin Patch\n*** Add File: once.txt\n+once\n*** End Patch")}}
	var progress ToolReceipt
	turn, err := ExecuteToolTurn(context.Background(), e, m, response, "patch-turn", func(kind string, v any) error {
		if kind == "tool_progress" {
			progress = v.(ToolReceipt)
		}
		return nil
	})
	if err != nil || progress.Patch == nil || !progress.Patch.OK {
		t.Fatalf("%v %+v", err, progress.Patch)
	}
	os.WriteFile(filepath.Join(m.root, "once.txt"), []byte("external edit"), 0644)
	replay, err := ExecuteToolTurn(context.Background(), e, m, response, "patch-turn", func(string, any) error { t.Fatal("replay persisted again"); return nil })
	if err != nil || !replay.Replayed {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(m.root, "once.txt"))
	if string(b) != "external edit" {
		t.Fatal("replayed side effect")
	}
	restored := &RestoredSession{}
	if err = restored.applyToolTurn(turn); err != nil {
		t.Fatal(err)
	}
	if len(restored.PatchHistory[2]) != 1 || restored.PatchHistory[2][0].Files[0].Hunks[0].Lines[0].Text != "once" {
		t.Fatal("lost actual diff on restore")
	}
	recovered, err := interruptedToolTurn(ToolIntent{"patch-turn", response}, map[string]ToolReceipt{progress.Key: progress})
	if err != nil || recovered.Receipts[0].Patch == nil {
		t.Fatal("partial tool turn lost patch receipt", err)
	}
}
