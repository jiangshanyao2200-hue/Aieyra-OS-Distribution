// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: shellModuleSituation; shellSituation; shellSituation; situationAgents; liveAgentManagers; situation; agentOverview
// Impact: python -B scripts/code-atlas.py show Core/workspace_situation.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"time"
)

type shellModuleSituation struct {
	ID        string `json:"id"`
	Placement string `json:"placement"`
	Starting  bool   `json:"starting"`
	Visible   bool   `json:"visible"`
	Ready     bool   `json:"ready"`
	Error     string `json:"error,omitempty"`
}

type shellSituation struct {
	OK         bool                   `json:"ok"`
	MainOpen   bool                   `json:"main_open"`
	ActivePage string                 `json:"active_page"`
	Version    string                 `json:"version"`
	Modules    []shellModuleSituation `json:"modules"`
}

// The exact existing desktop observer supplies the shell. Selecting fields
// avoids publishing receipt stores, credentials or renderer-generated clocks.
// A failed observation stays unknown; it never becomes a fabricated idle OS.
func (w *Workspace) shellSituation(ctx context.Context) any {
	unknown := map[string]any{"available": false, "state": "unknown", "source": "software_api.modules"}
	if w.service == nil {
		return unknown
	}
	c, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()
	w.mu.Lock()
	id := w.state.ID
	w.mu.Unlock()
	raw, err := w.service.CallTool(c, "desktop", id, rawJSON(map[string]any{"action": "modules"}))
	var state shellSituation
	if err != nil || len(raw) > 256<<10 || json.Unmarshal(raw, &state) != nil || !state.OK || state.Version == "" || state.ActivePage == "" || len(state.Modules) > 128 {
		return unknown
	}
	sort.Slice(state.Modules, func(i, j int) bool { return state.Modules[i].ID < state.Modules[j].ID })
	for i := range state.Modules {
		state.Modules[i].Error = utf8Prefix(state.Modules[i].Error, 200)
	}
	return map[string]any{"available": true, "source": "software_api.modules", "snapshot": state}
}

// Read live metadata only. Automatic context uses the state and failure code
// of conversations. Explicit overview may include their diagnostic excerpts.
func situationAgents(m *AgentManager, self string, includeConversationDetails bool) []map[string]any {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	ids := make([]string, 0, len(m.jobs))
	for id, j := range m.jobs {
		// Old primary executors are retained receipts of this same identity,
		// not specialists to supervise. Re-injecting their task/result would
		// undo a new conversation or the user's explicit context replacement.
		if m.workspace != nil && j.record.Spec.WorkspaceRole == WorkspaceMatrix {
			continue
		}
		if id != self && !j.record.DeletionPending {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	rows := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		r := m.jobs[id].record
		pending := 0
		for _, q := range r.HumanRequests {
			if q.State == "preparing" || q.State == "waiting_user" {
				pending++
			}
		}
		capabilities := slices.Clone(r.Spec.Tools)
		sort.Strings(capabilities)
		row := map[string]any{"id": id, "title": utf8Prefix(r.Spec.Title, 120), "kind": r.Spec.Kind, "generation": r.Generation, "state": r.State, "model_id": r.Spec.ModelID, "updated": r.Updated, "pending_messages": len(r.PendingMessages), "pending_questions": pending, "tools": capabilities, "source": "agents.runtime"}
		details := r.Spec.Kind != "conversation" || includeConversationDetails
		if r.Spec.Kind == "conversation" {
			row["contact_id"] = conversationPromptID(r)
		}
		if details {
			row["task"] = utf8Prefix(m.redact(r.Spec.Task), 300)
		}
		if r.Instance != nil {
			row["package"], row["instance_revision"], row["disabled"], row["supervisor"] = r.Spec.AgentPackage, r.Instance.Revision, r.Instance.Disabled, r.Instance.Supervisor
		}
		if r.Result != "" && r.Spec.Kind != "conversation" {
			row["result_excerpt"] = utf8Prefix(m.redact(r.Result), 300)
		}
		if details && r.Error != "" {
			row["error"] = utf8Prefix(m.redact(r.Error), 200)
		} else if !details && r.Failure != nil {
			row["failure_code"] = r.Failure.Code
		}
		rows = append(rows, row)
	}
	return rows
}

func (w *Workspace) liveAgentManagers() (primary, conversations, packages, workflows *AgentManager) {
	w.host.mu.Lock()
	conversations = w.host.conversations
	w.host.mu.Unlock()
	primary = w.manager
	if primary != nil {
		packages, workflows = primary.packageHost.Load(), primary.workboxHost.Load()
	}
	return
}

func (w *Workspace) situation(ctx context.Context, self string) string {
	if w == nil || w.host == nil || w.Mode() != HostOS || w.isTerminal() {
		return ""
	}
	primary, cm, packages, workflows := w.liveAgentManagers()
	sources := map[string]bool{"primary": primary != nil, "conversations": cm != nil, "packages": packages != nil, "workflows": workflows != nil}
	agents := situationAgents(primary, self, false)
	for _, manager := range []*AgentManager{cm, packages, workflows} {
		if manager != primary {
			agents = append(agents, situationAgents(manager, self, false)...)
		}
	}
	// Active and unresolved instances remain visible when the overview is full.
	sort.SliceStable(agents, func(i, j int) bool {
		a, b := agents[i], agents[j]
		priority := func(row map[string]any) bool {
			s := row["state"].(string)
			return activeAgent(s) || s == "failed" || row["pending_messages"].(int) > 0 || row["pending_questions"].(int) > 0
		}
		if priority(a) != priority(b) {
			return priority(a)
		}
		return a["id"].(string) < b["id"].(string)
	})
	state := map[string]any{"schema": "aieyra.situation/1", "shell": w.shellSituation(ctx), "agents": agents[:min(len(agents), 32)], "agent_total": len(agents), "agents_truncated": len(agents) > 32, "loaded_sources": sources, "details": map[string]any{"tool": "agents", "action": "overview"}}
	if cm != nil {
		if project, err := cm.readCodingProject(); err == nil {
			state["coding_project"] = map[string]any{"root": project.Root, "active_file": project.ActiveFile, "unsaved": project.Unsaved, "revision": project.Revision}
		} else {
			state["coding_project"] = map[string]any{"available": false}
		}
	}
	state["version"] = workspaceTextHash(string(rawJSON(state)))
	return string(rawJSON(state))
}

// Explicit discovery loads retained metadata, never starts an executor. The
// automatic context uses only the compact observation above. Pagination is
// fenced by the content version so a changed catalogue cannot skip rows.
func (w *Workspace) agentOverview(ctx context.Context, raw json.RawMessage) (any, error) {
	var p struct {
		Cursor  int    `json:"cursor"`
		Limit   int    `json:"limit"`
		Version string `json:"expected_version"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if p.Cursor < 0 || p.Limit < 0 || p.Limit > 64 {
		return nil, fmt.Errorf("overview cursor/limit 无效；每页最多64项")
	}
	if p.Cursor > 0 && p.Version == "" {
		return nil, fmt.Errorf("翻页需要 expected_version")
	}
	if p.Limit == 0 {
		p.Limit = 32
	}
	cm, err := w.host.conversationManager()
	if err != nil {
		return nil, err
	}
	if err = cm.syncInstalledProgramContacts(ctx); err != nil {
		return nil, err
	}
	for _, ensure := range []func(bool) (*AgentManager, error){w.manager.ensurePackageAgentHost, w.manager.ensureWorkboxHost} {
		if _, err = ensure(false); err != nil {
			return nil, err
		}
	}
	contacts, err := cm.listContacts()
	if err != nil {
		return nil, err
	}
	rows := []map[string]any{}
	for _, c := range contacts {
		rows = append(rows, map[string]any{"type": "contact", "id": c["id"], "name": c["name"], "description": c["description"], "builtin": c["builtin"], "program": c["program"], "model_id": c["model_id"], "model_inherited": c["model_inherited"], "model_error": c["model_error"], "tools": c["tools"], "source": "conversation.contacts"})
	}
	bound, _ := ctx.Value(conversationLinkCallerKey{}).(conversationLinkCaller)
	for _, manager := range []*AgentManager{w.manager, cm, w.manager.packageHost.Load(), w.manager.workboxHost.Load()} {
		for _, row := range situationAgents(manager, bound.ID, true) {
			row["type"] = "instance"
			rows = append(rows, row)
		}
	}
	sources, err := w.manager.agentPackageSources(ctx)
	if err != nil {
		return nil, err
	}
	// The source operation already returns public manifests; only summaries
	// belong in the overview, and full definitions remain available on demand.
	var catalog struct {
		Sources []struct {
			Identity string `json:"identity"`
			Enabled  bool   `json:"enabled"`
			Manifest struct{ ID, Name, Version, Summary string }
		} `json:"sources"`
	}
	if err = json.Unmarshal(rawJSON(sources), &catalog); err != nil {
		return nil, err
	}
	for _, source := range catalog.Sources {
		rows = append(rows, map[string]any{"type": "package", "id": source.Manifest.ID, "identity": source.Identity, "name": source.Manifest.Name, "version": source.Manifest.Version, "description": source.Manifest.Summary, "enabled": source.Enabled, "source": "packages.registry"})
	}
	sort.Slice(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if a["type"] != b["type"] {
			return a["type"].(string) < b["type"].(string)
		}
		return a["id"].(string) < b["id"].(string)
	})
	version := workspaceTextHash(string(rawJSON(rows)))
	if p.Version != "" && p.Version != version {
		return nil, fmt.Errorf("态势已变化，请从首页重新读取")
	}
	if p.Cursor > len(rows) {
		return nil, fmt.Errorf("overview cursor 超出范围")
	}
	end := min(len(rows), p.Cursor+p.Limit)
	result := map[string]any{"ok": true, "version": version, "source": "agents.overview", "observed_at": time.Now().UTC().Format(time.RFC3339Nano), "total": len(rows), "entries": rows[p.Cursor:end], "has_more": end < len(rows)}
	if end < len(rows) {
		result["next_cursor"] = end
	}
	return result, nil
}
