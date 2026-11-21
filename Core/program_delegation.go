// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: motherProgramCall; ownsProgramDelegation; programAssignmentBrief; programDelegationAction; programReceiptInput; programReceiptOutput; pendingProgramResult; archivedProgramResultReadLocked; programResultRead; programResultArguments; programResultTarget; pendingProgramWaits; awaitProgramDelivery; codingResultBrief; recordCodingLinkBrief
// Impact: python -B scripts/code-atlas.py show Core/program_delegation.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// Program delegation uses the mother's existing durable Core Link mailbox.
// The member is the program's own persistent session, never an invitation copy.
// The caller has already acquired the real mother's admission fence and audit.
func (w *Workspace) motherProgramCall(ctx context.Context, real AgentRecord, scope string, raw json.RawMessage) (any, error) {
	var p struct {
		Action, Program, Message, Reason, Brief string
		RequestID                               string `json:"request_id"`
		Generation                              *int   `json:"generation"`
		TimeoutMS                               int    `json:"timeout_ms"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	cm, err := w.host.conversationManager()
	if err != nil {
		return nil, err
	}
	action := "program"
	if p.Action == "program_send" {
		action = "program_open"
	}
	value, err := w.host.programAgentCall(ctx, cm, rawJSON(map[string]any{"action": action, "program": p.Program}))
	if err != nil {
		return nil, err
	}
	binding := value.(map[string]any)
	if p.Action == "program_send" && binding["configured"] != true {
		return nil, fmt.Errorf("程序 %s 尚未配置模型，请在联系人中设置", p.Program)
	}
	session, ok := binding["session"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("程序尚无会话")
	}
	target, err := cm.Status(cm.owner, session["id"].(string))
	if err != nil {
		return nil, err
	}
	if p.Action == "program_result" {
		if p.Generation == nil || target.Generation != *p.Generation {
			return nil, fmt.Errorf("程序代次已变化，请先读取程序状态")
		}
		if !ownsProgramDelegation(target, scope) {
			return nil, fmt.Errorf("只能读取本会话委派的相同程序代次")
		}
		if p.TimeoutMS > 0 && activeAgent(target.State) {
			target, err = cm.Wait(ctx, cm.owner, target.ID, p.TimeoutMS)
			if err != nil {
				return nil, err
			}
			if target.Generation != *p.Generation {
				return nil, fmt.Errorf("程序代次已变化，请先读取程序状态")
			}
		}
		text, err := cm.conversationResult(target.ID, *p.Generation, target.Result)
		return map[string]any{"id": target.ID, "program": p.Program, "generation": *p.Generation, "state": target.State, "result": cm.redact(text), "error": cm.redact(target.Error)}, err
	}
	if p.Action == "program_cancel" {
		if p.Generation == nil || target.Generation != *p.Generation || !ownsProgramDelegation(target, scope) {
			return nil, fmt.Errorf("只能停止当前母体委派的相同程序代次")
		}
		err := cm.CancelGeneration(cm.owner, target.ID, *p.Generation)
		return map[string]any{"accepted": err == nil, "id": target.ID, "generation": *p.Generation}, err
	}
	if strings.TrimSpace(p.Message) == "" {
		return nil, fmt.Errorf("程序委派需要任务正文 message")
	}
	w.manager.linkRootService.Store(cm)
	conversationGroupsMu.Lock()
	defer conversationGroupsMu.Unlock()
	mother, room, err := cm.bindWorkspaceLink(real, scope)
	if err != nil {
		return nil, err
	}
	if room.ProgramMembers == nil {
		room.ProgramMembers = map[string]string{}
	}
	if room.ProgramMembers[target.ID] != p.Program {
		room.ProgramMembers[target.ID] = p.Program
		if err = cm.writeGroup(room); err != nil {
			return nil, err
		}
	}
	text := "[Eyra 程序委派；原因：" + p.Reason + "]\n" + p.Message
	brief := programAssignmentBrief(p.Program, p.Brief, p.Message, text)
	generation := target.Generation
	if p.Generation != nil {
		generation = *p.Generation
	} else if prior, found, e := cm.groupFindRequest(room, linkMessageRequest(mother.ID, p.RequestID)); e != nil {
		return nil, e
	} else if found {
		generation = prior.TargetGeneration
	}
	return cm.linkPost(ctx, room, mother, target, generation, p.RequestID, text, brief, "message", 0)
}

func ownsProgramDelegation(target AgentRecord, scope string) bool {
	for request, origin := range target.TurnOrigins {
		if origin.Scope == scope && origin.From == scope && origin.Kind == "message" && target.TurnGenerations[request] == target.Generation {
			return true
		}
	}
	return false
}

func programAssignmentBrief(program, brief, message, envelope string) string {
	brief = briefText(brief, talkBriefLimit)
	if brief != "" && brief != briefText(message, talkBriefLimit) && brief != briefText(envelope, talkBriefLimit) {
		return brief
	}
	if program == "coding" {
		return "Cota，这项编程任务交给你。"
	}
	return "这项任务交给你。"
}

func programDelegationAction(tool, action string) bool {
	return (tool == "agents" || tool == "core_link") && (action == "program_send" || action == "program_result" || action == "program_cancel")
}

func programReceiptInput(action string, args map[string]json.RawMessage) json.RawMessage {
	program := activityText(args, "program")
	public := map[string]string{"action": action, "program": program}
	if action == "program_send" {
		message := activityText(args, "message")
		envelope := "[Eyra 程序委派；原因：" + activityText(args, "reason") + "]\n" + message
		public["brief"] = programAssignmentBrief(program, activityText(args, "brief"), message, envelope)
	}
	return rawJSON(public)
}

func programReceiptOutput(output string) json.RawMessage {
	if output == "" {
		return nil
	}
	var receipt struct {
		OK    bool   `json:"ok"`
		State string `json:"state"`
		Data  *struct {
			State      string `json:"state,omitempty"`
			Generation int    `json:"generation,omitempty"`
			Accepted   *bool  `json:"accepted,omitempty"`
			Queued     *bool  `json:"queued,omitempty"`
			Committed  *bool  `json:"committed,omitempty"`
		} `json:"data,omitempty"`
	}
	if json.Unmarshal([]byte(output), &receipt) != nil {
		return nil
	}
	return rawJSON(receipt)
}

func pendingProgramResult(msg workspaceMessage) bool {
	return msg.To == WorkspaceMatrix && msg.Repair == nil && msg.CoreLink != nil && msg.CoreLink.Kind == "result"
}

func (w *Workspace) archivedProgramResultReadLocked(msg workspaceMessage) bool {
	if !pendingProgramResult(msg) {
		return false
	}
	archive, err := w.contextArchiveLocked()
	if err != nil {
		return false
	}
	restored, err := archive.read()
	if err != nil {
		return false
	}
	history := restored.Messages
	if turn := restored.RecoveredTool; turn != nil {
		history = history[:len(history)-len(turn.Messages)]
	}
	return programResultRead(history, msg)
}

// Match a result only against the successful tool transaction that returned
// that member's completed generation. Pending reads and repair events still
// need the mailbox.
func programResultRead(history []Message, msg workspaceMessage) bool {
	if !pendingProgramResult(msg) {
		return false
	}
	var calls []ToolCall
	for _, message := range history {
		switch message.Role {
		case RoleAssistant:
			calls = message.ToolCalls
		case RoleTool:
			for _, call := range calls {
				if call.ID != message.ToolCallID {
					continue
				}
				args := programResultArguments(call)
				if activityText(args, "action") != "program_result" {
					continue
				}
				var result struct {
					OK   bool
					Data struct {
						ID, State  string
						Generation int
					}
				}
				if json.Unmarshal([]byte(message.Content), &result) == nil && result.OK &&
					result.Data.State == "completed" && result.Data.ID == msg.From &&
					result.Data.Generation == msg.CoreLink.Generation {
					return true
				}
			}
		default:
			calls = nil
		}
	}
	return false
}

func programResultArguments(call ToolCall) map[string]json.RawMessage {
	args := activityArgs(call)
	switch call.Function.Name {
	case "agents", "core_link":
		return args
	case "toolbox":
		if activityText(args, "action") == "call" && activityText(args, "name") == "agents" {
			var nested map[string]json.RawMessage
			if json.Unmarshal(args["arguments"], &nested) == nil {
				return nested
			}
		}
	}
	return nil
}

type programResultTarget struct {
	ID         string `json:"id"`
	Generation int    `json:"generation"`
}

// Current-turn tool receipts prove an explicit wait and its identity, even
// if context compaction already hid the tool exchange from the model.
func pendingProgramWaits(history []Message) []programResultTarget {
	var calls []ToolCall
	var order []programResultTarget
	pending := map[programResultTarget]bool{}
	for _, message := range history {
		if message.Role == RoleAssistant {
			calls = message.ToolCalls
			continue
		}
		if message.Role != RoleTool {
			calls = nil
			continue
		}
		for _, call := range calls {
			if call.ID != message.ToolCallID {
				continue
			}
			args := programResultArguments(call)
			if activityText(args, "action") != "program_result" {
				break
			}
			var result struct {
				OK   bool
				Data struct {
					programResultTarget
					State string
				}
			}
			if json.Unmarshal([]byte(message.Content), &result) != nil || !result.OK || result.Data.ID == "" || result.Data.Generation < 1 {
				break
			}
			target := result.Data.programResultTarget
			if !activeAgent(result.Data.State) || result.Data.State == "waiting_user" {
				pending[target] = false
				break
			}
			var timeout int
			_ = json.Unmarshal(args["timeout_ms"], &timeout)
			if _, seen := pending[target]; !seen {
				order = append(order, target)
			}
			pending[target] = pending[target] || timeout > 0
			break
		}
	}
	waits := order[:0]
	for _, target := range order {
		if pending[target] {
			waits = append(waits, target)
		}
	}
	return waits
}

func (w *Workspace) awaitProgramDelivery(ctx context.Context, history []Message, observed map[programResultTarget]bool) (string, error) {
	targets := pendingProgramWaits(history)
	if len(targets) == 0 {
		return "", nil
	}
	manager := w.manager.linkRootService.Load()
	if manager == nil {
		return "", nil
	}
	w.mu.Lock()
	scope := w.coreLinkScopeLocked()
	w.mu.Unlock()
	var ready []programResultTarget
	for _, target := range targets {
		if observed[target] {
			continue
		}
		record, err := manager.Status(manager.owner, target.ID)
		for err == nil && record.Generation == target.Generation && ownsProgramDelegation(record, scope) &&
			activeAgent(record.State) && record.State != "waiting_user" {
			record, err = manager.Wait(ctx, manager.owner, target.ID, 25000)
		}
		if err != nil {
			return "", err
		}
		observed[target] = true
		ready = append(ready, target)
	}
	if len(ready) == 0 {
		return "", nil
	}
	return "刚才的回复是等待进度。请按本轮原委派及代次核对实际回报，再给出最终答复。程序实例：" + string(rawJSON(ready)), nil
}

func codingResultBrief(record AgentRecord) string {
	switch record.State {
	case "completed":
		return resultBrief(record)
	case "cancelled", "interrupted":
		return "这次编程任务已停止，进度已保留。"
	case "persistence_failed":
		return "结果保存遇到问题，已有回执可查。"
	case "timed_out":
		if record.Failure == nil || record.Failure.Code != modelFirstResponseTimeout && record.Failure.Code != modelStreamIdleTimeout {
			return "这次编程任务等待超时，进度已保留。"
		}
	}
	if record.Failure != nil {
		switch record.Failure.Code {
		case "provider_unavailable", "timeout", modelFirstResponseTimeout, modelStreamIdleTimeout, "rate_limit", "quota", "model_unavailable",
			"model_retired", "account_cooling", "access_denied", "unfinished_shell", "unfinished_execution",
			"task_request_limit", "task_token_limit":
			return record.Failure.Title + "，这次编程任务未完成。"
		case "empty_final":
			return "这次编程任务没有收到最终回复，已有进度可查。"
		case "invalid_tool_response", "tool_package_disabled":
			return "执行所需的工具遇到问题，这次编程任务未完成。"
		}
	}
	return "这次编程任务未完成，已有回执可查。"
}

// Keep the public line in the managed group's ordered history. The mailbox
// remains responsible for dispatch and durable Agent-to-Agent delivery.
func (m *AgentManager) recordCodingLinkBrief(room *conversationGroup, msg groupMessage, generation int) error {
	if generation < 1 || room.WorkspaceLink == nil && room.LinkScope != codingScopeID() {
		return nil
	}
	member, from, brief := "", "", msg.Brief
	if room.WorkspaceLink != nil {
		switch {
		case msg.Kind == "message" && msg.From == room.Host.Session && room.ProgramMembers[msg.To] == "coding":
			member, from = msg.To, "eyra"
			if brief == "" {
				brief = "Cota，这项编程任务交给你。"
			}
		case msg.Kind == "result" && msg.To == room.Host.Session && room.ProgramMembers[msg.From] == "coding":
			member, from = msg.From, groupHost
		default:
			return nil
		}
	} else if msg.Kind != "message" && msg.Kind != "result" || msg.SenderGeneration < 1 {
		return nil
	}
	g, err := m.readGroup(codingScopeID())
	if err != nil {
		return err
	}
	if g.ManagedProgram != "coding" || member != "" && g.Host.Session != member {
		return nil
	}
	if room.WorkspaceLink == nil {
		var to string
		for _, member := range append([]groupMember{g.Host}, g.Members...) {
			if member.Session == msg.From {
				from = member.Contact
			}
			if member.Session == msg.To {
				to = member.Contact
			}
		}
		if from == "" || to == "" || from == to {
			return nil
		}
		generation = msg.SenderGeneration
		private, _, _ := strings.Cut(msg.Text, "\n完整结果引用：instance=")
		if brief == "" || brief == briefText(private, talkBriefLimit) {
			if msg.Kind == "message" {
				brief = "请你协助处理这项工作。"
			} else {
				brief = "已回报这项工作的结果。"
			}
		}
	}
	request := "coding-brief:" + msg.Request
	if _, found, err := m.groupFindRequest(g, request); found || err != nil {
		return err
	}
	_, err = m.appendGroupMessage(g, groupMessage{From: from, Kind: "brief", Brief: m.redact(briefText(brief, talkBriefLimit)), Text: "", Request: request, SenderGeneration: generation})
	return err
}
