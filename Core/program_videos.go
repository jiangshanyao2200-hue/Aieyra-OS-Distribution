// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: programVideoSession; programVideos
// Impact: python -B scripts/code-atlas.py show Core/program_videos.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
)

// Native canvas actions and Aria use the same durable conversation identity and
// video task store. This creates only an idle session, never a chat request.
func (h *WorkspaceHost) programVideoSession(ctx context.Context) (*AgentManager, AgentRecord, error) {
	if h.mode != HostOS || h.terminal {
		return nil, AgentRecord{}, fmt.Errorf("画布视频仅在 OS 中可用")
	}
	m, err := h.conversationManager()
	if err != nil {
		return nil, AgentRecord{}, err
	}
	conversationContactsMu.Lock()
	defer conversationContactsMu.Unlock()
	c, sessions, err := m.liveContact(programContactID("workspace"))
	if err != nil {
		return nil, AgentRecord{}, err
	}
	if c.Deleted || c.Program != "workspace" || c.Defaults == nil || !slices.Contains(c.Defaults.Tools, "video_gen") {
		return nil, AgentRecord{}, fmt.Errorf("画布 Agent 的视频生成工具未启用")
	}
	if len(sessions) > 0 {
		return m, sessions[0], nil
	}
	spec := *c.Defaults
	// The media model is chosen by video_gen. A missing chat model must not
	// prevent a user from creating media with a configured video model.
	if model, modelErr := m.programModel(c); modelErr == nil {
		spec.ModelID = model
	} else {
		spec.ModelID = ""
	}
	spec.Kind, spec.ProfileID, spec.Title = "conversation", c.ID, c.Name
	spec.RequestID = "program/workspace"
	trusted := context.WithValue(programPermissions(ctx, spec.Tools), programAgentCreateKey{}, c.Program)
	r, err := m.Create(trusted, m.owner, spec)
	return m, r, err
}

func (h *WorkspaceHost) programVideos(ctx context.Context, raw json.RawMessage) (any, error) {
	m, r, err := h.programVideoSession(ctx)
	if err != nil {
		return nil, err
	}
	h.mu.Lock()
	if h.closed || h.updateFrozen {
		h.mu.Unlock()
		return nil, fmt.Errorf("OS 正在退出或更新")
	}
	// Reuse the host's cancellable media lifetime. Closing the OS waits for
	// original task receipts to settle; it never resubmits a provider request.
	if h.programImageRuns == nil {
		h.programImageRuns = map[string]*programImageRun{}
	}
	key := "video:" + r.ID + ":" + workspaceID()
	ctx, cancel := context.WithCancel(ctx)
	run := &programImageRun{cancel: cancel, done: make(chan struct{})}
	h.programImageRuns[key] = run
	h.mu.Unlock()
	defer func() { cancel(); h.mu.Lock(); delete(h.programImageRuns, key); close(run.done); h.mu.Unlock() }()
	ctx = WithAgentManager(ctx, m, r.ID, nil)
	ctx = context.WithValue(ctx, conversationLinkCallerKey{}, conversationLinkCaller{ID: r.ID, Generation: r.Generation})
	ctx = WithToolPermissions(ctx, []string{"video_gen"})
	ctx = context.WithValue(ctx, liveToolPermissionKey{}, func(name string) bool {
		h.mu.Lock()
		closed := h.closed || h.updateFrozen
		h.mu.Unlock()
		if closed || ctx.Err() != nil || name != "video_gen" {
			return false
		}
		current, e := m.Status(m.owner, r.ID)
		if e != nil || current.Generation != r.Generation {
			return false
		}
		c, e := m.readContact(programContactID("workspace"))
		return e == nil && !c.Deleted && c.Program == "workspace" && c.Defaults != nil && slices.Contains(c.Defaults.Tools, name)
	})
	return runVideoGen(ctx, h.config, raw)
}
