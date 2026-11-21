// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workspaceSplit; workspaceMembership; splitTarget; splitWorkspaces; splitRow; splitCall; startSplit
// Impact: python -B scripts/code-atlas.py show Core/workspace_split.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// A split owns a complete Workspace/AgentManager. Parent is a navigation and
// explicit delegation relationship, never a cancellation or context ancestor.
type workspaceSplit struct {
	op                                                 sync.Mutex
	mu                                                 sync.Mutex
	ID, Parent, Title, RequestID, Message, Fingerprint string
	Created                                            string
	Membership                                         workspaceMembership
	Started                                            bool
	Running                                            int
	Cancelled                                          bool
	CancelJoin                                         context.CancelFunc
}

type workspaceMembership struct {
	State       string `json:"state"`
	Project     string `json:"project"`
	ActorID     string `json:"actor_id,omitempty"`
	SeatID      string `json:"seat_id,omitempty"`
	NativeID    string `json:"native_session_id"`
	TransportID string `json:"transport_session_id,omitempty"`
	ObservedAt  string `json:"observed_at,omitempty"`
	Error       string `json:"error,omitempty"`
	Stale       bool   `json:"stale"`
}

// Only the owning task may route to an explicitly created descendant. Sharing
// a process does not expose arbitrary host tasks, siblings or their credentials.
func (w *Workspace) splitTarget(id string) *Workspace {
	if w.Mode() != HostOS || w.host == nil || id == "" || id == w.state.ID {
		return nil
	}
	h := w.host
	h.mu.Lock()
	defer h.mu.Unlock()
	for cursor, n := id, 0; n < 16; n++ {
		s := h.splits[cursor]
		if s == nil {
			return nil
		}
		if s.Parent == w.state.ID {
			return h.workspaces[id]
		}
		cursor = s.Parent
	}
	return nil
}

func (w *Workspace) splitWorkspaces() []*Workspace {
	if w.Mode() != HostOS || w.host == nil {
		return nil
	}
	h := w.host
	h.mu.Lock()
	var ids []string
	for id := range h.splits {
		ids = append(ids, id)
	}
	h.mu.Unlock()
	sort.Strings(ids)
	var rows []*Workspace
	for _, id := range ids {
		if child := w.splitTarget(id); child != nil {
			rows = append(rows, child)
		}
	}
	return rows
}

func (w *Workspace) splitRow() map[string]any {
	s := w.split
	s.mu.Lock()
	membership, started, cancelled := s.Membership, s.Started, s.Cancelled
	s.mu.Unlock()
	if at, err := time.Parse(time.RFC3339Nano, membership.ObservedAt); err != nil || time.Since(at) > 45*time.Second || time.Until(at) > 5*time.Second {
		membership.Stale = true
	}
	row := map[string]any{"id": s.ID, "task_id": s.ID, "parent": s.Parent, "parent_task_id": s.Parent, "title": w.manager.redact(s.Title), "role": WorkspaceMatrix, "mode": "split", "independent": true, "membership": membership, "state": "pending_membership", "execution_state": "idle", "execution_started": false, "generation": 0, "initial_submitted": started}
	w.mu.Lock()
	id := w.state.Roles[WorkspaceMatrix]
	w.mu.Unlock()
	row["agent_id"], row["core_epoch"] = id, w.epoch
	if status, err := w.manager.workspaceRoleStatus(s.ID, id); err == nil {
		for _, key := range []string{"state", "generation", "execution_started"} {
			row[key] = status[key]
		}
		row["execution_state"] = status["state"]
	} else if started {
		row["state"] = "queued"
		row["execution_state"] = "queued"
	} else if cancelled {
		row["state"] = "cancelled"
		row["execution_state"] = "cancelled"
	}
	return row
}

func (w *Workspace) splitCall(ctx context.Context, raw json.RawMessage) (any, error) {
	var p struct {
		Action    string `json:"action"`
		RequestID string `json:"request_id"`
		TaskID    string `json:"task_id"`
		Title     string `json:"title"`
		Workdir   string `json:"workdir"`
		Message   string `json:"message"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if w.Mode() != HostOS || w.host == nil {
		return nil, fmt.Errorf("independent tasks require the OS host")
	}
	if strings.TrimPrefix(p.Action, "collaboration_") == "retry" {
		next := w.splitTarget(p.TaskID)
		if next == nil && p.TaskID == w.state.ID && w.split != nil {
			next = w
		}
		if next == nil {
			return nil, fmt.Errorf("split task not owned by caller")
		}
		return next.startSplit(ctx)
	}
	if p.RequestID == "" || len(p.RequestID) > 128 || strings.TrimSpace(p.Title) == "" || len([]rune(p.Title)) > 80 || strings.TrimSpace(p.Message) == "" || len(p.Message) > 64<<10 || !filepath.IsAbs(p.Workdir) {
		return nil, fmt.Errorf("split requires request_id, title (up to 80 characters), absolute workdir and message")
	}
	h := w.host
	id := taskMessageHash(w.state.ID + "\x00" + p.RequestID)[:32]
	fingerprint := taskMessageHash(string(rawJSON([]string{p.Title, filepath.Clean(p.Workdir), p.Message})))
	h.mu.Lock()
	if h.closed || h.updateFrozen {
		h.mu.Unlock()
		return nil, fmt.Errorf("core is closed or frozen")
	}
	// Match update-freeze's host/try-workspace order; configuration and close
	// cannot pass the creation boundary after its mode was inspected.
	if !w.mu.TryLock() {
		h.mu.Unlock()
		return nil, fmt.Errorf("task is busy; retry with the same request_id")
	}
	if w.closed || w.updateFrozen || w.collaborationModeLocked() == "natural" {
		w.mu.Unlock()
		h.mu.Unlock()
		return nil, fmt.Errorf("select split or custom mode before creating an independent task")
	}
	if old := h.splits[id]; old != nil {
		next := h.workspaces[id]
		w.mu.Unlock()
		h.mu.Unlock()
		if old.Fingerprint != fingerprint {
			return nil, fmt.Errorf("split request_id conflicts with the original request")
		}
		// Repeated create is a status read. Recovery must be explicit, never replay.
		return next.splitRow(), nil
	}
	if len(h.workspaces) >= 16 {
		w.mu.Unlock()
		h.mu.Unlock()
		return nil, fmt.Errorf("最多同时打开 16 个任务")
	}
	s := &workspaceSplit{ID: id, Parent: w.state.ID, Title: p.Title, RequestID: p.RequestID, Message: p.Message, Fingerprint: fingerprint, Created: time.Now().UTC().Format(time.RFC3339Nano), Membership: workspaceMembership{State: "pending", Project: "os", NativeID: id, Stale: true}}
	next, err := newWorkspaceWithSplit(h.config, id, p.Workdir, h.prompt, h.service, h, s)
	if err != nil {
		w.mu.Unlock()
		h.mu.Unlock()
		return nil, err
	}
	control, err := NewMatrixControl(next.manager)
	if err != nil {
		w.mu.Unlock()
		h.mu.Unlock()
		next.Close()
		return nil, err
	}
	if h.splits == nil {
		h.splits = map[string]*workspaceSplit{}
	}
	h.splits[id] = s
	h.workspaces[id] = next
	h.controls[id] = control
	w.mu.Unlock()
	h.mu.Unlock()
	return next.startSplit(ctx)
}

func (w *Workspace) startSplit(ctx context.Context) (any, error) {
	s := w.split
	s.op.Lock()
	defer s.op.Unlock()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	s.mu.Lock()
	if s.Started || s.Cancelled {
		s.mu.Unlock()
		return w.splitRow(), nil
	}
	s.Membership.State = "connecting"
	s.Membership.Stale = true
	s.CancelJoin = cancel
	s.mu.Unlock()
	defer func() { s.mu.Lock(); s.CancelJoin = nil; s.mu.Unlock() }()
	w.mu.Lock()
	closed := w.closed || w.updateFrozen
	w.mu.Unlock()
	if closed {
		return nil, fmt.Errorf("task is closed or frozen")
	}
	if err := w.splitStationBoundaryLocked(ctx, "join"); err != nil {
		return w.splitRow(), nil
	}
	if err := ctx.Err(); err != nil {
		return w.splitRow(), nil
	}
	// The stable initial request is committed only once by the task's own queue.
	if _, err := w.controlSend("split-"+s.ID, s.Message); err != nil {
		return nil, err
	}
	return w.splitRow(), nil
}
