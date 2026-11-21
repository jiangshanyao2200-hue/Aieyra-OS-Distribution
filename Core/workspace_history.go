// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: historySource; historyRef; historyEntry; workspaceHistory; resetHistoryLocked; historySources; historyScan; recordReasoning; visit; indexHistoryLocked; historyRead; receiptText; historyPage; historyTurnsPerPage; numberedHistory; historyMatches; searchHistoryRows; historyKey; historyOutputState; historyReceipt
// Impact: python -B scripts/code-atlas.py show Core/workspace_history.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// History is a read-only, paged projection of original receipts. The index
// retains offsets, not another copy of tool output, and never restores a job.
import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

type historySource struct {
	key, agent, cell, path string
	shellRoot              string
	runtimeAgent           string
	archive                *SessionArchive
	managed                bool
}
type historyRef struct {
	source     historySource
	offset     int64
	size       int
	kind, call string
	reasoning  int
	generation int
}
type historyEntry struct {
	ID            string `json:"id"`
	SortKey       string `json:"sort_key,omitempty"`
	Kind          string `json:"kind"`
	At            string `json:"at"`
	Agent         string `json:"agent_id,omitempty"`
	Role          string `json:"role,omitempty"`
	Truncated     bool   `json:"truncated,omitempty"`
	Call          string `json:"call_id,omitempty"`
	Generation    int    `json:"generation,omitempty"`
	Round         string `json:"round_id,omitempty"`
	Title         string `json:"title"`
	ReasoningKind string `json:"reasoning_kind,omitempty"`
	State         string `json:"state,omitempty"`
	Text          string `json:"text,omitempty"`
	DocumentID    string `json:"document_id,omitempty"`
	TextMore      bool   `json:"text_more,omitempty"`
	Unavailable   bool   `json:"unavailable,omitempty"`
	Summary       string `json:"summary,omitempty"`
	Compaction    bool   `json:"compaction,omitempty"`
	SnapshotID    string `json:"snapshot_id,omitempty"`
	// Files Eyra delivered with this reply; history keeps their open entries.
	Artifacts         []WorkspaceArtifact  `json:"artifacts,omitempty"`
	Attachments       []ComposerAttachment `json:"attachments,omitempty"`
	input, output     historyRef
	terminal          historyTerminalKey
	chatKey, chatName string
	receiptActor      string
	identityConflict  bool
	parentCall        string
}
type workspaceHistory struct {
	mu              sync.Mutex
	scope           string
	offsets         map[string]int64
	entries         map[string]historyEntry
	terminals       map[historyTerminalKey]historyTerminalState
	generations     map[string]int
	chatOccurrences map[string]int
	runtimeAgents   map[string]string
	cellParents     map[string]string
	receiptArchive  *SessionArchive
}

func (w *Workspace) resetHistoryLocked() {
	w.state.HistorySegment = workspaceID()
	w.state.HistoryAfter = time.Now().UTC().Format(time.RFC3339Nano)
	w.state.Revision++
	w.feed.publish(WorkspaceMatrix, "history_reset", map[string]any{"segment": w.state.HistorySegment})
}

func (w *Workspace) historySources() []historySource {
	if w.historySession != "" {
		m := w.manager
		m.mu.Lock()
		defer m.mu.Unlock()
		j := m.jobs[w.historySession]
		if j == nil || j.record.DeletionPending {
			return nil
		}
		path := filepath.Join(m.dir, "sessions", j.record.ID+".jsonl")
		if j.archive != nil && j.archive.Path != "" {
			path = j.archive.Path
		}
		return []historySource{{key: j.record.ID, agent: j.record.ID, runtimeAgent: j.record.ID, path: path, archive: j.archive, shellRoot: m.dir, managed: true}}
	}
	w.mu.Lock()
	var managed []historySource
	if s := w.contextSessionLocked(); s != nil {
		seen := map[string]bool{}
		for _, archive := range append(append([]string{}, s.Versions...), s.Archive) {
			if !seen[archive] {
				managed = append(managed, historySource{key: "context/" + archive, agent: s.ID, runtimeAgent: w.state.Roles[WorkspaceMatrix], path: w.contextArchivePath(archive), managed: true, shellRoot: w.manager.dir})
				seen[archive] = true
			}
		}
	}
	w.mu.Unlock()
	m := w.manager
	m.mu.Lock()
	sources := make([]historySource, 0, len(m.jobs))
	for id, j := range m.jobs {
		if len(managed) > 0 && j.record.Spec.WorkspaceRole != "" {
			continue
		}
		if m.ownsLocked(w.state.ID, id) {
			path := filepath.Join(m.dir, "sessions", id+".jsonl")
			if j.archive != nil && j.archive.Path != "" {
				path = j.archive.Path
			}
			sources = append(sources, historySource{key: id, agent: id, path: path, archive: j.archive, shellRoot: m.dir})
		}
	}
	m.mu.Unlock()
	for _, service := range []*AgentManager{m.workboxHost.Load(), m.packageHost.Load()} {
		if service == nil {
			continue
		}
		service.mu.Lock()
		for id, j := range service.jobs {
			if service.ownsLocked(service.owner, id) {
				sources = append(sources, historySource{key: id, agent: id, path: filepath.Join(service.dir, "sessions", id+".jsonl"), archive: j.archive, shellRoot: service.dir})
			}
		}
		service.mu.Unlock()
	}
	sources = append(sources, managed...)
	sort.Slice(sources, func(i, j int) bool { return sources[i].key < sources[j].key })
	w.feed.mu.Lock()
	a := w.feed.archive
	w.feed.mu.Unlock()
	if a != nil && len(managed) == 0 {
		sources = append(sources, historySource{key: "host", path: a.Path, archive: a})
	}
	return sources
}

// Each request scans a bounded amount of newly appended data. Partial trailing
// records are left pending; callers can continue indexing without replaying.
func historyScan(s historySource, offset int64, budget *int, visit func([]byte, historyRef) error) (int64, bool, error) {
	var reader *bufio.Reader
	var size int64
	var file *os.File
	if s.archive != nil && s.archive.ephemeral {
		a := s.archive
		a.mu.Lock()
		size = int64(len(a.memory))
		if offset < 0 || offset > size {
			a.mu.Unlock()
			return offset, false, fmt.Errorf("invalid history offset")
		}
		end := min(size, offset+int64(*budget))
		if end < size {
			if n := bytes.IndexByte(a.memory[end:], '\n'); n >= 0 {
				end += int64(n) + 1
			}
		}
		if end-offset > 8<<20 {
			a.mu.Unlock()
			return offset, false, fmt.Errorf("history event exceeds 8 MiB")
		}
		data := append([]byte(nil), a.memory[offset:end]...)
		a.mu.Unlock()
		reader = bufio.NewReader(bytes.NewReader(data))
	} else {
		var err error
		file, err = os.Open(s.path)
		if os.IsNotExist(err) {
			return offset, false, nil
		}
		if err != nil {
			return offset, false, err
		}
		defer file.Close()
		stat, err := file.Stat()
		if err != nil {
			return offset, false, err
		}
		size = stat.Size()
		if offset < 0 || offset > size {
			return offset, false, fmt.Errorf("history archive changed")
		}
		if _, err = file.Seek(offset, io.SeekStart); err != nil {
			return offset, false, err
		}
		reader = bufio.NewReader(io.LimitReader(file, size-offset))
	}
	for offset < size && *budget > 0 {
		// ReadSlice prevents a malformed unbounded line from allocating the archive.
		line := make([]byte, 0, 4096)
		for {
			p, e := reader.ReadSlice('\n')
			line = append(line, p...)
			if len(line) > 8<<20 {
				return offset, false, fmt.Errorf("history event exceeds 8 MiB")
			}
			if e == bufio.ErrBufferFull {
				continue
			}
			if e == io.EOF {
				return offset, offset < size, nil
			}
			if e != nil {
				return offset, false, e
			}
			break
		}
		if !json.Valid(line) {
			return offset, false, fmt.Errorf("invalid history event")
		}
		ref := historyRef{source: s, offset: offset, size: len(line)}
		if err := visit(line, ref); err != nil {
			return offset, false, err
		}
		offset += int64(len(line))
		*budget -= len(line)
	}
	return offset, offset < size, nil
}

func (h *workspaceHistory) recordReasoning(m Message, ref historyRef, at, kind string) {
	baseID := ref.source.key + ":thinking:" + strconv.FormatInt(ref.offset, 10)
	for i, part := range m.PublicReasoning() {
		id := baseID
		if i > 0 {
			id += fmt.Sprintf(":%08d", i)
		}
		title := "思考（来源类别未知）"
		switch part.Kind {
		case "text":
			title = "公开思考"
		case "summary":
			title = "思考摘要"
		}
		thoughtRef := ref
		thoughtRef.kind, thoughtRef.reasoning = kind, i
		h.entries[id] = historyEntry{ID: id, Kind: "thinking", At: at, Agent: ref.source.agent, Title: title, ReasoningKind: part.Kind, input: thoughtRef}
	}
}

func (h *workspaceHistory) visit(data []byte, ref historyRef) error {
	h.initReceiptIndex()
	s := ref.source
	if s.cell == "" {
		// Persisted runtime ownership prevents an old shell's numeric session and
		// generation from accidentally matching a new process after reopening.
		ref.source.runtimeAgent = h.runtimeAgents[s.key]
		ref.generation = h.generations[s.key]
	}
	if s.cell != "" {
		var event cellEvent
		if err := json.Unmarshal(data, &event); err != nil {
			return err
		}
		if event.Type == "start" {
			if prior := h.cellParents[s.key]; prior != "" && prior != event.Key {
				h.cellParents[s.key] = "!conflict"
			} else if prior == "" {
				h.cellParents[s.key] = event.Key
			}
			return nil
		}
		if event.Type != "nested" || event.Record == nil {
			return nil
		}
		r := event.Record
		id := s.agent + ":" + s.cell + ":" + strconv.Itoa(r.ID)
		v := h.entries[id]
		if v.ID == "" {
			v = historyEntry{ID: id, Kind: "tool", At: time.UnixMicro(event.At).UTC().Format(time.RFC3339Nano), Agent: s.agent, Call: s.cell + ":" + strconv.Itoa(r.ID), Title: r.Call.Function.Name}
		}
		if v.input.size > 0 && v.input.source.runtimeAgent != s.runtimeAgent || v.parentCall != "" && v.parentCall != h.cellParents[s.key] {
			v.identityConflict = true
		}
		v.parentCall = h.cellParents[s.key]
		ref.kind = "nested"
		v.State = r.State
		v.input = ref
		if r.Output != "" {
			v.output = ref
			h.recordTerminal(&v, r.Output)
		}
		h.entries[id] = v
		return nil
	}
	var e struct {
		Kind  string          `json:"kind"`
		At    string          `json:"at"`
		Value json.RawMessage `json:"value"`
	}
	if err := json.Unmarshal(data, &e); err != nil {
		return err
	}
	ref.kind = e.Kind
	switch e.Kind {
	case "meta":
		{
			var meta struct {
				Generation int    `json:"workspace_generation"`
				Agent      string `json:"workspace_agent"`
			}
			if err := json.Unmarshal(e.Value, &meta); err != nil {
				return err
			}
			if meta.Generation > 0 {
				h.generations[s.key] = meta.Generation
				h.runtimeAgents[s.key] = ""
				if sessionIDPattern.MatchString(meta.Agent) && (s.managed || meta.Agent == s.agent) {
					h.runtimeAgents[s.key] = meta.Agent
				}
			}
		}
	case "tool_intent":
		var intent ToolIntent
		if err := json.Unmarshal(e.Value, &intent); err != nil {
			return err
		}
		h.recordReasoning(intent.Response, ref, e.At, "tool_thinking")
		for _, call := range intent.Response.ToolCalls {
			key := intent.InvocationID + ":" + call.ID
			id := s.agent + ":" + key
			v := h.entries[id]
			v.ID = id
			v.Kind = "tool"
			v.Agent = s.agent
			v.Call = key
			v.Title = call.Function.Name
			v.At = e.At
			v.State = "running"
			ref.call = call.ID
			h.bindReceiptIdentity(&v, ref)
			v.input = ref
			h.entries[id] = v
		}
	case "tool_progress":
		var r ToolReceipt
		if err := json.Unmarshal(e.Value, &r); err != nil {
			return err
		}
		id := s.agent + ":" + r.Key
		v := h.entries[id]
		if v.ID == "" {
			v = historyEntry{ID: id, Kind: "tool", At: e.At, Agent: s.agent, Call: r.Key, Title: r.ToolName}
		}
		v.output = receiptOutputRef(v, ref)
		v.State = historyOutputState(r.Output)
		h.recordTerminal(&v, r.Output)
		h.entries[id] = v
	case "tool_turn":
		var turn ToolTurn
		if err := json.Unmarshal(e.Value, &turn); err != nil {
			return err
		}
		if len(turn.Messages) == 0 {
			return nil
		}
		for _, call := range turn.Messages[0].ToolCalls {
			key := turn.InvocationID + ":" + call.ID
			id := s.agent + ":" + key
			v := h.entries[id]
			if v.ID == "" {
				v = historyEntry{ID: id, Kind: "tool", At: e.At, Agent: s.agent, Call: key, Title: call.Function.Name}
				ref.call = call.ID
				h.bindReceiptIdentity(&v, ref)
				v.input = ref
			}
			ref.call = call.ID
			v.output = receiptOutputRef(v, ref)
			v.State = "completed"
			output := ""
			for _, message := range turn.Messages {
				if message.ToolCallID == call.ID {
					output = message.Content
					break
				}
			}
			for _, r := range turn.Receipts {
				if r.Key == key {
					output = r.Output
					v.State = historyOutputState(r.Output)
					break
				}
			}
			h.recordTerminal(&v, output)
			h.entries[id] = v
		}
	case "message":
		// Workspace chat is projected separately with its authoritative send state.
		var m Message
		if err := json.Unmarshal(e.Value, &m); err != nil {
			return err
		}
		if m.Role == RoleAssistant {
			h.recordReasoning(m, ref, e.At, "thinking")
		}
		if m.Content == "" {
			return nil
		}
		id := s.key + ":" + strconv.FormatInt(ref.offset, 10)
		entry := historyEntry{ID: id, Kind: "message", At: e.At, Agent: s.agent, Generation: ref.generation, Title: string(m.Role), input: ref}
		if s.managed {
			if !managedHistoryMessage(m) {
				return nil
			}
			// A provider switch may copy an archive prefix. Identical original
			// records keep one identity across versions and offline migration.
			// Keep repeated records distinct even when the OS clock returns the
			// same timestamp; each copied source replays the same occurrence order.
			fingerprint := fmt.Sprintf("%d:%s", ref.generation, workspaceTextHash(string(data)))
			if h.chatOccurrences == nil {
				h.chatOccurrences = map[string]int{}
			}
			occurrenceKey := s.key + ":" + fingerprint
			h.chatOccurrences[occurrenceKey]++
			entry.ID = "context-message:" + workspaceTextHash(fmt.Sprintf("%s:%d", fingerprint, h.chatOccurrences[occurrenceKey]))
			entry.Role = string(m.Role)
			if m.Role == RoleAssistant {
				entry.Role = WorkspaceMatrix
			}
			entry.chatKey = historyChatKey(h.generations[s.key], entry.Role, string(m.Role), m.Name, m.Content)
			entry.chatName = m.Name
		}
		h.entries[entry.ID] = entry
	case "host":
		var event WorkspaceEvent
		if err := json.Unmarshal(e.Value, &event); err != nil {
			return err
		}
		if event.Kind == "message" {
			var m workspaceMessage
			if json.Unmarshal(rawJSON(event.Data), &m) != nil || m.ID == "" || internalTeamNotification(m) {
				return nil
			}
			ref.kind = "host_message"
			id := "message:" + m.ID
			v := historyEntry{ID: id, Kind: "message", At: m.At, Role: m.From, Generation: m.Generation, Title: m.From, State: m.State, DocumentID: m.DocumentID, Artifacts: m.Artifacts, Attachments: m.Attachments, input: ref}
			// Archived host notes use the same readable projection as the live
			// tail. The exact context payload remains available in the receipt.
			if m.DisplayText != "" {
				v.Text, v.TextMore = m.DisplayText, m.DisplayText != m.Text
			} else if shown, ok := changesDisplay(m); ok {
				v.Text, v.TextMore = shown, true
			}
			h.entries[id] = v
			return nil
		}
		if event.Kind == "history_reset" {
			return nil
		}
		id := s.key + ":" + strconv.FormatInt(ref.offset, 10)
		h.entries[id] = historyEntry{ID: id, Kind: "system", At: e.At, Title: event.Kind, input: ref}
	case "checkpoint", "compaction_state":
		var state CompactionState
		if e.Kind == "checkpoint" {
			var cp Checkpoint
			if err := json.Unmarshal(e.Value, &cp); err != nil {
				return err
			}
			if cp.Compaction != nil {
				state = *cp.Compaction
			} else {
				state = CompactionState{RequestID: fmt.Sprintf("legacy-%s-%d", s.key, ref.offset), State: "completed", First: cp.First, Covered: cp.Covered}
			}
		} else if err := json.Unmarshal(e.Value, &state); err != nil {
			return err
		}
		if state.RequestID == "" || e.Kind != "checkpoint" && state.State == "completed" {
			return nil
		}
		key := compactionKey(state.RequestID)
		id := s.agent + ":" + key
		v := h.entries[id]
		if v.ID == "" {
			v = historyEntry{ID: id, Kind: "system", Agent: s.agent, Call: key, At: e.At, Title: "压缩记忆", Compaction: true}
		}
		v.State = state.State
		v.Text = compactionPhaseText(&state)
		v.input = ref
		h.entries[id] = v
	}
	return nil
}

func (w *Workspace) indexHistoryLocked() (bool, error) {
	h := &w.history
	w.mu.Lock()
	scope := ""
	if s := w.contextSessionLocked(); s != nil {
		scope = s.Archive
	}
	w.mu.Unlock()
	if h.scope != scope {
		h.scope = scope
		h.offsets = nil
		h.entries = nil
		h.terminals = nil
		h.generations = nil
		h.chatOccurrences = nil
		h.runtimeAgents = nil
		h.cellParents = nil
	}
	if h.offsets == nil {
		h.offsets = map[string]int64{}
		h.entries = map[string]historyEntry{}
		h.terminals = map[historyTerminalKey]historyTerminalState{}
		h.generations = map[string]int{}
		h.runtimeAgents = map[string]string{}
		h.cellParents = map[string]string{}
	}
	more, scanErr := h.indexReceiptSources(w.historySources())
	var warnings []string
	if scanErr != nil {
		warnings = append(warnings, scanErr.Error())
	}
	w.feed.mu.Lock()
	err := w.feed.archiveError
	w.feed.mu.Unlock()
	if err != nil {
		warnings = append(warnings, "历史记录未能完整保存："+err.Error())
	}
	if len(warnings) > 0 {
		return more, fmt.Errorf("%s", strings.Join(warnings, "；"))
	}
	return more, nil
}

func historyRead(ref historyRef) ([]byte, error) {
	if ref.size == 0 {
		return nil, nil
	}
	if ref.size > 8<<20 {
		return nil, fmt.Errorf("oversized history receipt")
	}
	s := ref.source
	data := make([]byte, ref.size)
	if s.archive != nil && s.archive.ephemeral {
		a := s.archive
		a.mu.Lock()
		defer a.mu.Unlock()
		if ref.offset < 0 || ref.offset+int64(ref.size) > int64(len(a.memory)) {
			return nil, fmt.Errorf("receipt unavailable")
		}
		copy(data, a.memory[ref.offset:ref.offset+int64(ref.size)])
		return data, nil
	}
	f, err := os.Open(s.path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	_, err = f.ReadAt(data, ref.offset)
	return data, err
}

func (w *Workspace) receiptText(v historyEntry) (string, string, error) {
	input, output, err := receiptText(v)
	if err != nil {
		return "", "", err
	}
	return w.manager.redact(input), w.manager.redact(output), nil
}

func (w *Workspace) historyPage(raw json.RawMessage) (any, error) {
	var p struct {
		TaskID     string `json:"task_id"`
		Segment    string `json:"segment"`
		AllHistory bool   `json:"all_history"`
		Before     string `json:"before"`
		Limit      int    `json:"limit"`
		Query      string `json:"query"`
		ChatRounds int    `json:"chat_rounds"`
		Page       int    `json:"page"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	p.Query = strings.TrimSpace(p.Query)
	if utf8.RuneCountInString(p.Query) > 200 {
		return nil, fmt.Errorf("搜索词不能超过 200 个字")
	}
	child := p.TaskID != "" && p.TaskID != w.state.ID
	if child {
		if _, err := w.childTask(p.TaskID); err != nil {
			return nil, err
		}
	}
	if p.Limit == 0 {
		p.Limit = 30
	}
	if p.Limit < 1 || p.Limit > 50 {
		return nil, fmt.Errorf("history limit must be 1..50")
	}
	if p.Page < 0 || p.Page > 1000000 || p.Page > 0 && (p.Before != "" || p.ChatRounds != 0) {
		return nil, fmt.Errorf("历史页码无效")
	}
	if p.ChatRounds < 0 || p.ChatRounds > 20 {
		return nil, fmt.Errorf("chat rounds must be 1..20")
	}
	w.mu.Lock()
	segment, after := w.state.HistorySegment, w.state.HistoryAfter
	messages := append([]workspaceMessage(nil), w.state.Messages...)
	docs := append([]WorkspaceDocument(nil), w.state.Documents...)
	roles := map[string]bool{}
	roleNames := map[string]string{}
	for role, id := range w.state.Roles {
		roles[id] = true
		roleNames[id] = role
	}
	if s := w.contextSessionLocked(); s != nil {
		roles[s.ID] = true
		roleNames[s.ID] = WorkspaceMatrix
	}
	w.mu.Unlock()
	if child {
		segment, after = p.TaskID, ""
		messages, docs = nil, nil
		if w.historySession == p.TaskID {
			record, err := w.manager.Status(w.manager.owner, p.TaskID)
			if err != nil {
				return nil, err
			}
			rows, _, err := w.manager.conversationMessages(record, 0)
			if err != nil {
				return nil, err
			}
			if err = json.Unmarshal(rawJSON(rows), &messages); err != nil {
				return nil, err
			}
			visible := messages[:0]
			for _, message := range messages {
				if message.From == "eyra" {
					message.From, message.To = WorkspaceMatrix, "user"
				} else if message.From == "user" {
					message.To = WorkspaceMatrix
				} else {
					continue
				}
				visible = append(visible, message)
			}
			messages = visible
		}
	}
	if p.Segment != segment {
		return map[string]any{"reset": true, "segment": segment}, nil
	}
	if p.AllHistory {
		after = ""
	}
	var memoryRows []historyEntry
	var memoryError error
	if p.AllHistory && !child {
		memoryLimit := p.Limit + 1
		if p.Query != "" {
			memoryLimit = historySearchMemoryRows
		}
		if p.Page > 0 {
			memoryRows, memoryError = w.historyPageMemory(p.Page, p.Query)
		} else {
			memoryRows, memoryError = w.memoryHistory(p.Before, memoryLimit)
		}
	}
	h := &w.history
	h.mu.Lock()
	defer h.mu.Unlock()
	pending, err := w.indexHistoryLocked()
	warning := ""
	if memoryError != nil {
		warning = "早前会话暂时无法读取，请重新打开历史重试。"
	}
	if err != nil {
		warning = w.manager.redact(err.Error())
	}
	rows := make([]historyEntry, 0, len(h.entries)+len(messages)+len(docs))
	since, _ := time.Parse(time.RFC3339Nano, after)
	include := func(v historyEntry) {
		if p.ChatRounds > 0 && v.Kind != "message" {
			return
		}
		// Notifications have their own durable inbox. They are not dialogue;
		// actual compaction receipts still belong to the task's process history.
		if v.Role == "system" || v.Kind == "system" && !v.Compaction {
			return
		}
		if v.Role == "" {
			v.Role = roleNames[v.Agent]
		}
		at, _ := time.Parse(time.RFC3339Nano, v.At)
		key := historyKey(v)
		if !at.Before(since) && (p.Before == "" || key < p.Before) {
			rows = append(rows, v)
		}
	}
	matched, projected := managedHistoryChat(h.entries, messages)
	for _, v := range h.entries {
		if child && v.Agent != p.TaskID {
			continue
		}
		if v.Kind == "message" && roles[v.Agent] && v.chatKey == "" {
			continue
		}
		if m, ok := projected[v.ID]; ok {
			v.State, v.DocumentID, v.Artifacts, v.Attachments = m.State, m.DocumentID, m.Artifacts, m.Attachments
			v.SnapshotID = m.ID
		}
		if strings.HasPrefix(v.ID, "message:") {
			found := false
			for _, m := range messages {
				if v.ID == "message:"+m.ID {
					found = true
					break
				}
			}
			if found {
				continue
			}
		}
		include(v)
	}
	for _, v := range memoryRows {
		include(v)
	}
	for _, m := range messages {
		if internalTeamNotification(m) || matched[m.ID] {
			continue
		}
		// The chat's short display text is the default; the receipt keeps the exact original.
		text := m.Text
		if m.DisplayText != "" {
			text = m.DisplayText
		} else if shown, ok := changesDisplay(m); ok {
			text = shown
		}
		include(historyEntry{ID: "message:" + m.ID, SnapshotID: m.ID, Kind: "message", At: m.At, Role: m.From, Generation: m.Generation, Title: m.From, State: m.State, Text: text, TextMore: text != m.Text, DocumentID: m.DocumentID, Artifacts: m.Artifacts, Attachments: m.Attachments})
	}
	for _, d := range docs {
		if d.Kind == "system" || d.Kind == "record" || d.Title == "这次的记录" && d.Format == "md" {
			continue
		}
		include(historyEntry{ID: "document:" + d.ID, Kind: "document", At: d.At, Title: d.Title, DocumentID: d.ID})
	}
	sort.Slice(rows, func(i, j int) bool { return historyKey(rows[i]) < historyKey(rows[j]) })
	if p.ChatRounds > 0 {
		legacy := "initial"
		for i := range rows {
			if rows[i].Role == "user" {
				legacy = rows[i].ID
			}
			rows[i].Round = "legacy:" + legacy
			if rows[i].Generation > 0 {
				rows[i].Round = fmt.Sprintf("%s:%d", rows[i].Agent, rows[i].Generation)
			}
		}
	}
	searchResume := ""
	pages, selectedPage := 0, 0
	if p.Page > 0 {
		rows, pages, selectedPage = w.numberedHistory(rows, p.Page, p.Query)
	} else if p.Query != "" {
		rows, searchResume = w.searchHistoryRows(rows, p.Query, p.Limit+1)
	}
	more := false
	if p.Page > 0 {
		more = selectedPage < pages
	} else if p.ChatRounds > 0 {
		// Tool-heavy turns still consume one round. A very long round may span
		// bounded pages; generation remains stable across those pages.
		start, rounds := len(rows), map[string]bool{}
		for start > 0 && len(rows)-start < 200 {
			row := rows[start-1]
			round := row.Round
			if !rounds[round] && len(rounds) >= p.ChatRounds {
				break
			}
			rounds[round] = true
			start--
		}
		more, rows = start > 0, rows[start:]
	} else {
		more = len(rows) > p.Limit || searchResume != ""
		if len(rows) > p.Limit {
			rows = rows[len(rows)-p.Limit:]
		}
	}
	w.projectHistoryTerminals(rows)
	for i := range rows {
		rows[i].SortKey = historyKey(rows[i])
		if rows[i].Kind != "tool" && rows[i].Text == "" && rows[i].input.size > 0 {
			in, _, e := w.receiptText(rows[i])
			if e != nil {
				rows[i].Unavailable = true
				rows[i].Text = "此条原始记录暂时无法读取，请稍后重试。"
				if warning == "" {
					warning = "部分原始记录暂时无法读取，其余记录仍可查看。"
				}
			} else {
				rows[i].Text = in
				if rows[i].Role == "user" || rows[i].Kind == "message" && rows[i].Title == string(RoleUser) {
					var short bool
					rows[i].Text, short = historyUserDisplay(in)
					if len(rows[i].Attachments) == 0 {
						rows[i].Attachments = historyImageAttachments(in)
					}
					rows[i].TextMore = rows[i].TextMore || short
				}
			}
		}
		if rows[i].Kind == "tool" && rows[i].input.size > 0 {
			if in, _, e := w.receiptText(historyEntry{input: rows[i].input}); e == nil {
				rows[i].Summary = historyToolSummary(rows[i].Title, in)
			}
		}
		rows[i].Text = w.manager.redact(rows[i].Text)
		rows[i].TextMore = rows[i].TextMore || len(rows[i].Text) > 16<<10
		rows[i].Text = utf8Prefix(rows[i].Text, 16<<10)
		rows[i].Title = w.manager.redact(rows[i].Title)
	}
	before := ""
	if len(rows) > 0 {
		before = historyKey(rows[0])
	}
	if searchResume != "" && (before == "" || searchResume < before) {
		before = searchResume
	}
	w.mu.Lock()
	current := w.state.HistorySegment
	w.mu.Unlock()
	if child {
		current = p.TaskID
	}
	if current != segment {
		return map[string]any{"reset": true, "segment": current}, nil
	}
	result := map[string]any{"entries": rows, "before": before, "has_more": more, "indexing": pending, "segment": segment, "warning": warning}
	if p.Page > 0 {
		result["page"], result["pages"] = selectedPage, pages
	}
	return result, nil
}

// Pages run newest first. Inside each page the original event order is retained.
const historyTurnsPerPage = 10

func (w *Workspace) numberedHistory(rows []historyEntry, page int, query string) ([]historyEntry, int, int) {
	if len(rows) == 0 {
		return rows, 1, 1
	}
	ends := []int{0}
	seenUser := false
	for i, row := range rows {
		if row.Kind == "message" && (row.Role == "user" || row.Title == "user") {
			if seenUser {
				ends = append(ends, i)
			}
			seenUser = true
		}
	}
	ends = append(ends, len(rows))
	// Only materialize matches for the requested page. Store round offsets for
	// normal navigation; receipts are fetched by historyPage after slicing.
	turns := len(ends) - 1
	if query == "" {
		pages := (turns + historyTurnsPerPage - 1) / historyTurnsPerPage
		page = min(page, pages)
		end := turns - (page-1)*historyTurnsPerPage
		return rows[ends[max(0, end-historyTurnsPerPage)]:ends[end]], pages, page
	}
	needle := strings.ToLower(query)
	matches := make([]historyEntry, 0)
	lastPage := make([]historyEntry, 0)
	matched := 0
	for turn := turns - 1; turn >= 0; turn-- {
		var hits []historyEntry
		for i := ends[turn+1] - 1; i >= ends[turn]; i-- {
			if w.historyMatches(rows[i], needle) {
				hits = append(hits, rows[i])
			}
		}
		if len(hits) == 0 {
			continue
		}
		p := matched/historyTurnsPerPage + 1
		if matched%historyTurnsPerPage == 0 {
			lastPage = lastPage[:0]
		}
		lastPage = append(lastPage, hits...)
		if p == page {
			matches = append(matches, hits...)
		}
		matched++
	}
	pages := max(1, (matched+historyTurnsPerPage-1)/historyTurnsPerPage)
	if page > pages {
		page = pages
		matches = lastPage
	}
	slices.Reverse(matches)
	return matches, pages, page
}

func (w *Workspace) historyMatches(v historyEntry, needle string) bool {
	if v.Kind != "message" {
		return false
	}
	text := v.Text
	if text == "" && v.input.size > 0 {
		in, _, err := w.receiptText(v)
		if err != nil {
			return false
		}
		text = in
		if v.Role == "user" || v.Title == string(RoleUser) {
			text, _ = historyUserDisplay(in)
		}
	}
	return strings.Contains(strings.ToLower(w.manager.redact(text)), needle)
}

// Search reads the same visible dialogue as the history view: user messages and
// replies, newest first, case-insensitive. Scanning is bounded so a very long
// archive answers promptly; older matches continue through the before cursor.
const (
	historySearchScan       = 6000
	historySearchMemoryRows = 500
)

func (w *Workspace) searchHistoryRows(rows []historyEntry, query string, limit int) ([]historyEntry, string) {
	needle := strings.ToLower(query)
	found := make([]historyEntry, 0, limit)
	i, scanned := len(rows)-1, 0
	for ; i >= 0 && len(found) < limit && scanned < historySearchScan; i-- {
		v := rows[i]
		if v.Kind != "message" {
			continue
		}
		scanned++
		if w.historyMatches(v, needle) {
			found = append(found, v)
		}
	}
	for l, r := 0, len(found)-1; l < r; l, r = l+1, r-1 {
		found[l], found[r] = found[r], found[l]
	}
	// Unscanned older rows remain: continue below the oldest row examined.
	resume := ""
	if i >= 0 && len(found) < limit {
		resume = historyKey(rows[i+1])
	}
	return found, resume
}

func historyKey(v historyEntry) string {
	at, _ := time.Parse(time.RFC3339Nano, v.At)
	return fmt.Sprintf("%020d:%s", at.UnixNano(), v.ID)
}

func historyOutputState(output string) string {
	var r struct {
		State json.RawMessage `json:"state"`
		OK    *bool           `json:"ok"`
		Exit  *int            `json:"exit_code"`
		Error json.RawMessage `json:"error"`
	}
	if json.Unmarshal([]byte(output), &r) != nil {
		return "failed"
	}
	var state string
	_ = json.Unmarshal(r.State, &state)
	if state == "cancelled" || state == "timed_out" || state == "interrupted_unknown" || state == "interrupted" || state == "failed" {
		return state
	}
	if r.OK != nil && !*r.OK || r.Exit != nil && *r.Exit != 0 || len(r.Error) > 0 && string(r.Error) != "null" && string(r.Error) != "\"\"" {
		return "failed"
	}
	if state == "running" || state == "starting" || state == "queued" {
		return "running"
	}
	return "completed"
}

func (w *Workspace) historyReceipt(raw json.RawMessage) (any, error) {
	var p toolReceiptRequest
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if p.EntryID == "" {
		return w.toolReceipt(p)
	}
	child := p.TaskID != "" && p.TaskID != w.state.ID
	if child {
		if _, err := w.childTask(p.TaskID); err != nil {
			return nil, err
		}
	}
	if p.EntryID == "" && (!sessionIDPattern.MatchString(p.Agent) || len(p.ID) > 512) || len(p.EntryID) > 512 {
		return nil, fmt.Errorf("invalid receipt")
	}
	if strings.HasPrefix(p.EntryID, "memory:") {
		if child || !p.AllHistory {
			return nil, fmt.Errorf("receipt does not belong to the selected task")
		}
		text, truncated, err := w.memoryHistoryOriginal(p.EntryID)
		if err != nil {
			return nil, err
		}
		text = w.manager.redact(text)
		part, next, err := historyChunk(text, p.InputOffset)
		if err != nil {
			return nil, err
		}
		return map[string]any{"input": part, "output": "", "next_input": next, "next_output": 0, "input_size": len(text), "output_size": 0, "truncated": truncated}, nil
	}
	h := &w.history
	h.mu.Lock()
	defer h.mu.Unlock()
	pending, err := w.indexHistoryLocked()
	v, ok := h.entries[p.Agent+":"+p.ID]
	// Existing activity views address the current runtime role. Only that owned
	// role may alias the durable conversation identity; stale/foreign IDs cannot.
	if !ok && !child && p.EntryID == "" {
		w.mu.Lock()
		if s := w.contextSessionLocked(); s != nil && p.Agent == w.state.Roles[WorkspaceMatrix] {
			v, ok = h.entries[s.ID+":"+p.ID]
		}
		w.mu.Unlock()
	}
	if p.EntryID != "" {
		w.mu.Lock()
		segment, after := w.state.HistorySegment, w.state.HistoryAfter
		v, ok = h.entries[p.EntryID]
		if strings.HasPrefix(p.EntryID, "message:") {
			for _, m := range w.state.Messages {
				if "message:"+m.ID == p.EntryID {
					if internalTeamNotification(m) {
						ok = false
						break
					}
					v, ok = historyEntry{ID: p.EntryID, Kind: "message", At: m.At, Text: m.Text}, true
					break
				}
			}
		}
		w.mu.Unlock()
		if child {
			segment, after = p.TaskID, ""
		}
		if p.Segment != segment {
			return nil, fmt.Errorf("历史段已更新，请重新打开历史")
		}
		if p.AllHistory {
			after = ""
		}
		at, _ := time.Parse(time.RFC3339Nano, v.At)
		since, _ := time.Parse(time.RFC3339Nano, after)
		if ok && (v.Kind == "tool" || at.Before(since)) {
			return nil, fmt.Errorf("history entry unavailable")
		}
	}
	if child && ok && v.Agent != p.TaskID {
		return nil, fmt.Errorf("receipt does not belong to the selected task")
	}
	if !ok {
		if err != nil {
			return nil, err
		}
		if pending {
			return map[string]any{"pending": true}, nil
		}
		return nil, fmt.Errorf("receipt unavailable")
	}
	projected := []historyEntry{v}
	if v.Compaction {
		return w.compactionReceipt(v, p.InputOffset, p.OutputOffset, pending)
	}
	w.projectHistoryTerminals(projected)
	v = projected[0]
	in, out, err := w.receiptText(v)
	if err != nil {
		return nil, err
	}
	if v.Text != "" {
		in = w.manager.redact(v.Text)
	}
	input, ni, err := historyChunk(in, p.InputOffset)
	if err != nil {
		return nil, err
	}
	output, no, err := historyChunk(out, p.OutputOffset)
	if err != nil {
		return nil, err
	}
	return map[string]any{"input": input, "output": output, "next_input": ni, "next_output": no, "input_size": len(in), "output_size": len(out), "tool": v.Title, "state": v.State, "pending": pending}, nil
}
