// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestConversationTerminalReadsBeyondOriginalWithoutExecution; TestConversationTerminalDoesNotInitializeService; TestConversationTerminalWaitsForProcessAndRetainsRejectedReceipt; TestConversationPrivateTerminalOwnReceiptWithoutExecution
// Impact: python -B scripts/code-atlas.py show Core/conversation_terminal_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConversationTerminalReadsBeyondOriginalWithoutExecution(t *testing.T) {
	h, m := receiptConversationFixture(t)
	id, group := strings.Repeat("a", 32), strings.Repeat("b", 32)
	archive := &SessionArchive{ephemeral: true}
	receiptMeta(t, archive, id, 2)
	receiptAppend(t, archive, "tool_intent", ToolIntent{InvocationID: "inv", Response: Message{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: "cmd", Function: FunctionCall{Name: "terminal", Arguments: `{"action":"exec","cmd":"test"}`}}}}})
	receiptAppend(t, archive, "tool_progress", ToolReceipt{Key: "inv:cmd", ToolName: "terminal", Output: `{"ok":true,"session_id":12,"generation":2,"state":"running","output":"first\n"}`})
	dir := filepath.Join(m.dir, id+".shell")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	log := filepath.Join(dir, "12.log")
	output := "first\n最后🙂\n"
	if err := os.WriteFile(log, []byte(output), 0600); err != nil {
		t.Fatal(err)
	}
	exit := 0
	r := ShellResult{OK: true, SessionID: 12, Generation: 2, State: "exited", ExitCode: &exit, OutputRef: log, LoggedBytes: int64(len(output))}
	sj := &shellJob{result: r, cursor: 3}
	shell := &ShellManager{jobs: map[int]*shellJob{12: sj}}
	job := &agentJob{record: AgentRecord{ID: id, Parent: m.owner, Generation: 3, State: "idle", Spec: AgentSpec{Kind: "conversation", GroupID: group}}, archive: archive, shell: shell}
	m.jobs[id] = job
	if err := m.writeGroup(&conversationGroup{ID: group, Host: groupMember{Session: id}}); err != nil {
		t.Fatal(err)
	}
	p := map[string]any{"action": "group_terminal_read", "group_id": group, "member_id": id, "call_id": "inv:cmd", "receipt_generation": 2, "offset": 6}
	read := func() map[string]any {
		t.Helper()
		value, err := h.conversationCall(context.Background(), rawJSON(p))
		if err != nil {
			t.Fatal(err)
		}
		return value.(map[string]any)
	}
	result := read()["result"].(map[string]any)
	if result["output"] != "最后🙂\n" || result["next_offset"] != float64(len(output)) || result["output_ref"] != nil || sj.cursor != 3 {
		t.Fatal(result, sj.cursor)
	}
	// Reopening reads exactly the retained bytes without allocating a runtime.
	if err := os.WriteFile(filepath.Join(dir, "12.json"), rawJSON(r), 0600); err != nil {
		t.Fatal(err)
	}
	job.shell = nil
	if got := read()["result"].(map[string]any)["output"]; got != "最后🙂\n" || job.shell != nil {
		t.Fatal(got, job.shell)
	}
	for key, value := range map[string]any{"member_id": strings.Repeat("c", 32), "group_id": strings.Repeat("d", 32), "receipt_generation": 9, "call_id": "missing", "offset": -1} {
		previous := p[key]
		p[key] = value
		v, err := h.conversationCall(context.Background(), rawJSON(p))
		if err == nil {
			data, _ := json.Marshal(v)
			if strings.Contains(string(data), "最后") {
				t.Fatalf("foreign %s exposed log: %s", key, data)
			}
		}
		p[key] = previous
	}
	job.record.DeletionPending = true
	if _, err := h.conversationCall(context.Background(), rawJSON(p)); err == nil {
		t.Fatal("deleting member remained readable")
	}
}

func TestConversationTerminalDoesNotInitializeService(t *testing.T) {
	h := &WorkspaceHost{config: t.TempDir()}
	value, err := h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "group_terminal_read", "call_id": "inv:cmd", "receipt_generation": 1, "offset": 0}))
	if err != nil || h.conversations != nil || value.(map[string]any)["unavailable"] != true {
		t.Fatal(value, err)
	}
}

func TestConversationTerminalWaitsForProcessAndRetainsRejectedReceipt(t *testing.T) {
	h, m := receiptConversationFixture(t)
	id, group := strings.Repeat("a", 32), strings.Repeat("b", 32)
	archive := &SessionArchive{ephemeral: true}
	receiptMeta(t, archive, id, 2)
	receiptAppend(t, archive, "tool_intent", ToolIntent{InvocationID: "inv", Response: Message{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: "cmd", Function: FunctionCall{Name: "terminal", Arguments: `{"action":"exec","cmd":"test"}`}}}}})
	job := &agentJob{record: AgentRecord{ID: id, Parent: m.owner, Generation: 2, State: "running", Spec: AgentSpec{Kind: "conversation", GroupID: group}}, archive: archive}
	m.jobs[id] = job
	if err := m.writeGroup(&conversationGroup{ID: group, Host: groupMember{Session: id}}); err != nil {
		t.Fatal(err)
	}
	p := map[string]any{"action": "group_terminal_read", "group_id": group, "member_id": id, "call_id": "inv:cmd", "receipt_generation": 2, "offset": 0}
	value, err := h.conversationCall(context.Background(), rawJSON(p))
	if err != nil || value.(map[string]any)["pending"] != true || job.shell != nil {
		t.Fatal("accepted intent must wait without creating a runtime", value, err)
	}
	receiptAppend(t, archive, "tool_progress", ToolReceipt{Key: "inv:cmd", ToolName: "terminal", Output: `{"ok":false,"state":"rejected","error":{"message":"command rejected before process creation"}}`})
	value, err = h.conversationCall(context.Background(), rawJSON(p))
	if err != nil || value.(map[string]any)["no_process"] != true || job.shell != nil {
		t.Fatal("rejected call must fall back to its original receipt", value, err)
	}
	page, err := m.readSessionReceipt(id, toolReceiptRequest{ID: "inv:cmd", ReceiptGeneration: 2}, true)
	if err != nil || !strings.Contains(string(rawJSON(page)), "command rejected before process creation") {
		t.Fatal("original failure was lost", page, err)
	}
}

func TestConversationPrivateTerminalOwnReceiptWithoutExecution(t *testing.T) {
	h, m := receiptConversationFixture(t)
	id := strings.Repeat("a", 32)
	archive := &SessionArchive{ephemeral: true}
	receiptMeta(t, archive, id, 2)
	receiptAppend(t, archive, "tool_intent", ToolIntent{InvocationID: "inv", Response: Message{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: "cmd", Function: FunctionCall{Name: "terminal", Arguments: `{"action":"exec","cmd":"test"}`}}}}})
	receiptAppend(t, archive, "tool_progress", ToolReceipt{Key: "inv:cmd", ToolName: "terminal", Output: `{"ok":true,"session_id":12,"generation":2,"state":"exited","output":"retained"}`})
	dir := filepath.Join(m.dir, id+".shell")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "12.log"), []byte("retained"), 0600); err != nil {
		t.Fatal(err)
	}
	exit := 0
	result := ShellResult{OK: true, SessionID: 12, Generation: 2, State: "exited", ExitCode: &exit, LoggedBytes: 8}
	if err := os.WriteFile(filepath.Join(dir, "12.json"), rawJSON(result), 0600); err != nil {
		t.Fatal(err)
	}
	job := &agentJob{record: AgentRecord{ID: id, Parent: m.owner, Generation: 2, State: "completed", Spec: AgentSpec{Kind: "conversation"}}, archive: archive}
	m.jobs[id] = job
	p := map[string]any{"action": "terminal_read", "id": id, "call_id": "inv:cmd", "receipt_generation": 2, "offset": 0}
	value, err := h.conversationCall(context.Background(), rawJSON(p))
	if err != nil || value.(map[string]any)["result"].(map[string]any)["output"] != "retained" || job.shell != nil {
		t.Fatal(value, err, job.shell)
	}
	for key, bad := range map[string]any{"id": strings.Repeat("b", 32), "member_id": strings.Repeat("b", 32), "receipt_generation": 3, "offset": -1} {
		old, had := p[key]
		p[key] = bad
		if value, err := h.conversationCall(context.Background(), rawJSON(p)); err == nil {
			bytes, _ := json.Marshal(value)
			if strings.Contains(string(bytes), "retained") {
				t.Fatal("foreign private log exposed bytes", key, value)
			}
		}
		if had {
			p[key] = old
		} else {
			delete(p, key)
		}
	}
	job.record.Spec.GroupID = strings.Repeat("c", 32)
	if _, err := h.conversationCall(context.Background(), rawJSON(p)); err == nil {
		t.Fatal("private endpoint accepted group member")
	}
}
