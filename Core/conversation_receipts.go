// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: conversationReceiptRequest; page; conversationReceipt; conversationReceiptTarget; receiptRecord; privateReceiptTarget; groupReceiptTarget; groupReceipt; readSessionReceipt; homeReceiptMember; linkMemberReceipt
// Impact: python -B scripts/code-atlas.py show Core/conversation_receipts.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"path/filepath"
)

type conversationReceiptRequest struct {
	Action            string `json:"action"`
	ID                string `json:"id"`
	GroupID           string `json:"group_id"`
	MemberID          string `json:"member_id"`
	CallID            string `json:"call_id"`
	ReceiptGeneration int    `json:"receipt_generation"`
	ReceiptVersion    string `json:"receipt_version"`
	InputOffset       int    `json:"input_offset"`
	OutputOffset      int    `json:"output_offset"`
}

func (p conversationReceiptRequest) page() toolReceiptRequest {
	return toolReceiptRequest{ID: p.CallID, ReceiptGeneration: p.ReceiptGeneration, ReceiptVersion: p.ReceiptVersion,
		InputOffset: p.InputOffset, OutputOffset: p.OutputOffset}
}

// Dispatch before conversationManager: opening an original cannot initialise
// the service, built-in contacts, Link recovery, jobs, or execution runtimes.
func (h *WorkspaceHost) conversationReceipt(raw json.RawMessage) (any, error) {
	var p conversationReceiptRequest
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if !validReceiptPage(p.page()) {
		return nil, fmt.Errorf("invalid receipt")
	}
	h.mu.Lock()
	m, closed := h.conversations, h.closed || h.terminal
	h.mu.Unlock()
	if closed || m == nil {
		return receiptUnavailable(false), nil
	}
	if p.Action == "group_receipt" {
		return m.groupReceipt(p)
	}
	before, err := m.privateReceiptTarget(p)
	if err != nil {
		return nil, err
	}
	result, err := m.readSessionReceipt(before.id, p.page(), true)
	if err != nil {
		return nil, err
	}
	after, err := m.privateReceiptTarget(p)
	if err != nil {
		return nil, err
	}
	if before != after {
		return nil, fmt.Errorf("conversation receipt scope changed")
	}
	h.mu.Lock()
	current := !h.closed && !h.terminal && h.conversations == m
	h.mu.Unlock()
	if !current {
		return nil, fmt.Errorf("conversation receipt service closed")
	}
	return result, nil
}

type conversationReceiptTarget struct {
	id, room     string
	base, target *agentJob
}

func (m *AgentManager) receiptRecord(id string) (AgentRecord, *agentJob, error) {
	if !sessionIDPattern.MatchString(id) {
		return AgentRecord{}, nil, fmt.Errorf("invalid receipt session")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	j := m.jobs[id]
	if j == nil || !m.ownsLocked(m.owner, id) || j.record.DeletionPending {
		return AgentRecord{}, nil, fmt.Errorf("receipt session is unavailable")
	}
	return copyRecord(j.record), j, nil
}

func (m *AgentManager) privateReceiptTarget(p conversationReceiptRequest) (conversationReceiptTarget, error) {
	base, job, err := m.receiptRecord(p.ID)
	if err != nil {
		return conversationReceiptTarget{}, err
	}
	if base.Spec.Kind != "conversation" || base.Spec.GroupID != "" || base.Link != nil {
		return conversationReceiptTarget{}, fmt.Errorf("receipt requires the original private conversation")
	}
	if _, err = m.contactOf(base); err != nil {
		return conversationReceiptTarget{}, err
	}
	if p.MemberID == "" || p.MemberID == base.ID {
		return conversationReceiptTarget{id: base.ID, base: job, target: job}, nil
	}
	conversationGroupsMu.Lock()
	defer conversationGroupsMu.Unlock()
	scope, _, err := m.linkScope(base)
	if err != nil {
		return conversationReceiptTarget{}, err
	}
	g, err := m.readGroup(linkLogID(scope))
	if err != nil {
		return conversationReceiptTarget{}, err
	}
	if g.LinkScope != scope {
		return conversationReceiptTarget{}, fmt.Errorf("receipt Link scope mismatch")
	}
	if _, err = m.linkMember(g, base.ID); err != nil {
		return conversationReceiptTarget{}, err
	}
	member, err := m.linkMember(g, p.MemberID)
	if err != nil {
		return conversationReceiptTarget{}, err
	}
	_, target, err := m.receiptRecord(member.ID)
	if err != nil {
		return conversationReceiptTarget{}, err
	}
	return conversationReceiptTarget{id: member.ID, room: g.ID, base: job, target: target}, nil
}

func (m *AgentManager) groupReceiptTarget(p conversationReceiptRequest) (conversationReceiptTarget, error) {
	if !sessionIDPattern.MatchString(p.GroupID) || !sessionIDPattern.MatchString(p.MemberID) {
		return conversationReceiptTarget{}, fmt.Errorf("group receipt requires the group and member session")
	}
	conversationGroupsMu.Lock()
	defer conversationGroupsMu.Unlock()
	g, err := m.readGroup(p.GroupID)
	if err != nil {
		return conversationReceiptTarget{}, err
	}
	if g.LinkScope != "" {
		return conversationReceiptTarget{}, fmt.Errorf("receipt requires the actual group")
	}
	member := false
	for _, candidate := range append([]groupMember{g.Host}, g.Members...) {
		member = member || candidate.Session == p.MemberID
	}
	if !member {
		return conversationReceiptTarget{}, fmt.Errorf("receipt target is not a group member")
	}
	r, job, err := m.receiptRecord(p.MemberID)
	if err != nil {
		return conversationReceiptTarget{}, err
	}
	if r.Spec.Kind != "conversation" || r.Spec.GroupID != g.ID || r.Link != nil {
		return conversationReceiptTarget{}, fmt.Errorf("group receipt session does not belong to this group")
	}
	return conversationReceiptTarget{id: r.ID, room: g.ID, target: job}, nil
}

func (m *AgentManager) groupReceipt(p conversationReceiptRequest) (any, error) {
	if !validReceiptPage(p.page()) {
		return nil, fmt.Errorf("invalid receipt")
	}
	before, err := m.groupReceiptTarget(p)
	if err != nil {
		return nil, err
	}
	result, err := m.readSessionReceipt(before.id, p.page(), true)
	if err != nil {
		return nil, err
	}
	after, err := m.groupReceiptTarget(p)
	if err != nil {
		return nil, err
	}
	if before != after {
		return nil, fmt.Errorf("group receipt scope changed")
	}
	return result, nil
}

// Only the already authorised session and its own cell directory are indexed.
// The cache holds offsets, not another copy of the input/output payloads.
func (m *AgentManager) readSessionReceipt(id string, p toolReceiptRequest, requireSource bool) (any, error) {
	if !validReceiptPage(p) {
		return nil, fmt.Errorf("invalid receipt")
	}
	_, job, err := m.receiptRecord(id)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	if m.jobs[id] != job || job.record.DeletionPending {
		m.mu.Unlock()
		return nil, fmt.Errorf("receipt session changed")
	}
	a := job.archive
	path := filepath.Join(m.dir, "sessions", id+".jsonl")
	if a != nil && a.Path != "" {
		path = a.Path
	}
	if job.receiptHistory == nil {
		job.receiptHistory = &workspaceHistory{}
	}
	h := job.receiptHistory
	m.mu.Unlock()
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.scope != path || h.receiptArchive != a {
		h.scope, h.receiptArchive = path, a
		h.offsets, h.entries, h.terminals = nil, nil, nil
		h.generations, h.runtimeAgents, h.cellParents = nil, nil, nil
	}
	source := historySource{key: id, agent: id, runtimeAgent: id, path: path, archive: a, shellRoot: m.dir}
	pending, indexErr := h.indexReceiptSources([]historySource{source})
	v, exists := h.entries[id+":"+p.ID]
	var result any
	if !exists {
		if indexErr != nil {
			return nil, indexErr
		}
		result = receiptUnavailable(pending)
	} else {
		v = h.resolveReceiptIdentity(v)
		m.mu.Lock()
		var shell *ShellManager
		if m.jobs[id] == job && !job.record.DeletionPending {
			shell = job.shell
		}
		m.mu.Unlock()
		rows := []historyEntry{v}
		projectReceiptTerminals(h, rows, map[string]*ShellManager{id: shell})
		result, err = receiptPage(m, rows[0], p, pending, requireSource)
		if err != nil {
			return nil, err
		}
	}
	m.mu.Lock()
	current := m.jobs[id] == job && !job.record.DeletionPending && job.archive == a && m.ownsLocked(m.owner, id)
	m.mu.Unlock()
	if !current {
		return nil, fmt.Errorf("receipt session changed during read")
	}
	return result, nil
}

func (w *Workspace) homeReceiptMember(p toolReceiptRequest, view workspaceReceiptView) (*AgentManager, AgentRecord, error) {
	service := w.manager.linkRootService.Load()
	if service == nil || view.session == "" {
		return nil, AgentRecord{}, fmt.Errorf("receipt Link room is unavailable")
	}
	conversationGroupsMu.Lock()
	defer conversationGroupsMu.Unlock()
	g, err := service.readGroup(linkLogID(view.session))
	if err != nil {
		return nil, AgentRecord{}, err
	}
	if g.LinkScope != view.session || g.WorkspaceLink == nil || g.Host.Session != view.session {
		return nil, AgentRecord{}, fmt.Errorf("receipt Link room no longer belongs to the selected context")
	}
	member, err := service.linkMember(g, p.MemberID)
	return service, member, err
}

func (w *Workspace) linkMemberReceipt(p toolReceiptRequest, view workspaceReceiptView) (any, error) {
	if p.TaskID != view.root || p.Agent != view.primary || p.Generation <= 0 || p.CoreEpoch == "" {
		return nil, fmt.Errorf("Link receipt requires the current primary workspace scope")
	}
	service, member, err := w.homeReceiptMember(p, view)
	if err != nil {
		return nil, err
	}
	var result any
	if member.Spec.Kind == "workspace_link" {
		// The primary mailbox has no job in the conversation service. Its
		// originals remain in this Workspace's persistent archive.
		own := p
		own.MemberID = ""
		result, err = w.toolReceipt(own)
	} else {
		result, err = service.readSessionReceipt(member.ID, p, true)
	}
	if err != nil {
		return nil, err
	}
	if err = w.checkReceiptView(p, view); err != nil {
		return nil, err
	}
	current, currentMember, err := w.homeReceiptMember(p, view)
	if err != nil {
		return nil, err
	}
	if current != service || currentMember.ID != member.ID {
		return nil, fmt.Errorf("receipt Link membership changed")
	}
	return result, nil
}
