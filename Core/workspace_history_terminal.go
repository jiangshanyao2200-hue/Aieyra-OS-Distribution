// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: historyTerminalKey; historyTerminalState; historyTerminalLifecycle; recordTerminal; projectHistoryTerminals; projectReceiptTerminals
// Impact: python -B scripts/code-atlas.py show Core/workspace_history_terminal.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "encoding/json"

// A retained shell belongs to its original generation even when its agent has
// started another turn. Numeric session IDs alone are not an execution identity.
type historyTerminalKey struct {
	agent               string
	session, generation int
}

type historyTerminalState struct {
	state   string
	pending bool
}

func historyTerminalLifecycle(r ShellResult) (historyTerminalState, bool) {
	switch r.State {
	case "starting", "running", "exited", "completed", "failed", "spawn_failed",
		"cancelled", "timed_out", "interrupted", "interrupted_unknown":
	default:
		// A rejected input/read is a call failure, not a process lifecycle event.
		return historyTerminalState{}, false
	}
	if r.Pending() {
		return historyTerminalState{state: "running", pending: true}, true
	}
	state := "completed"
	switch r.State {
	case "cancelled", "timed_out", "interrupted", "interrupted_unknown":
		state = r.State
	default:
		if !r.OK || r.ExitCode != nil && *r.ExitCode != 0 || r.Error != nil || r.State == "failed" || r.State == "spawn_failed" {
			state = "failed"
		}
	}
	return historyTerminalState{state: state}, true
}

// The archive index keeps only a small identity/status projection. Original
// input/output offsets and the receipt bytes are never rewritten or combined.
func (h *workspaceHistory) recordTerminal(v *historyEntry, output string) {
	v.terminal = historyTerminalKey{}
	switch v.Title {
	case "terminal", "exec_command", "read_shell_output", "write_stdin":
	default:
		return
	}
	// Do not decode/copy the potentially large output field into the index.
	var r struct {
		OK         bool        `json:"ok"`
		Session    int         `json:"session_id"`
		Generation int         `json:"generation"`
		State      string      `json:"state"`
		Exit       *int        `json:"exit_code"`
		Error      *ShellError `json:"error"`
	}
	if json.Unmarshal([]byte(output), &r) != nil || v.Agent == "" || r.Session <= 0 || r.Generation <= 0 {
		return
	}
	state, valid := historyTerminalLifecycle(ShellResult{OK: r.OK, State: r.State, SessionID: r.Session, Generation: r.Generation, ExitCode: r.Exit, Error: r.Error})
	if !valid {
		return
	}
	agent := v.Agent
	if source := v.output.source; source.runtimeAgent != "" {
		agent = source.runtimeAgent
	}
	v.terminal = historyTerminalKey{agent: agent, session: r.Session, generation: r.Generation}
	if h.terminals == nil {
		h.terminals = map[historyTerminalKey]historyTerminalState{}
	}
	// A tool_turn can repeat an earlier running receipt after a later call in
	// that same turn observed exit. One process identity cannot start again.
	if prior, exists := h.terminals[v.terminal]; !exists || prior.pending || !state.pending {
		h.terminals[v.terminal] = state
	}
}

// Called with history.mu held; rows are response copies, not indexed entries.
// Read each owned shell once without starting/restoring a runtime or consuming
// its output cursor. Busy snapshots leave the recorded lifecycle evidence intact.
func (w *Workspace) projectHistoryTerminals(rows []historyEntry) {
	owners := make(map[string]*ShellManager)
	for _, v := range rows {
		if v.terminal.agent != "" {
			owners[v.terminal.agent] = nil
		}
	}
	if len(owners) == 0 {
		return
	}
	w.mu.Lock()
	root := w.state.ID
	w.mu.Unlock()
	w.manager.mu.Lock()
	for agent := range owners {
		if job := w.manager.jobs[agent]; job != nil && w.manager.ownsLocked(root, agent) {
			owners[agent] = job.shell
		}
	}
	w.manager.mu.Unlock()
	projectReceiptTerminals(&w.history, rows, owners)
}

// Shell pointers are supplied only by the authorised owner. TrySnapshots never
// resumes a process or advances either the model or user output cursor.
func projectReceiptTerminals(h *workspaceHistory, rows []historyEntry, owners map[string]*ShellManager) {
	states := make(map[historyTerminalKey]historyTerminalState)
	for _, v := range rows {
		if v.terminal.agent == "" || v.State == "failed" {
			continue
		}
		if state, exists := h.terminals[v.terminal]; exists {
			states[v.terminal] = state
		}
	}
	for agent, shell := range owners {
		if shell == nil {
			continue
		}
		snapshots, ready := shell.TrySnapshots()
		if !ready {
			continue
		}
		for _, r := range snapshots {
			key := historyTerminalKey{agent: agent, session: r.SessionID, generation: r.Generation}
			prior, needed := states[key]
			if !needed {
				continue
			}
			if current, valid := historyTerminalLifecycle(r); valid && (prior.pending || !current.pending) {
				states[key] = current
				h.terminals[key] = current
			}
		}
	}
	for i := range rows {
		// Keep a call's own input/read failure visible even if its process lives.
		if rows[i].State != "failed" {
			if state, exists := states[rows[i].terminal]; exists {
				rows[i].State = state.state
			}
		}
	}
}
