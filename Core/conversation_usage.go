// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: conversationUsageScope; conversationUsage
// Impact: python -B scripts/code-atlas.py show Core/conversation_usage.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"sort"
)

// One accounting scope is a user conversation, not a contact or execution
// instance. Nested collaborators retain the original scope through Core Link.
func conversationUsageScope(r AgentRecord) string {
	if r.Spec.GroupID != "" {
		return r.Spec.GroupID
	}
	if r.Link != nil {
		return r.Link.Scope
	}
	return r.ID
}

func (m *AgentManager) conversationUsage(id string, all bool) map[string]any {
	records := m.List(m.owner)
	scopes := map[string][]AgentRecord{}
	for _, r := range records {
		if r.Spec.Kind == "conversation" {
			scope := conversationUsageScope(r)
			if all || scope == id {
				scopes[scope] = append(scopes[scope], r)
			}
		}
	}
	sessions := []map[string]any{}
	for scope, rows := range scopes {
		sort.Slice(rows, func(i, j int) bool { return rows[i].ID < rows[j].ID })
		roles := []map[string]any{}
		usage := []AgentUsage{}
		recent := []map[string]any{}
		title, kind, model := "Eyra", "home", ""
		var lead *AgentRecord
		for _, r := range rows {
			name, role := r.Spec.Title, "conversation"
			if c, e := m.readContact(conversationPromptID(r)); e == nil {
				if c.Builtin != "" {
					name = m.builtinProfile(c).Name
					role = builtinConversationRole(c.Builtin)
				} else if c.Name != "" {
					name = c.Name
				}
			}
			if r.ID == scope {
				copy := r
				lead = &copy
				title, kind = name, "conversation"
			}
			if r.Spec.GroupID != "" {
				kind = "group"
			}
			roles = append(roles, map[string]any{"id": r.ID, "name": name, "role": role, "state": r.State, "usage": workspaceUsage(r.Usage), "context": r.Context})
			usage = append(usage, r.Usage...)
			for _, u := range r.Usage {
				recent = append(recent, map[string]any{"at": u.At, "role": name, "model": u.Model, "kind": u.Kind, "input": u.Input, "output": u.Output, "cached": u.Cached, "reasoning": u.Reasoning, "reported": u.Reported, "estimated": u.Estimated, "duration_ms": u.DurationMS, "session": scope, "task": r.ID})
			}
		}
		if kind == "group" {
			if g, e := m.readGroup(scope); e == nil {
				title = g.Name
				for _, r := range rows {
					if host := g.member(g.coordinatorKey()); host != nil && r.ID == host.Session {
						copy := r
						lead = &copy
					}
				}
			}
		}
		var context *AgentContext
		revision := 0
		target := ""
		override := false
		if lead != nil {
			context, revision, target = lead.Context, lead.ConversationRevision, lead.ID
			override = lead.ConversationModel != ""
			if spec, e := m.resolveConversationSpec(*lead); e == nil {
				model = spec.ModelID
			}
		}
		modelName := ""
		if model != "" {
			if s, e := m.settings(model); e == nil {
				modelName = s.Model
			}
		}
		sort.SliceStable(recent, func(i, j int) bool { return recent[i]["at"].(string) < recent[j]["at"].(string) })
		if len(recent) > 200 {
			recent = recent[len(recent)-200:]
		}
		sessions = append(sessions, map[string]any{"id": scope, "session_id": scope, "title": title, "kind": kind, "roles": roles, "usage": workspaceUsage(usage), "context": context, "model_id": model, "model_name": modelName, "model_override": override, "model_target": target, "revision": revision, "recent": recent})
	}
	sort.Slice(sessions, func(i, j int) bool { return sessions[i]["id"].(string) < sessions[j]["id"].(string) })
	return map[string]any{"ok": true, "sessions": sessions}
}
