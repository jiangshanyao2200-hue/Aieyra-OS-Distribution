// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: toolReceiptRequest; toolReceiptSource; receiptUnavailable; receiptChanged; validReceiptCall; validReceiptPage; initReceiptIndex; bindReceiptIdentity; receiptOutputRef; resolveReceiptIdentity; receiptCellSources; indexReceiptSources; receiptText; receiptPage; historyChunk; workspaceReceiptView; receiptView; checkReceiptView; toolReceipt; decodeReceiptText
// Impact: python -B scripts/code-atlas.py show Core/tool_receipt_read.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// Receipt reads use the existing append-only archives. They never restore an
// executor, create a shell, advance its cursor, or contact a model/provider.
import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

type toolReceiptRequest struct {
	TaskID            string `json:"task_id"`
	Agent             string `json:"agent_id"`
	ID                string `json:"id"`
	EntryID           string `json:"entry_id"`
	Segment           string `json:"segment"`
	AllHistory        bool   `json:"all_history"`
	Generation        int    `json:"generation"`
	CoreEpoch         string `json:"core_epoch"`
	ReceiptGeneration int    `json:"receipt_generation"`
	ReceiptVersion    string `json:"receipt_version"`
	MemberID          string `json:"member_id"`
	InputOffset       int    `json:"input_offset"`
	OutputOffset      int    `json:"output_offset"`
}

type toolReceiptSource struct {
	SessionID  string `json:"session_id"`
	AgentID    string `json:"agent_id"`
	Generation int    `json:"generation"`
	CallID     string `json:"call_id"`
}

func receiptUnavailable(pending bool) map[string]any {
	if pending {
		return map[string]any{"ok": false, "code": "receipt_pending", "pending": true}
	}
	return map[string]any{"ok": false, "code": "receipt_unavailable", "unavailable": true, "pending": false, "error": "原始回执暂时不可用，请重新展开。"}
}

func receiptChanged() map[string]any {
	return map[string]any{"ok": false, "code": "receipt_changed", "changed": true, "reload_required": true}
}

func validReceiptCall(id string) bool {
	return id != "" && len(id) <= 512 && utf8.ValidString(id) && !strings.ContainsAny(id, "\x00\r\n")
}

func validReceiptPage(p toolReceiptRequest) bool {
	return validReceiptCall(p.ID) && p.InputOffset >= 0 && p.OutputOffset >= 0 &&
		p.Generation >= 0 && p.ReceiptGeneration >= 0 && len(p.ReceiptVersion) <= 128 && len(p.CoreEpoch) <= 128
}

func (h *workspaceHistory) initReceiptIndex() {
	if h.offsets == nil {
		h.offsets = map[string]int64{}
	}
	if h.entries == nil {
		h.entries = map[string]historyEntry{}
	}
	if h.terminals == nil {
		h.terminals = map[historyTerminalKey]historyTerminalState{}
	}
	if h.generations == nil {
		h.generations = map[string]int{}
	}
	if h.runtimeAgents == nil {
		h.runtimeAgents = map[string]string{}
	}
	if h.cellParents == nil {
		h.cellParents = map[string]string{}
	}
}

// Only an input-bearing record can establish the original actor/generation.
// A late progress/turn must keep that identity across subsequent meta records.
func (h *workspaceHistory) bindReceiptIdentity(v *historyEntry, ref historyRef) {
	actor, generation := ref.source.runtimeAgent, ref.generation
	if !sessionIDPattern.MatchString(actor) || generation <= 0 || !ref.source.managed && actor != ref.source.agent {
		return
	}
	if v.receiptActor != "" && (v.receiptActor != actor || v.Generation != generation) {
		v.identityConflict = true
		return
	}
	v.receiptActor, v.Generation = actor, generation
}

func receiptOutputRef(v historyEntry, ref historyRef) historyRef {
	if v.receiptActor != "" {
		ref.source.runtimeAgent, ref.generation = v.receiptActor, v.Generation
	}
	return ref
}

func (h *workspaceHistory) resolveReceiptIdentity(v historyEntry) historyEntry {
	if v.parentCall != "" {
		parent, exists := h.entries[v.Agent+":"+v.parentCall]
		if !exists || parent.identityConflict || parent.receiptActor == "" ||
			v.input.source.runtimeAgent != parent.receiptActor {
			v.identityConflict = true
			return v
		}
		v.receiptActor, v.Generation = parent.receiptActor, parent.Generation
		v.input = receiptOutputRef(v, v.input)
		v.output = receiptOutputRef(v, v.output)
	}
	return v
}

// Parent archives are indexed before cells, so start.Key can be checked against
// the actual full parent call ID. Historical actors come only from those archives.
func (h *workspaceHistory) receiptCellSources(base []historySource) []historySource {
	var cells []historySource
	seen := map[string]bool{}
	for _, source := range base {
		if source.agent == "" || source.cell != "" || source.shellRoot == "" {
			continue
		}
		actors := map[string]bool{}
		actor := source.runtimeAgent
		if !source.managed {
			actor = source.agent
		}
		if sessionIDPattern.MatchString(actor) {
			actors[actor] = true
		}
		for _, entry := range h.entries {
			if entry.Agent == source.agent && entry.receiptActor != "" && !entry.identityConflict {
				actors[entry.receiptActor] = true
			}
		}
		for actor := range actors {
			paths, _ := filepath.Glob(filepath.Join(source.shellRoot, actor+".shell", "cells", "*.jsonl"))
			for _, path := range paths {
				cell := strings.TrimSuffix(filepath.Base(path), ".jsonl")
				key := source.agent + "/" + actor + "/" + cell
				if seen[key] {
					continue
				}
				seen[key] = true
				cells = append(cells, historySource{key: key, agent: source.agent, runtimeAgent: actor, cell: cell, path: path, managed: source.managed, shellRoot: source.shellRoot})
			}
		}
	}
	sort.Slice(cells, func(i, j int) bool { return cells[i].key < cells[j].key })
	return cells
}

// One bounded incremental scan per explicit read; pending never schedules work.
func (h *workspaceHistory) indexReceiptSources(sources []historySource) (bool, error) {
	h.initReceiptIndex()
	budget, pending := 2<<20, false
	var warnings []string
	scan := func(s historySource) {
		if budget <= 0 {
			pending = true
			return
		}
		next, more, err := historyScan(s, h.offsets[s.key], &budget, h.visit)
		h.offsets[s.key] = next
		pending = pending || more
		if err != nil {
			warnings = append(warnings, "部分历史无法读取："+err.Error())
		}
	}
	for _, source := range sources {
		scan(source)
	}
	for _, source := range h.receiptCellSources(sources) {
		scan(source)
	}
	if len(warnings) > 0 {
		return pending, fmt.Errorf("%s", strings.Join(warnings, "；"))
	}
	return pending, nil
}

func receiptText(v historyEntry) (string, string, error) { return decodeReceiptText(v, nil) }

// The version hashes the exact complete records used by this decode, their
// identity, and the public lifecycle projection. No second read can change pages.
func receiptPage(m *AgentManager, v historyEntry, p toolReceiptRequest, pending, requireSource bool) (map[string]any, error) {
	if v.identityConflict || requireSource && (v.receiptActor == "" || v.Generation <= 0) ||
		p.ReceiptGeneration > 0 && p.ReceiptGeneration != v.Generation {
		return receiptUnavailable(false), nil
	}
	var source *toolReceiptSource
	if v.receiptActor != "" && v.Generation > 0 {
		source = &toolReceiptSource{SessionID: v.Agent, AgentID: v.receiptActor, Generation: v.Generation, CallID: v.Call}
	}
	digest := sha256.New()
	meta, _ := json.Marshal(struct {
		Source                                       *toolReceiptSource
		Call, Tool, State                            string
		InputKind, InputCall, OutputKind, OutputCall string
	}{source, v.Call, v.Title, v.State, v.input.kind, v.input.call, v.output.kind, v.output.call})
	digest.Write(meta)
	in, out, err := decodeReceiptText(v, func(data []byte) { fmt.Fprintf(digest, "%d:", len(data)); digest.Write(data) })
	if err != nil {
		return nil, err
	}
	in, out = m.redact(in), m.redact(out)
	fmt.Fprintf(digest, "%d:", len(in))
	digest.Write([]byte(in))
	fmt.Fprintf(digest, "%d:", len(out))
	digest.Write([]byte(out))
	version := hex.EncodeToString(digest.Sum(nil))
	if p.ReceiptVersion != "" && p.ReceiptVersion != version {
		return receiptChanged(), nil
	}
	input, nextInput, err := historyChunk(in, p.InputOffset)
	if err != nil {
		return nil, err
	}
	output, nextOutput, err := historyChunk(out, p.OutputOffset)
	if err != nil {
		return nil, err
	}
	result := map[string]any{"ok": true, "input": input, "output": output, "next_input": nextInput, "next_output": nextOutput,
		"input_size": len(in), "output_size": len(out), "tool": v.Title, "state": v.State, "pending": pending, "receipt_version": version}
	if source != nil {
		result["source"], result["receipt_generation"] = *source, v.Generation
	}
	return result, nil
}

// UTF-8 byte offsets are bounded independently on both sides of a receipt.
func historyChunk(text string, offset int) (string, int, error) {
	if offset < 0 || offset > len(text) || offset < len(text) && !utf8.RuneStart(text[offset]) {
		return "", 0, fmt.Errorf("收据位置无效，请重新展开")
	}
	end := min(len(text), offset+(64<<10))
	for end < len(text) && !utf8.RuneStart(text[end]) {
		end--
	}
	next := 0
	if end < len(text) {
		next = end
	}
	return text[offset:end], next, nil
}

type workspaceReceiptView struct {
	root, session, archive, epoch, primary, actor string
	manager                                       *AgentManager
	job                                           *agentJob
	generation                                    int
	boundArchive                                  *SessionArchive
}

func (w *Workspace) receiptView(p toolReceiptRequest) (workspaceReceiptView, error) {
	w.mu.Lock()
	v := workspaceReceiptView{root: w.state.ID, epoch: w.epoch, primary: w.state.Roles[WorkspaceMatrix]}
	if s := w.contextSessionLocked(); s != nil {
		v.session, v.archive = s.ID, s.Archive
	}
	closed := w.closed
	role := false
	for _, id := range w.state.Roles {
		role = role || id != "" && id == p.Agent
	}
	w.mu.Unlock()
	if closed || !sessionIDPattern.MatchString(p.Agent) || !validReceiptPage(p) || p.CoreEpoch != "" && p.CoreEpoch != v.epoch {
		return v, fmt.Errorf("receipt scope is unavailable or changed")
	}
	if p.Generation > 0 && (p.TaskID == "" || p.CoreEpoch == "") {
		return v, fmt.Errorf("receipt requires the task, actor, generation and core epoch")
	}
	if p.TaskID != "" && p.TaskID != v.root && p.Agent != p.TaskID {
		return v, fmt.Errorf("receipt actor does not belong to the selected task")
	}
	if p.Agent == v.session && p.Generation == 0 {
		v.actor = v.primary
	} else {
		v.actor = p.Agent
	}
	if p.Generation > 0 && p.TaskID == v.root && !role {
		return v, fmt.Errorf("receipt actor is no longer a workspace role")
	}
	v.manager, _ = w.manager.taskManager(v.root, v.actor)
	v.manager.mu.Lock()
	v.job = v.manager.jobs[v.actor]
	if v.job != nil {
		owner := v.root
		if v.manager != w.manager {
			owner = v.manager.owner
			if v.manager.packageService {
				owner = "primary"
			}
		}
		if !v.manager.ownsLocked(owner, v.actor) || v.job.record.DeletionPending {
			v.manager.mu.Unlock()
			return v, fmt.Errorf("receipt task is not owned by caller")
		}
		v.generation, v.boundArchive = v.job.record.Generation, v.job.archive
	}
	v.manager.mu.Unlock()
	if v.job == nil && !(p.Agent == v.session && v.session != "" && p.Generation == 0) {
		return v, fmt.Errorf("receipt actor unavailable")
	}
	if p.Generation > 0 && p.Generation != v.generation {
		return v, fmt.Errorf("receipt view generation changed")
	}
	return v, nil
}

func (w *Workspace) checkReceiptView(p toolReceiptRequest, before workspaceReceiptView) error {
	after, err := w.receiptView(p)
	if err != nil {
		return err
	}
	if after != before {
		return fmt.Errorf("receipt view changed during read; reopen the record")
	}
	return nil
}

func (w *Workspace) toolReceipt(p toolReceiptRequest) (any, error) {
	owner, err := w.taskOwner(p.TaskID)
	if err != nil {
		return nil, err
	}
	if owner != w {
		return owner.toolReceipt(p)
	}
	view, err := w.receiptView(p)
	if err != nil {
		return nil, err
	}
	if p.MemberID != "" {
		return w.linkMemberReceipt(p, view)
	}
	// Current non-primary roles/tasks have their own existing archives. Managed
	// primary history instead follows the selected persistent context and versions.
	if p.Agent != view.primary && p.Agent != view.session && p.Generation > 0 {
		result, err := view.manager.readSessionReceipt(p.Agent, p, true)
		if err != nil {
			return nil, err
		}
		if err = w.checkReceiptView(p, view); err != nil {
			return nil, err
		}
		return result, nil
	}
	h := &w.history
	h.mu.Lock()
	defer h.mu.Unlock()
	pending, indexErr := w.indexHistoryLocked()
	entry, found := h.entries[p.Agent+":"+p.ID]
	if !found && p.Agent == view.primary && view.session != "" {
		entry, found = h.entries[view.session+":"+p.ID]
	}
	if !found {
		if indexErr != nil {
			return nil, indexErr
		}
		if err = w.checkReceiptView(p, view); err != nil {
			return nil, err
		}
		return receiptUnavailable(pending), nil
	}
	entry = h.resolveReceiptIdentity(entry)
	if p.TaskID != "" && p.TaskID != view.root && entry.Agent != p.TaskID {
		return nil, fmt.Errorf("receipt does not belong to the selected task")
	}
	rows := []historyEntry{entry}
	w.projectHistoryTerminals(rows)
	requireSource := p.Generation > 0 || p.ReceiptGeneration > 0 || p.CoreEpoch != ""
	result, err := receiptPage(w.manager, rows[0], p, pending, requireSource)
	if err != nil {
		return nil, err
	}
	if err = w.checkReceiptView(p, view); err != nil {
		return nil, err
	}
	return result, nil
}

func decodeReceiptText(v historyEntry, record func([]byte)) (string, string, error) {
	input, output := "", ""
	var call ToolCall
	for i, ref := range []historyRef{v.input, v.output} {
		data, err := historyRead(ref)
		if err != nil {
			return "", "", err
		}
		if record != nil {
			record(data)
		}
		if len(data) == 0 {
			continue
		}
		var e struct {
			Value json.RawMessage `json:"value"`
		}
		if err = json.Unmarshal(data, &e); err != nil {
			return "", "", err
		}
		switch ref.kind {
		case "nested":
			var n cellEvent
			_ = json.Unmarshal(data, &n)
			if n.Record != nil {
				call = n.Record.Call
				if i == 0 {
					input = n.Record.Call.Function.Arguments
				} else {
					output = n.Record.Output
				}
			}
		case "tool_intent":
			var t ToolIntent
			_ = json.Unmarshal(e.Value, &t)
			for _, c := range t.Response.ToolCalls {
				if c.ID == ref.call {
					call = c
					input = c.Function.Arguments
				}
			}
		case "tool_progress":
			var r ToolReceipt
			_ = json.Unmarshal(e.Value, &r)
			output = r.Output
			if r.Patch != nil {
				output = string(rawJSON(r.Patch))
			}
		case "tool_turn":
			var t ToolTurn
			_ = json.Unmarshal(e.Value, &t)
			if i == 0 && len(t.Messages) > 0 {
				for _, c := range t.Messages[0].ToolCalls {
					if c.ID == ref.call {
						call = c
						input = c.Function.Arguments
					}
				}
			}
			if i == 1 {
				for _, m := range t.Messages {
					if m.ToolCallID == ref.call {
						output = m.Content
					}
				}
				for _, r := range t.Receipts {
					if r.Key == t.InvocationID+":"+ref.call {
						output = r.Output
						if r.Patch != nil {
							output = string(rawJSON(r.Patch))
						}
						break
					}
				}
			}
		case "message":
			var m Message
			_ = json.Unmarshal(e.Value, &m)
			input = m.Content
		case "host_message":
			var event WorkspaceEvent
			var m workspaceMessage
			_ = json.Unmarshal(e.Value, &event)
			_ = json.Unmarshal(rawJSON(event.Data), &m)
			input = m.Text
		case "thinking", "tool_thinking":
			var m Message
			if ref.kind == "tool_thinking" {
				var t ToolIntent
				_ = json.Unmarshal(e.Value, &t)
				m = t.Response
			} else {
				_ = json.Unmarshal(e.Value, &m)
			}
			if parts := m.PublicReasoning(); ref.reasoning >= 0 && ref.reasoning < len(parts) {
				input = parts[ref.reasoning].Text
			}
		default:
			input = string(e.Value)
		}
	}
	args := activityArgs(call)
	action := activityText(args, "action")
	if programDelegationAction(call.Function.Name, action) {
		return string(programReceiptInput(action, args)), string(programReceiptOutput(output)), nil
	}
	return input, output, nil
}
