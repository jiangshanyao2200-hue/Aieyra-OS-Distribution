// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: program
// Regions: serviceCall; primaryWorkspace; manage; routed
// Impact: python -B scripts/code-atlas.py show Core/program_agent_tools.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
)

// Program tools call the same desktop/settings services with the program's
// own durable session. No Matrix identity or primary context is fabricated.
func (p programAgentContext) serviceCall(ctx context.Context, name string, raw json.RawMessage) (json.RawMessage, error) {
	if err := p.valid(ctx); err != nil {
		return nil, err
	}
	if p.manager.service == nil || p.manager.linkHome == nil || p.manager.linkHome.terminal {
		return nil, fmt.Errorf("程序服务仅在OS桌面可用")
	}
	return p.manager.service.CallTool(ctx, name, p.record.ID, raw)
}

func (p programAgentContext) primaryWorkspace(ctx context.Context) (*Workspace, error) {
	if err := p.valid(ctx); err != nil {
		return nil, err
	}
	h := p.manager.linkHome
	if h == nil {
		return nil, fmt.Errorf("OS主工作区尚未就绪")
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	var result *Workspace
	for _, w := range h.workspaces {
		if w.coreLinkRegistered.Load() {
			if result != nil {
				return nil, fmt.Errorf("主工作区身份不唯一")
			}
			result = w
		}
	}
	if result == nil {
		return nil, fmt.Errorf("OS主工作区尚未就绪")
	}
	return result, nil
}

func (p programAgentContext) manage(ctx context.Context, raw json.RawMessage) (any, error) {
	if err := p.valid(ctx); err != nil {
		return nil, err
	}
	if p.program != "contacts" || p.manager.linkHome == nil {
		return nil, fmt.Errorf("此程序没有联系人管理职责")
	}
	var args struct {
		Action, Reason string
		RequestID      string `json:"request_id"`
	}
	if err := json.Unmarshal(raw, &args); err != nil {
		return nil, err
	}
	read := slices.Contains([]string{"programs", "program", "models", "contacts", "contact", "list", "status", "snapshot", "settings", "groups", "group", "session_usage"}, args.Action)
	if !read && !slices.Contains([]string{"create", "contact_create", "contact_update", "contact_delete", "session_create", "session_delete", "configure", "group_create", "group_update", "group_delete", "group_stop"}, args.Action) {
		return nil, fmt.Errorf("未知联系人管理操作")
	}
	if !read && (strings.TrimSpace(args.Reason) == "" || len(args.Reason) > 2000 || args.RequestID == "" || len(args.RequestID) > 96) {
		return nil, fmt.Errorf("管理变更需要reason与稳定request_id")
	}
	admin := context.WithValue(ctx, conversationCallerKey{}, "program:"+p.program)
	admin = context.WithValue(admin, liveToolPermissionKey{}, (func(string) bool)(nil))
	return p.manager.linkHome.conversationCall(conversationPermissions(admin), raw)
}

func (p programAgentContext) routed(ctx context.Context, target string, raw json.RawMessage) (json.RawMessage, error) {
	if err := p.valid(ctx); err != nil {
		return nil, err
	}
	if p.manager.service == nil {
		return nil, fmt.Errorf("程序服务尚未就绪")
	}
	if target == "community" {
		return p.manager.service.Community(ctx, raw)
	}
	if target == "updates" {
		var args struct{ Action string }
		if json.Unmarshal(raw, &args) != nil || !slices.Contains([]string{"status", "check", "review", "read_file", "resolve_file", "prepare", "verify", "decide"}, args.Action) {
			return nil, fmt.Errorf("更新提交由可信宿主完成，请先查询更新回执")
		}
		return p.serviceCall(ctx, "updates", raw)
	}
	return nil, fmt.Errorf("此旧软件动作请使用software_api的program、module或settings接口")
}
