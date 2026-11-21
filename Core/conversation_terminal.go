// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: conversationTerminal
// Impact: python -B scripts/code-atlas.py show Core/conversation_terminal.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

// Read the process log referenced by an actual group tool receipt. The caller
// cannot choose a shell session/path, start a runtime, or advance its cursor.
func (h *WorkspaceHost) conversationTerminal(raw json.RawMessage) (any, error) {
	var p struct {
		conversationReceiptRequest
		Offset int64 `json:"offset"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if p.Offset < 0 || !validReceiptPage(p.page()) || p.ReceiptGeneration <= 0 {
		return nil, fmt.Errorf("terminal read requires the original receipt and byte offset")
	}
	h.mu.Lock()
	m, closed := h.conversations, h.closed || h.terminal
	h.mu.Unlock()
	if closed || m == nil {
		return receiptUnavailable(false), nil
	}
	target := m.groupReceiptTarget
	if p.Action == "terminal_read" {
		target = m.privateReceiptTarget
	}
	before, err := target(p.conversationReceiptRequest)
	if err != nil {
		return nil, err
	}
	indexed, err := m.readSessionReceipt(before.id, toolReceiptRequest{ID: p.CallID, ReceiptGeneration: p.ReceiptGeneration}, true)
	if err != nil {
		return nil, err
	}
	if value, ok := indexed.(map[string]any); ok && value["ok"] == false {
		return value, nil
	}
	m.mu.Lock()
	job := m.jobs[before.id]
	if job != before.target || job.record.DeletionPending {
		m.mu.Unlock()
		return nil, fmt.Errorf("terminal owner changed")
	}
	history, shell := job.receiptHistory, job.shell
	jobState, jobGeneration := job.record.State, job.record.Generation
	m.mu.Unlock()
	history.mu.Lock()
	entry := history.resolveReceiptIdentity(history.entries[before.id+":"+p.CallID])
	key := entry.terminal
	history.mu.Unlock()
	if entry.identityConflict || entry.Generation != p.ReceiptGeneration || entry.receiptActor != before.id {
		return nil, fmt.Errorf("terminal receipt identity changed")
	}
	switch entry.Title {
	case "terminal", "exec_command", "read_shell_output", "write_stdin":
	default:
		return nil, fmt.Errorf("receipt is not a terminal call")
	}
	if key == (historyTerminalKey{}) {
		// An accepted intent precedes the first process receipt. A rejected
		// command may never own a process; its original receipt remains useful.
		if entry.State == "running" && jobGeneration == entry.Generation && (jobState == "running" || jobState == "queued" || jobState == "cancelling") {
			return receiptUnavailable(true), nil
		}
		return map[string]any{"ok": true, "no_process": true}, nil
	}
	if key.agent != before.id || key.session <= 0 || key.generation <= 0 {
		return nil, fmt.Errorf("receipt does not identify this member's terminal")
	}
	if shell == nil {
		// A read after restart uses only the precise retained metadata/log. It
		// never constructs a live ShellManager or trusts a saved output_ref.
		dir := filepath.Join(m.dir, before.id+".shell")
		data, err := os.ReadFile(filepath.Join(dir, strconv.Itoa(key.session)+".json"))
		if err != nil {
			return nil, fmt.Errorf("retained terminal metadata unavailable")
		}
		var result ShellResult
		if json.Unmarshal(data, &result) != nil || result.SessionID != key.session || result.Generation != key.generation {
			return nil, fmt.Errorf("retained terminal identity changed")
		}
		result.OutputRef = filepath.Join(dir, strconv.Itoa(key.session)+".log")
		if result.Pending() {
			result.State = "interrupted_unknown"
		}
		shell = &ShellManager{jobs: map[int]*shellJob{key.session: {result: result}}}
	}
	session := shell.job(key.session)
	if session == nil {
		return nil, fmt.Errorf("terminal log is unavailable")
	}
	session.mu.Lock()
	generation := session.result.Generation
	session.mu.Unlock()
	if generation != key.generation {
		return nil, fmt.Errorf("terminal generation changed")
	}
	result := shell.read(ShellRead{SessionID: key.session, Offset: p.Offset, MaxOutputTokens: 4096})
	result.OutputRef = ""
	after, err := target(p.conversationReceiptRequest)
	if err != nil || before != after {
		return nil, fmt.Errorf("terminal group membership changed during read")
	}
	h.mu.Lock()
	current := !h.closed && !h.terminal && h.conversations == m
	h.mu.Unlock()
	if !current {
		return nil, fmt.Errorf("terminal service closed")
	}
	var safe map[string]any
	err = json.Unmarshal([]byte(m.redact(string(rawJSON(map[string]any{"ok": true, "group_id": p.GroupID, "member_id": before.id, "call_id": p.CallID, "receipt_generation": p.ReceiptGeneration, "result": result})))), &safe)
	return safe, err
}
