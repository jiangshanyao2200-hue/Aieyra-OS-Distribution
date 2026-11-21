// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: motherPackageManagementKey; motherPackageCall
// Impact: python -B scripts/code-atlas.py show Core/workspace_mother_packages.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"
	"slices"
	"strings"
)

type motherPackageManagementKey struct{}

// The actual primary runtime can manage all local instances. A package Agent
// and a contact named Eyra retain their existing direct-supervisor scope.
func (w *Workspace) motherPackageCall(ctx context.Context, caller string, p agentPackageCommand) (any, error) {
	bound, ok := ctx.Value(conversationLinkCallerKey{}).(conversationLinkCaller)
	if !ok || bound.ID != caller || ctx.Err() != nil || !toolAllowed(ctx, "agents") {
		return nil, fmt.Errorf("管理扩展Agent需要当前母体身份")
	}
	read := slices.Contains([]string{"list", "status", "sources", "describe", "models"}, p.Action)
	if !read && !slices.Contains([]string{"create", "configure", "switch", "restore_version", "team", "send", "cancel"}, p.Action) {
		return nil, fmt.Errorf("未知扩展Agent管理操作")
	}
	if !read && (p.RequestID == "" || len(p.RequestID) > 96 || strings.TrimSpace(p.Reason) == "" || len(p.Reason) > 2000) {
		return nil, fmt.Errorf("管理变更需要reason与稳定request_id")
	}
	w.mu.Lock()
	w.manager.linkOperation.Lock()
	real, scope, err := w.coreLinkActorLocked(caller, bound.Generation)
	if err != nil {
		w.manager.linkOperation.Unlock()
		w.mu.Unlock()
		return nil, err
	}
	archive, err := w.contextArchiveLocked()
	w.mu.Unlock()
	defer w.manager.linkOperation.Unlock()
	if err != nil {
		return nil, err
	}
	if archive.Path == "" {
		return nil, fmt.Errorf("母体管理缺少持久档案")
	}
	if p.Action == "sources" {
		return w.manager.agentPackageSources(ctx)
	}
	if p.Action == "models" {
		return discoverModels(w.config, rawJSON(map[string]any{"action": "list", "category": "all"}))
	}
	manager, err := w.manager.ensurePackageAgentHost(true)
	if err != nil {
		return nil, err
	}
	if manager == nil {
		return nil, fmt.Errorf("Agent服务不可用")
	}
	if !read {
		// A disabled instance can be inspected and edited, but a stale model
		// request cannot silently restart what the user explicitly stopped.
		if p.Enabled != nil && *p.Enabled {
			return nil, fmt.Errorf("启用已停用实例需要用户在设置中操作")
		}
		if p.Tools != nil {
			for _, tool := range *p.Tools {
				if !toolAllowed(ctx, tool) {
					return nil, fmt.Errorf("tool_not_assigned: %s", tool)
				}
			}
		}
	}
	audit := map[string]any{"operator": real.ID, "generation": real.Generation, "scope": scope, "action": "package." + p.Action, "target": p.ID, "request_id": p.RequestID, "reason": p.Reason, "phase": "requested"}
	if !read {
		if err = archive.Append("mother_action", audit); err != nil {
			return nil, err
		}
	}
	actor := manager.owner
	if p.Action == "create" {
		actor = "primary"
	} // new instances retain a real supervisor and restricted tool defaults
	result, err := manager.packageAgentCommand(context.WithValue(ctx, motherPackageManagementKey{}, true), actor, p)
	if !read {
		audit["phase"] = "completed"
		if err != nil {
			audit["phase"], audit["error"] = "failed", w.manager.redact(err.Error())
		}
		if e := archive.Append("mother_action", audit); e != nil {
			return nil, fmt.Errorf("管理结果审计未保存，请先读取目标状态：%w", e)
		}
		if row, ok := result.(AgentRecord); ok {
			out := agentSummary(row)
			out["tools"] = row.Spec.Tools
			if row.Instance != nil {
				out["instance_revision"], out["supervisor"], out["disabled"] = row.Instance.Revision, row.Instance.Supervisor, row.Instance.Disabled
			}
			return out, err
		}
	}
	return result, err
}
