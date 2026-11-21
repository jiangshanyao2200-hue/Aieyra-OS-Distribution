// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestManagedHistoryRetainsLiveTerminalOwnerAndNestedCells; appendHistoryTerminal; historyTerminalRows; TestWorkspaceHistoryTerminalLaterReceiptAndOriginalPaging; TestWorkspaceHistoryTerminalNaturalExitAfterAgentFinished; historySnapshotShell; TestWorkspaceHistoryTerminalOwnerAndOriginalGeneration; TestWorkspaceHistoryTerminalFailureAndPendingCancellation; TestWorkspaceHistoryTerminalReadFailureAndMissingIdentity
// Impact: python -B scripts/code-atlas.py show Core/workspace_history_terminal_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestManagedHistoryRetainsLiveTerminalOwnerAndNestedCells(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("history must not call a model") })
	w := modeWorkspace(t, m.config, dir, HostOS)
	public := contextTestAction(t, w, "new", nil)["session_id"].(string)
	agent := workspaceID()
	a := &SessionArchive{Path: w.contextArchivePath(w.contextSessionLocked().Archive)}
	shell := shellTestManager(t)
	shell.generation = 1
	zero := 0
	command := shellTestCommand(t, "input")
	command.Background, command.YieldTimeMS = true, &zero
	started := shell.start(context.Background(), command)
	if !started.OK || !started.Pending() {
		t.Fatal("local helper not running", started)
	}
	w.mu.Lock()
	w.state.Roles[WorkspaceMatrix] = agent
	w.mu.Unlock()
	w.manager.mu.Lock()
	w.manager.jobs[agent] = &agentJob{record: AgentRecord{ID: agent, Parent: w.state.ID, State: "completed", Spec: AgentSpec{WorkspaceRole: WorkspaceMatrix}}, archive: a, shell: shell}
	w.manager.mu.Unlock()
	appendMeta := func(owner string) {
		t.Helper()
		if err := a.Append("meta", map[string]any{"workspace_generation": 1, "workspace_agent": owner}); err != nil {
			t.Fatal(err)
		}
	}
	appendMeta(workspaceID())
	old := appendHistoryTerminal(t, a, "old-runtime", "exec_command", string(rawJSON(started)), true)
	appendMeta(agent)
	current := appendHistoryTerminal(t, a, "current-runtime", "exec_command", string(rawJSON(started)), true)
	cellDir := filepath.Join(w.manager.dir, agent+".shell", "cells")
	if err := os.MkdirAll(cellDir, 0700); err != nil {
		t.Fatal(err)
	}
	event := map[string]any{"at": time.Now().UnixMicro(), "type": "nested", "record": map[string]any{"id": 1, "call": ToolCall{Function: FunctionCall{Name: "read_file", Arguments: `{"path":"synthetic"}`}}, "state": "completed", "output": "owned nested receipt"}}
	if err := os.WriteFile(filepath.Join(cellDir, "cell.jsonl"), append(rawJSON(event), '\n'), 0600); err != nil {
		t.Fatal(err)
	}
	read := func(call string) map[string]any {
		t.Helper()
		v, err := w.historyReceipt(rawJSON(map[string]any{"agent_id": public, "id": call}))
		if err != nil {
			t.Fatal(err)
		}
		return v.(map[string]any)
	}
	if read(current)["state"] != "running" || read("cell:1")["output"] != "owned nested receipt" {
		t.Fatal("live owner/nested receipt lost")
	}
	wait := 1000
	ended := shellDone(t, shell, shell.input(context.Background(), ShellInput{SessionID: started.SessionID, Chars: "finish", PressEnter: true, YieldTimeMS: &wait}))
	if ended.ExitCode == nil || *ended.ExitCode != 0 {
		t.Fatal("helper failed to exit", ended)
	}
	if read(current)["state"] != "completed" || read(old)["state"] != "running" {
		t.Fatal("runtime status crossed owner boundary")
	}
}

func appendHistoryTerminal(t *testing.T, a *SessionArchive, id, tool, output string, progress bool) string {
	t.Helper()
	call := ToolCall{ID: id, Function: FunctionCall{Name: tool, Arguments: `{"description":"original input"}`}}
	invocation := "turn-" + id
	if err := a.Append("tool_intent", ToolIntent{InvocationID: invocation, Response: Message{ToolCalls: []ToolCall{call}}}); err != nil {
		t.Fatal(err)
	}
	key := invocation + ":" + id
	receipt := ToolReceipt{Key: key, ToolName: tool, Output: output}
	if progress {
		if err := a.Append("tool_progress", receipt); err != nil {
			t.Fatal(err)
		}
	} else if err := a.Append("tool_turn", ToolTurn{InvocationID: invocation, Messages: []Message{{ToolCalls: []ToolCall{call}}, {Role: RoleTool, ToolCallID: id, Content: output}}, Receipts: []ToolReceipt{receipt}}); err != nil {
		t.Fatal(err)
	}
	return key
}

func historyTerminalRows(t *testing.T, w *Workspace) map[string]historyEntry {
	t.Helper()
	result, err := w.historyPage(rawJSON(map[string]any{"limit": 50}))
	if err != nil {
		t.Fatal(err)
	}
	rows := map[string]historyEntry{}
	for _, row := range result.(map[string]any)["entries"].([]historyEntry) {
		rows[row.ID] = row
	}
	return rows
}

func TestWorkspaceHistoryTerminalLaterReceiptAndOriginalPaging(t *testing.T) {
	w, agent, archive := historyFixture(t)
	initial := ShellResult{OK: true, SessionID: 7, Generation: 3, State: "running", Background: true, Output: strings.Repeat("汉字🙂\n", 16000)}
	original := string(rawJSON(initial))
	start := appendHistoryTerminal(t, archive, "start", "exec_command", original, true)
	read := appendHistoryTerminal(t, archive, "read", "read_shell_output", string(rawJSON(ShellResult{OK: true, SessionID: 7, Generation: 3, State: "running"})), false)
	before := historyTerminalRows(t, w)
	if before[agent+":"+start].State != "running" || before[agent+":"+read].State != "running" {
		t.Fatal("active terminal was completed early", before)
	}
	zero := 0
	finish := appendHistoryTerminal(t, archive, "finish", "write_stdin", string(rawJSON(ShellResult{OK: true, SessionID: 7, Generation: 3, State: "exited", ExitCode: &zero})), false)
	// Commit can repeat the start receipt after another call observed exit.
	call := ToolCall{ID: "start", Function: FunctionCall{Name: "exec_command", Arguments: `{"description":"original input"}`}}
	if err := archive.Append("tool_turn", ToolTurn{InvocationID: "turn-start", Messages: []Message{{ToolCalls: []ToolCall{call}}}, Receipts: []ToolReceipt{{Key: start, ToolName: "exec_command", Output: original}}}); err != nil {
		t.Fatal(err)
	}
	archive.mu.Lock()
	originalArchive := append([]byte(nil), archive.memory...)
	archive.mu.Unlock()
	rows := historyTerminalRows(t, w)
	if len(rows) != 3 {
		t.Fatal("session folding removed call records", len(rows))
	}
	for _, key := range []string{start, read, finish} {
		if rows[agent+":"+key].State != "completed" {
			t.Fatal("later exit did not reconcile the original steps", key, rows[agent+":"+key])
		}
	}
	if before[agent+":"+start].SortKey != rows[agent+":"+start].SortKey || w.history.entries[agent+":"+start].State != "running" {
		t.Fatal("projection rewrote original ordering or indexed receipt state")
	}
	var reconstructed strings.Builder
	offset := 0
	for {
		r, err := w.historyReceipt(rawJSON(map[string]any{"agent_id": agent, "id": start, "output_offset": offset}))
		if err != nil {
			t.Fatal(err)
		}
		part := r.(map[string]any)
		chunk := part["output"].(string)
		if part["state"] != "completed" || !utf8.ValidString(chunk) || len(chunk) > 64<<10 || part["input"] != `{"description":"original input"}` {
			t.Fatal("receipt projection lost its state, input or byte boundaries")
		}
		reconstructed.WriteString(chunk)
		offset = part["next_output"].(int)
		if offset == 0 {
			break
		}
	}
	if reconstructed.String() != original {
		t.Fatal("display status replaced the original running receipt")
	}
	archive.mu.Lock()
	unchanged := bytes.Equal(originalArchive, archive.memory)
	archive.mu.Unlock()
	if !unchanged {
		t.Fatal("reading terminal history mutated the archive")
	}
}

func TestWorkspaceHistoryTerminalNaturalExitAfterAgentFinished(t *testing.T) {
	w, agent, archive := historyFixture(t)
	shell := shellTestManager(t)
	shell.generation = 1
	zero := 0
	command := shellTestCommand(t, "input")
	command.Background, command.YieldTimeMS = true, &zero
	started := shell.start(context.Background(), command)
	if !started.OK || !started.Pending() {
		t.Fatal("local helper did not wait for input", started)
	}
	w.manager.mu.Lock()
	w.manager.jobs[agent].shell = shell
	w.manager.jobs[agent].record.Generation = 2
	w.manager.mu.Unlock()
	key := appendHistoryTerminal(t, archive, "natural", "exec_command", string(rawJSON(started)), true)
	if historyTerminalRows(t, w)[agent+":"+key].State != "running" {
		t.Fatal("finished model turn hid a retained active process")
	}
	wait := 1000
	ended := shellDone(t, shell, shell.input(context.Background(), ShellInput{SessionID: started.SessionID, Chars: "finish", PressEnter: true, YieldTimeMS: &wait}))
	if ended.State != "exited" || ended.ExitCode == nil || *ended.ExitCode != 0 {
		t.Fatal("local helper did not exit naturally", ended)
	}
	// No new tool receipt is appended: only the existing runtime knows it exited.
	if historyTerminalRows(t, w)[agent+":"+key].State != "completed" {
		t.Fatal("natural exit without a later model call stayed running")
	}
	job := shell.job(started.SessionID)
	job.mu.Lock()
	cursor := job.cursor
	job.mu.Unlock()
	shell.mu.Lock()
	rows := historyTerminalRows(t, w)
	shell.mu.Unlock()
	job.mu.Lock()
	unchanged := cursor == job.cursor
	job.mu.Unlock()
	if rows[agent+":"+key].State != "completed" || !unchanged {
		t.Fatal("busy snapshot reverted known exit or history consumed model output")
	}
}

func historySnapshotShell(t *testing.T, result ShellResult) *ShellManager {
	t.Helper()
	shell := shellTestManager(t)
	done := make(chan struct{})
	close(done)
	shell.jobs[result.SessionID] = &shellJob{result: result, manager: shell, done: done}
	return shell
}

func TestWorkspaceHistoryTerminalOwnerAndOriginalGeneration(t *testing.T) {
	w, agent, archive := historyFixture(t)
	zero := 0
	running := string(rawJSON(ShellResult{OK: true, SessionID: 9, Generation: 1, State: "running"}))
	key := appendHistoryTerminal(t, archive, "old", "exec_command", running, true)
	second := ShellResult{OK: true, SessionID: 9, Generation: 2, State: "exited", ExitCode: &zero}
	appendHistoryTerminal(t, archive, "other-generation", "write_stdin", string(rawJSON(second)), false)
	shell := historySnapshotShell(t, second)
	other, foreign := workspaceID(), workspaceID()
	otherArchive, foreignArchive := &SessionArchive{ephemeral: true}, &SessionArchive{ephemeral: true}
	second.Generation = 1
	appendHistoryTerminal(t, otherArchive, "other-owner", "exec_command", string(rawJSON(second)), true)
	appendHistoryTerminal(t, foreignArchive, "foreign", "exec_command", string(rawJSON(second)), true)
	foreignShell := historySnapshotShell(t, second)
	w.manager.mu.Lock()
	w.manager.jobs[agent].shell, w.manager.jobs[agent].record.Generation = shell, 8
	w.manager.jobs[other] = &agentJob{record: AgentRecord{ID: other, Parent: w.state.ID, State: "completed"}, archive: otherArchive}
	w.manager.jobs[foreign] = &agentJob{record: AgentRecord{ID: foreign, Parent: "another-owner", State: "completed"}, archive: foreignArchive, shell: foreignShell}
	w.manager.mu.Unlock()
	rows := historyTerminalRows(t, w)
	if len(rows) != 3 || rows[agent+":"+key].State != "running" {
		t.Fatal("another owner/generation completed this terminal", rows)
	}
	if _, err := w.historyReceipt(rawJSON(map[string]any{"agent_id": foreign, "id": "turn-foreign:foreign"})); err == nil {
		t.Fatal("foreign terminal receipt became readable")
	}
	job := shell.job(9)
	job.mu.Lock()
	job.result.Generation = 1
	job.mu.Unlock()
	if historyTerminalRows(t, w)[agent+":"+key].State != "completed" {
		t.Fatal("current agent turn replaced the retained session generation")
	}
}

func TestWorkspaceHistoryTerminalFailureAndPendingCancellation(t *testing.T) {
	zero, nonzero := 0, 7
	for _, tc := range []struct {
		name, state, want string
		exit              *int
		ok                bool
	}{
		{"nonzero", "exited", "failed", &nonzero, true},
		{"cancel_requested", "cancelled", "running", nil, true},
		{"cancelled", "cancelled", "cancelled", &nonzero, true},
		{"timeout_requested", "timed_out", "running", nil, true},
		{"timed_out", "timed_out", "timed_out", &nonzero, true},
		{"interrupted", "interrupted_unknown", "interrupted_unknown", nil, false},
		{"spawn_failed", "spawn_failed", "failed", nil, false},
		{"success", "exited", "completed", &zero, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w, agent, archive := historyFixture(t)
			key := appendHistoryTerminal(t, archive, "start", "exec_command", string(rawJSON(ShellResult{OK: true, SessionID: 4, Generation: 1, State: "running"})), true)
			shell := historySnapshotShell(t, ShellResult{OK: tc.ok, SessionID: 4, Generation: 1, State: tc.state, ExitCode: tc.exit})
			w.manager.mu.Lock()
			w.manager.jobs[agent].shell = shell
			w.manager.mu.Unlock()
			if row := historyTerminalRows(t, w)[agent+":"+key]; row.State != tc.want {
				t.Fatal("incorrect terminal lifecycle", row.State, tc.want)
			}
		})
	}
}

func TestWorkspaceHistoryTerminalReadFailureAndMissingIdentity(t *testing.T) {
	w, agent, archive := historyFixture(t)
	start := appendHistoryTerminal(t, archive, "start", "exec_command", `{"ok":true,"session_id":3,"generation":1,"state":"running"}`, true)
	badRead := appendHistoryTerminal(t, archive, "bad-read", "read_shell_output", `{"ok":false,"session_id":3,"generation":1,"state":"rejected","error":{"code":"invalid_offset","message":"bad input"}}`, true)
	legacy := appendHistoryTerminal(t, archive, "legacy", "exec_command", `{"ok":true,"session_id":3,"state":"running"}`, true)
	appendHistoryTerminal(t, archive, "different-tool", "memory", `{"ok":true,"session_id":3,"generation":1,"state":"exited","exit_code":0}`, true)
	rows := historyTerminalRows(t, w)
	if rows[agent+":"+start].State != "running" || rows[agent+":"+badRead].State != "failed" || rows[agent+":"+legacy].State != "running" {
		t.Fatal("call failure or unrelated JSON changed the process lifecycle", rows)
	}
	appendHistoryTerminal(t, archive, "finish", "write_stdin", `{"ok":true,"session_id":3,"generation":1,"state":"exited","exit_code":0}`, true)
	rows = historyTerminalRows(t, w)
	if rows[agent+":"+start].State != "completed" || rows[agent+":"+badRead].State != "failed" || rows[agent+":"+legacy].State != "running" {
		t.Fatal("missing original generation was guessed or read failure hidden", rows)
	}
	encoded, _ := json.Marshal(rows[agent+":"+start])
	if strings.Contains(string(encoded), "terminal") {
		t.Fatal("internal execution identity leaked into history protocol")
	}
}
