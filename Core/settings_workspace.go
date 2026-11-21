// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: workspaceSettings
// Impact: python -B scripts/code-atlas.py show Core/settings_workspace.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// Workspace presentation lives in the existing workspace state. This facade
// gives the settings tool access without enabling unrelated workspace tools.
func workspaceSettings(ctx context.Context, raw json.RawMessage) (json.RawMessage, bool, error) {
	var p struct {
		Scope    string          `json:"scope"`
		Action   string          `json:"action"`
		Expected string          `json:"expected_version"`
		Recovery string          `json:"recovery_id"`
		Patch    json.RawMessage `json:"patch"`
	}
	if json.Unmarshal(raw, &p) != nil || p.Scope != "workspace" {
		return nil, false, nil
	}
	c, ok := ctx.Value(workspaceContextKey{}).(workspaceContext)
	w := c.workspace
	if bound, program := ctx.Value(programAgentContextKey{}).(programAgentContext); program {
		var err error
		w, err = bound.primaryWorkspace(ctx)
		if err != nil {
			return nil, true, err
		}
	} else if !ok || w == nil || c.role != WorkspaceMatrix {
		return nil, true, fmt.Errorf("当前会话没有主工作区设置")
	}
	if err := ctx.Err(); err != nil {
		return nil, true, err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	old, previous := w.state.Theme, w.state.PreviousTheme
	version := workspaceTextHash(string(rawJSON(old)))
	recovery := ""
	if previous != nil {
		recovery = "workspace-" + workspaceTextHash(string(rawJSON(previous)))
	}
	r := map[string]any{"ok": true, "scope": "workspace", "version": version, "settings": old, "recovery_id": recovery, "effect": map[string]any{"when": "live", "status": "pending_observation", "consumer": "workspace snapshot.theme"}}
	finish := func() (json.RawMessage, bool, error) { return rawJSON(r), true, nil }
	if p.Action == "schema" {
		r["fields"] = map[string]any{
			"background": map[string]any{"type": "string", "format": "#RRGGBB"}, "foreground": map[string]any{"type": "string", "format": "#RRGGBB"},
			"accent": map[string]any{"type": "string", "format": "#RRGGBB"}, "surface": map[string]any{"type": "string", "format": "#RRGGBB"},
			"scale": map[string]any{"type": "number", "minimum": .85, "maximum": 1.4}, "reduced_motion": map[string]any{"type": "boolean"},
		}
		return finish()
	}
	if p.Action == "inspect" {
		return finish()
	}
	if p.Action != "validate" && p.Action != "apply" && p.Action != "restore" {
		return nil, true, fmt.Errorf("未知工作区设置操作")
	}
	if p.Expected != version {
		r["ok"], r["code"], r["error"], r["saved"] = false, "version_conflict", "主题已变化，请重新读取后修改", false
		return finish()
	}
	next := old
	if p.Action == "restore" {
		if previous == nil || p.Recovery == "" || p.Recovery != recovery {
			return nil, true, fmt.Errorf("工作区恢复点已变化，请重新读取")
		}
		next = *previous
	} else {
		var fields map[string]json.RawMessage
		if json.Unmarshal(p.Patch, &fields) != nil || fields == nil {
			return nil, true, fmt.Errorf("patch 必须为对象")
		}
		for key, value := range fields {
			if string(value) == "null" {
				return nil, true, fmt.Errorf("主题字段 %s 不能为 null", key)
			}
		}
		d := json.NewDecoder(strings.NewReader(string(p.Patch)))
		d.DisallowUnknownFields()
		if err := d.Decode(&next); err != nil {
			return nil, true, err
		}
		for _, color := range []string{next.Background, next.Foreground, next.Accent, next.Surface} {
			if !workspaceColor.MatchString(color) {
				return nil, true, fmt.Errorf("颜色必须是 #RRGGBB")
			}
		}
		if next.Scale < .85 || next.Scale > 1.4 {
			return nil, true, fmt.Errorf("scale must be 0.85..1.4")
		}
	}
	r["changed"], r["settings"] = next != old, next
	if p.Action == "validate" {
		r["validated"], r["saved"] = true, false
		return finish()
	}
	if next == old {
		r["saved"] = true
		r["effect"] = map[string]any{"when": "live", "status": "unchanged"}
		return finish()
	}
	w.state.Theme, w.state.PreviousTheme = next, &old
	if err := w.saveLocked(); err != nil {
		w.state.Theme, w.state.PreviousTheme = old, previous
		return nil, true, err
	}
	w.feed.publish(c.role, "theme", next)
	r["saved"], r["version"], r["recovery_id"] = true, workspaceTextHash(string(rawJSON(next))), "workspace-"+version
	return finish()
}
