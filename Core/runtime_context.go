// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: runtimeContextNames; runtimeContextUpdate; validate; runtimeContextRemoved; runtimeContextDelta; decodeRuntimeContext
// Impact: python -B scripts/code-atlas.py show Core/runtime_context.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"sort"
)

// These are request-time observations, never user messages or the role's
// editable personality. A committed observation is immutable history. Later
// observations append a delta, including explicit removal of obsolete data.
var runtimeContextNames = map[string]bool{
	"aieyra_shell_runtime": true, "mother_identity_handoff": true,
	"core_link_catalog": true, "aieyra_toolbox_catalogue": true,
	"station_reference": true, "capability_reference": true,
	"matrix_home_navigation": true, "user_display_profile": true,
	"pac_memory": true, "background_history": true, "memory_surface": true,
	"startup_history_boundary": true, "persistent_task_state": true,
	"mother_identity_result": true, "plan_task_boundary": true,
	"aieyra_toolbox_open": true, "aieyra_runtime_result": true,
	"output_continuation": true, "current_memory_profile": true,
	"pac_merge_boundary": true, "aieyra_clock": true,
	"aieyra_background_sessions": true, "task_budget_notice": true,
	"context_compaction_result": true, "aieyra_situation": true,
	"attachment_observation": true,
}

type runtimeContextUpdate struct {
	Version  int       `json:"version"`
	Messages []Message `json:"messages"`
}

func (u runtimeContextUpdate) validate() error {
	if u.Version != 1 || len(u.Messages) == 0 || len(u.Messages) > len(runtimeContextNames) {
		return fmt.Errorf("invalid runtime context update")
	}
	seen := map[string]bool{}
	for _, m := range u.Messages {
		if !runtimeContextNames[m.Name] || seen[m.Name] || (m.Role != RoleSystem && m.Role != RoleUser) || len(m.Content) > 1<<20 || len(m.ToolCalls)+len(m.Images)+len(m.IncompleteTools)+len(m.ResponseItems) > 0 || m.ToolCallID != "" || len(m.NativeContent) > 0 {
			return fmt.Errorf("invalid runtime context section: %s", m.Name)
		}
		seen[m.Name] = true
	}
	return nil
}

const runtimeContextRemoved = `{"available":false,"state":"removed"}`

// Only retained history participates: after compaction the complete current
// state is supplied again. Equal polls and reopened sessions add no noise.
func runtimeContextDelta(history, observations []Message) runtimeContextUpdate {
	previous, current := map[string]Message{}, map[string]Message{}
	for _, m := range history {
		if runtimeContextNames[m.Name] {
			previous[m.Name] = m
		}
	}
	for _, m := range observations {
		if runtimeContextNames[m.Name] && m.Content != "" {
			current[m.Name] = m
		}
	}
	for name, old := range previous {
		if _, exists := current[name]; !exists && old.Content != runtimeContextRemoved {
			current[name] = Message{Role: old.Role, Name: name, Content: runtimeContextRemoved}
		}
	}
	keys := make([]string, 0, len(current))
	for name := range current {
		keys = append(keys, name)
	}
	sort.Strings(keys)
	u := runtimeContextUpdate{Version: 1}
	for _, name := range keys {
		m, old := current[name], previous[name]
		if m.Role != old.Role || m.Content != old.Content {
			m.ContextObservation = true
			u.Messages = append(u.Messages, m)
		}
	}
	return u
}

func decodeRuntimeContext(raw json.RawMessage) (runtimeContextUpdate, error) {
	var u runtimeContextUpdate
	if err := json.Unmarshal(raw, &u); err != nil {
		return u, err
	}
	for i := range u.Messages {
		u.Messages[i].ContextObservation = true
	}
	return u, u.validate()
}
