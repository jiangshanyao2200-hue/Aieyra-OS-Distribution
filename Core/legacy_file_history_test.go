// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestRetiredFileToolsRejectNewCallsAndDisappearFromBridge; TestLegacyFileHistoryRestoresWithoutReadingSource
// Impact: python -B scripts/code-atlas.py show Core/legacy_file_history_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func TestRetiredFileToolsRejectNewCallsAndDisappearFromBridge(t *testing.T) {
	m := shellTestManager(t)
	for _, name := range []string{"read_file", "list_files", "search_text"} {
		if IsDisplayTool(name) {
			t.Fatalf("retired tool remains active: %s", name)
		}
		call := executionCall(name, map[string]any{"path": "missing.txt", "pattern": "secret"})
		turn, err := ExecuteToolTurn(context.Background(), &PlanEngine{}, m, Message{Role: RoleAssistant, ToolCalls: []ToolCall{call}}, name, func(string, any) error { return nil })
		if err != nil {
			t.Fatal(err)
		}
		var result PlanToolResult
		if json.Unmarshal([]byte(turn.Messages[1].Content), &result) != nil || result.OK || result.Error == nil || result.Error.Code != "unknown_tool" {
			t.Fatalf("unexpected result: %+v", turn)
		}
	}
	r := runCell(t, m, `text([typeof tools.read_file, typeof tools.list_files, typeof tools.search_text]);`, "retired")
	if selectedText(r) != `["undefined","undefined","undefined"]` {
		t.Fatal(selectedText(r))
	}
	if len(m.Snapshots()) != 0 {
		t.Fatal("retired calls launched a process")
	}
}

func TestLegacyFileHistoryRestoresWithoutReadingSource(t *testing.T) {
	config := filepath.Join(t.TempDir(), "config.json")
	a, err := NewSessionArchive(config)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	if err = a.Start(ModelFlash); err != nil {
		t.Fatal(err)
	}
	response := Message{Role: RoleAssistant}
	outputs := []string{
		`{"ok":true,"state":"completed","lines":[{"line":12,"column":1,"text":"archived text"}],"summary":"读取 1 行"}`,
		`{"ok":true,"state":"completed","files":["absent/old.go"],"summary":"1 个文件"}`,
		`{"ok":true,"state":"completed","matches":[{"path":"absent/old.go","line":12,"text":"archived match"}],"summary":"1 条匹配"}`,
	}
	for _, name := range []string{"read_file", "list_files", "search_text"} {
		call := executionCall(name, map[string]any{"path": "absent/old.go", "start_line": 12, "pattern": "archived", "description": "旧记录"})
		call.ID = name
		response.ToolCalls = append(response.ToolCalls, call)
	}
	turn := ToolTurn{InvocationID: "legacy", Messages: []Message{response}}
	for i, call := range response.ToolCalls {
		turn.Messages = append(turn.Messages, Message{Role: RoleTool, ToolCallID: call.ID, Name: call.Function.Name, Content: outputs[i]})
	}
	if err = a.Append("tool_turn", turn); err != nil {
		t.Fatal(err)
	}
	id := a.ID()
	a.Close()
	restored, state, err := RestoreSession(config, id)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	count := 0
	joined := ""
	for _, results := range state.ShellHistory {
		for _, r := range results {
			if r.File == nil || r.File.Path != "absent/old.go" {
				t.Fatalf("legacy metadata lost: %+v", r)
			}
			count++
			joined += r.Output
		}
	}
	if count != 3 || !strings.Contains(joined, "archived text") || !strings.Contains(joined, "archived match") {
		t.Fatalf("history count=%d output=%s", count, joined)
	}
}
