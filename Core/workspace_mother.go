// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: validateMotherAudit; motherConversationCall
// Impact: python -B scripts/code-atlas.py show Core/workspace_mother.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

func validateMotherAudit(raw json.RawMessage) error {
	var v struct {
		Operator, Scope, Action, Reason, Phase string
		RequestID                              string `json:"request_id"`
		Generation                             int
	}
	if json.Unmarshal(raw, &v) != nil {
		return fmt.Errorf("母体管理审计格式无效")
	}
	if v.Operator == "" || v.Scope == "" || v.Action == "" || v.RequestID == "" || len(v.RequestID) > 96 || strings.TrimSpace(v.Reason) == "" || len(v.Reason) > 2000 || v.Generation < 1 {
		return fmt.Errorf("母体管理审计身份无效")
	}
	if v.Phase != "requested" && v.Phase != "completed" && v.Phase != "failed" {
		return fmt.Errorf("母体管理审计状态无效")
	}
	return nil
}

// User RPCs already enter the common conversation service directly. Model
// administration requires the actual primary actor, never a contact named Eyra
// or a workspace-shaped projection. Tool transactions retain the full original
// request/receipt; this audit adds the operator and purpose to the same archive.
func (w *Workspace) motherConversationCall(ctx context.Context, caller string, raw json.RawMessage) (any, error) {
	bound, ok := ctx.Value(conversationLinkCallerKey{}).(conversationLinkCaller)
	if !ok || bound.ID != caller || ctx.Err() != nil {
		return nil, fmt.Errorf("会话管理需要正在运行的母体身份")
	}
	var p struct {
		Action, ID, Reason, Message string
		RequestID                   string `json:"request_id"`
		Generation                  int    `json:"generation"`
		TimeoutMS                   int    `json:"timeout_ms"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	mutation := false
	switch p.Action {
	case "overview", "programs", "program", "program_result", "compact_status", "models", "contacts", "contact", "list", "status", "snapshot", "settings", "groups", "group":
	case "program_open", "program_send", "program_cancel", "compact", "create", "contact_create", "contact_update", "contact_delete", "session_create", "session_delete", "configure", "send", "cancel", "group_create", "group_post", "group_update", "group_stop", "group_delete":
		mutation = true
	default:
		return nil, fmt.Errorf("不支持的母体会话操作")
	}
	if mutation && (strings.TrimSpace(p.Reason) == "" || len(p.Reason) > 2000 || p.RequestID == "" || len(p.RequestID) > 96) {
		return nil, fmt.Errorf("管理变更需要原因 reason 和稳定的 request_id（最多96字节）")
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
	var repair *motherRepairEvent
	if p.Action == "send" {
		for _, msg := range w.state.Messages {
			e := msg.Repair
			if e != nil && msg.State == "delivered" && msg.Generation == real.Generation && msg.AgentID == real.ID &&
				e.Service == "conversation" && e.Source == p.ID && e.Generation == p.Generation &&
				(repair == nil || e.Attempt > repair.Attempt) {
				repair = e
			}
		}
	}
	w.mu.Unlock()
	if p.Action == "program_result" && p.TimeoutMS > 0 {
		// A read-only wait must let the member's result enter the mother mailbox.
		w.manager.linkOperation.Unlock()
	} else {
		defer w.manager.linkOperation.Unlock()
	}
	if err != nil {
		return nil, err
	}
	if archive.Path == "" {
		return nil, fmt.Errorf("母体管理缺少持久会话档案")
	}
	audit := map[string]any{"operator": real.ID, "generation": real.Generation, "scope": scope, "action": p.Action, "target": p.ID, "request_id": p.RequestID, "reason": p.Reason, "phase": "requested"}
	if mutation {
		if err = archive.Append("mother_action", audit); err != nil {
			return nil, err
		}
	}
	adminCtx := context.WithValue(ctx, conversationCallerKey{}, "eyra")
	var result any
	if p.Action == "overview" {
		result, err = w.agentOverview(ctx, raw)
	} else if p.Action == "program_send" || p.Action == "program_result" || p.Action == "program_cancel" {
		result, err = w.motherProgramCall(adminCtx, real, scope, raw)
	} else if p.Action == "compact" || p.Action == "compact_status" {
		var cm *AgentManager
		cm, err = w.host.conversationManager()
		if err == nil {
			if p.Action == "compact" {
				result, err = cm.requestConversationCompaction(ctx, p.ID, p.RequestID, p.Reason, scope, p.Generation)
			} else {
				result, err = cm.conversationCompactionStatus(p.ID, p.RequestID)
			}
		}
	} else if p.Action == "send" {
		var cm *AgentManager
		cm, err = w.host.conversationManager()
		if err == nil {
			var target AgentRecord
			target, err = cm.Status(cm.owner, p.ID)
			if err == nil && target.Spec.Kind != "conversation" {
				err = fmt.Errorf("目标不是会话实例")
			}
			if err == nil {
				// Intervention is explicitly attributed, never inserted as a user
				// message and never imports the mother's own history or prompt.
				origin := conversationLinkOrigin{Scope: target.ID, From: scope, Generation: real.Generation, Kind: "intervention"}
				adminCtx = context.WithValue(adminCtx, conversationLinkOriginKey{}, origin)
				if repair != nil {
					adminCtx = context.WithValue(adminCtx, motherRepairTargetKey{}, repair)
				}
				message := "[Eyra 母体介入；原因：" + p.Reason + "]\n" + p.Message
				var admitted AgentRecord
				admitted, err = cm.sendGenerationScoped(adminCtx, cm.owner, target.ID, p.RequestID, message, taskMessageHash(message), p.Generation, nil)
				if err == nil {
					// A send receipt must not implicitly import the target's prompt,
					// prior turns or other private context into the mother's request.
					result = agentSummary(admitted)
				}
			}
		}
	} else {
		result, err = w.host.conversationCall(adminCtx, raw)
	}
	if mutation {
		audit["phase"] = "completed"
		if err != nil {
			audit["phase"], audit["error"] = "failed", w.manager.redact(err.Error())
		}
		if e := archive.Append("mother_action", audit); e != nil {
			return nil, fmt.Errorf("管理结果的审计保存失败；请先回查目标状态再继续：%w", e)
		}
	}
	return result, err
}
