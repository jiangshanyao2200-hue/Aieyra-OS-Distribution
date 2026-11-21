// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: chat
// Regions: conversationLinkBinding; conversationLinkOrigin; conversationLinkCreateKey; conversationLinkOriginKey; conversationLinkCallerKey; conversationLinkRecoveryKey; conversationLinkCaller; linkLogID; CoreLinkToolDefinition; coreLinkDefinition; CoreCollaborationToolDefinition; coreLinkCapable; linkScope; linkRoom; linkMembers; linkMember; linkDirectory; linkCatalog; conversationLinkView; conversationLinkDisplay; coreLinkCall; linkMessageRequest; linkPost; deliverLinkMessage; validateConversationLinkRecord; linkDescendantLocked; conversationOrigin; rememberLinkOrigin; settleLink; recoverLinkReceipts; settleLinkWithDelivery; cleanupLinkRoom; resumeLinkInbox; flushLinkInbox
// Impact: python -B scripts/code-atlas.py show Core/conversation_link.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// Core Link is an addressed mailbox over the existing Agent runtime and
// append-only conversation log. It does not require an external Link office,
// create a second executor, or borrow the recipient contact's private chat.
import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/aieyra/aieyra-os/CORE/sessionservice"
	"github.com/aieyra/aieyra-os/internal-link"
)

type conversationLinkBinding = internallink.Binding
type conversationLinkOrigin = internallink.Origin
type conversationLinkCreateKey struct{}
type conversationLinkOriginKey struct{}
type conversationLinkCallerKey struct{}
type conversationLinkRecoveryKey struct{}
type conversationLinkCaller struct {
	ID         string
	Generation int
}

func linkLogID(scope string) string {
	return internallink.LogID(scope)
}

func CoreLinkToolDefinition() ToolDefinition {
	return coreLinkDefinition(false)
}

func coreLinkDefinition(mother bool) ToolDefinition {
	actions := []string{"link_directory", "link_invite", "link_send", "link_read", "link_result", "link_stop", "link_release", "link_help"}
	parameters := map[string]any{
		"cause":      schemaEnum("help", "no_progress", "responsibility_conflict"),
		"contact_id": schemaString(), "id": schemaString(),
		"request_id": map[string]any{"type": "string", "description": "Required for link_invite and link_send. Use a stable, nonempty identifier (up to 128 bytes) for this operation."},
		"message":    map[string]any{"type": "string", "description": "Required private task text for link_send."},
		"brief":      map[string]any{"type": "string", "description": "Short user-facing summary of this communication; the full message remains in its original history."},
		"generation": map[string]any{"type": "integer"}, "after": map[string]any{"type": "integer"},
	}
	description := runtimePrompt("子代/模板/核心协作.txt")
	if mother {
		actions = append(actions, "program_send", "program_result", "program_cancel")
		parameters["program"], parameters["reason"], parameters["timeout_ms"] = schemaString(), schemaString(), map[string]any{"type": "integer"}
		description += "\nFor the OS root actor, program_send assigns work to a program's persistent agent. Supply program, request_id, reason, message and brief. Use program_result / program_cancel with the returned generation. program_result also accepts timeout_ms."
	}
	parameters["action"] = schemaEnum(actions...)
	return ToolDefinition{Type: "function", Name: "agents", Description: description, Parameters: schemaObject(parameters, "action")}
}

func CoreCollaborationToolDefinition(mother bool) ToolDefinition {
	d := coreLinkDefinition(mother)
	d.Name = "core_link"
	return d
}

func (m *AgentManager) coreLinkCapable(r AgentRecord) bool {
	return r.Spec.Kind == "conversation" || r.Spec.Kind == "workspace_link" || r.Instance != nil && m.linkContacts != nil || m.primaryCoreLink(r)
}

// conversationGroupsMu protects room creation, log commits and admission. No
// model request is waited on while this mutex is held.
func (m *AgentManager) linkScope(r AgentRecord) (scope, lead string, err error) {
	if r.Link != nil {
		return r.Link.Scope, "", nil
	}
	if r.Spec.GroupID != "" {
		g, e := m.readGroup(r.Spec.GroupID)
		if e != nil {
			return "", "", e
		}
		for _, member := range append([]groupMember{g.Host}, g.Members...) {
			if member.Session == r.ID {
				return g.ID, g.member(g.coordinatorKey()).Session, nil
			}
		}
		return "", "", fmt.Errorf("当前实例已不在原群聊")
	}
	return r.ID, r.ID, nil
}

func (m *AgentManager) linkRoom(r AgentRecord) (*conversationGroup, error) {
	scope, lead, err := m.linkScope(r)
	if err != nil {
		return nil, err
	}
	id := linkLogID(scope)
	if _, err := os.Stat(filepath.Join(m.groupDir(), id+".json")); err == nil {
		g, e := m.readGroup(id)
		if e != nil {
			return nil, e
		}
		if g.LinkScope != scope {
			return nil, fmt.Errorf("协作记录身份不匹配")
		}
		return g, nil
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	if lead == "" {
		return nil, fmt.Errorf("协作根记录缺失；原实例保留")
	}
	g := &conversationGroup{ID: id, Name: "Core Link", LinkScope: scope, Host: groupMember{Contact: groupHost, Session: lead}, Chains: map[string]int{}}
	return g, m.writeGroup(g)
}

func (m *AgentManager) linkMembers(g *conversationGroup, includeReleased ...bool) []AgentRecord {
	rows := []AgentRecord{}
	if g.WorkspaceLink != nil {
		rows = append(rows, workspaceLinkRecord(g))
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, j := range m.jobs {
		r := j.record
		programMember := false
		if program := g.ProgramMembers[r.ID]; program != "" && g.WorkspaceLink != nil {
			if program == "coding" {
				room, e := m.readGroup(codingScopeID())
				programMember = e == nil && room.ManagedProgram == "coding" && r.Spec.GroupID == room.ID && r.ID == room.Host.Session
			} else {
				c, valid := m.programContact(r)
				programMember = valid && c.Program == program
			}
		}
		if _, released := g.LinkReleased[r.ID]; released && !(len(includeReleased) > 0 && includeReleased[0]) {
			continue
		}
		if !r.DeletionPending && (programMember || r.ID == g.Host.Session || r.Link != nil && r.Link.Scope == g.LinkScope || r.Spec.GroupID != "" && r.Spec.GroupID == g.LinkScope) {
			rows = append(rows, copyRecord(r))
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].ID < rows[j].ID })
	return rows
}

func (m *AgentManager) linkMember(g *conversationGroup, id string, includeReleased ...bool) (AgentRecord, error) {
	for _, r := range m.linkMembers(g, includeReleased...) {
		if r.ID == id {
			return r, nil
		}
	}
	return AgentRecord{}, fmt.Errorf("目标不属于当前协作会话")
}

func (m *AgentManager) linkDirectory(g *conversationGroup) (map[string]any, error) {
	contacts, err := m.listContacts()
	if err != nil {
		return nil, err
	}
	catalog := []map[string]any{}
	for _, c := range contacts {
		catalog = append(catalog, map[string]any{"id": c["id"], "name": c["name"], "description": c["description"], "builtin": c["builtin"], "program": c["program"], "embedded": c["embedded"], "unavailable": c["model_error"]})
	}
	sort.Slice(catalog, func(i, j int) bool { return catalog[i]["id"].(string) < catalog[j]["id"].(string) })
	members := []map[string]any{}
	for _, r := range m.linkMembers(g) {
		row := agentSummary(r)
		delete(row, "task")
		if r.Spec.Kind == "conversation" {
			row["contact_id"] = conversationPromptID(r)
		} else {
			row["package"] = r.Spec.AgentPackage
		}
		row["lead"] = r.ID == g.Host.Session
		members = append(members, row)
	}
	return map[string]any{"scope": g.LinkScope, "lead": g.Host.Session, "contacts": catalog, "members": members, "released": len(g.LinkReleased)}, nil
}

// Stable, bounded discovery is captured once per admitted turn. Busy states,
// timestamps and message cursors stay out of the cache prefix.
func (m *AgentManager) linkCatalog(r AgentRecord) string {
	if !m.coreLinkCapable(r) {
		return ""
	}
	contacts, err := m.listContacts()
	if err != nil {
		return ""
	}
	rows := []map[string]any{}
	for _, c := range contacts {
		rows = append(rows, map[string]any{"id": c["id"], "name": c["name"], "description": clipRunes(fmt.Sprint(c["description"]), 160), "builtin": c["builtin"], "program": c["program"]})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i]["id"].(string) < rows[j]["id"].(string) })
	if len(rows) > 128 {
		rows = rows[:128]
	}
	data, _ := json.Marshal(rows)
	return "Core Link contacts (templates, not live sessions; use core_link link_directory for current availability):\n" + string(data)
}

// Display is read-only. A renderer opening a conversation never creates a
// room, dispatches messages, or resumes tasks.
// Chain chat: project addressed communication into live members and authors of
// this bounded message page. Archived identity is not a seat or execution grant.
// chat-column resolves the same author for home, OS and program surfaces;
// avatar access must enforce this same scope rather than a global Agent lookup.
func (m *AgentManager) conversationLinkView(r AgentRecord) (map[string]any, error) {
	return m.conversationLinkDisplay(r, true)
}

func (m *AgentManager) conversationLinkDisplay(r AgentRecord, includeActivity bool) (map[string]any, error) {
	conversationGroupsMu.Lock()
	defer conversationGroupsMu.Unlock()
	scope, _, e := m.linkScope(r)
	if e != nil {
		return nil, e
	}
	id := linkLogID(scope)
	if _, e = os.Stat(filepath.Join(m.groupDir(), id+".json")); os.IsNotExist(e) {
		return nil, nil
	} else if e != nil {
		return nil, e
	}
	g, e := m.readGroup(id)
	if e != nil {
		return nil, e
	}
	if _, e = m.groupIndex(g); e != nil {
		return nil, e
	}
	messages, e := m.groupRange(g, max(0, g.Seq-100), g.Seq)
	if e != nil {
		return nil, e
	}
	rows := []map[string]any{}
	authors := []map[string]any{}
	speakers := map[string]bool{}
	for _, message := range messages {
		speakers[message.From] = true
	}
	appendMember := func(row map[string]any, released bool) {
		if !released {
			rows = append(rows, row)
			return
		}
		identity := map[string]any{}
		for _, key := range []string{"id", "contact_id", "name", "avatar_rev", "ring", "role", "builtin", "lead"} {
			if value, ok := row[key]; ok {
				identity[key] = value
			}
		}
		authors = append(authors, identity)
	}
	// Released seats remain absent from live work and execution discovery.
	// Only authors of this bounded message page retain their display identity.
	for _, member := range m.linkMembers(g, true) {
		_, released := g.LinkReleased[member.ID]
		if released && !speakers[member.ID] {
			continue
		}
		if member.Instance != nil || member.Spec.Kind == "workspace_link" {
			row := agentSummary(member)
			if includeActivity {
				row["error"] = m.redact(member.Error)
			}
			row["name"], row["package"], row["lead"] = member.Spec.Title, member.Spec.AgentPackage, member.ID == g.Host.Session
			appendMember(row, released)
			continue
		}
		c, e := m.contactOf(member)
		if e != nil {
			continue
		}
		v := m.contactView(c, nil)
		row := agentSummary(member)
		for _, key := range []string{"name", "avatar_rev", "ring", "role", "builtin"} {
			row[key] = v[key]
		}
		row["contact_id"], row["lead"] = c.ID, member.ID == g.Host.Session
		if released || !includeActivity {
			appendMember(row, released)
			continue
		}
		row["error"] = m.redact(member.Error)
		if activity, err := m.Activity(m.owner, member.ID, 0, 0, 12); err == nil {
			row["activity"] = activity
		}
		if m.streamProjection != nil {
			m.streamProjection.mu.Lock()
			live := m.streamProjection.live[member.ID]
			m.streamProjection.mu.Unlock()
			if live.Generation == member.Generation {
				live.Text, live.Thought = m.redact(live.Text), m.redact(live.Thought)
				row["live"] = live
			}
		}
		appendMember(row, false)
	}
	view := map[string]any{"scope": scope, "lead": g.Host.Session, "members": rows, "authors": authors, "messages": messages, "cursor": g.Seq}
	if b := g.WorkspaceLink; b != nil {
		view["actor_id"], view["actor_generation"] = b.Actor, b.ActorGeneration
	}
	return view, nil
}

func (m *AgentManager) coreLinkCall(ctx context.Context, caller string, raw json.RawMessage) (any, error) {
	if identity, _ := ctx.Value(motherIdentityKey{}).(*motherIdentity); identity.active() && !identity.allowed("core_link") {
		return nil, fmt.Errorf("当前专业身份权限已撤销，请先退出")
	}
	if m.workspace != nil {
		if actor, err := m.Status(m.owner, caller); err == nil && m.primaryCoreLink(actor) {
			return m.workspace.routeCoreLink(ctx, caller, raw)
		}
	}

	var p internallink.Call
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	bound, ok := ctx.Value(conversationLinkCallerKey{}).(conversationLinkCaller)
	if !ok || bound.ID != caller {
		return nil, fmt.Errorf("核心协作需要真实运行实例身份")
	}
	var r AgentRecord
	var scope string
	var err error
	external, _ := ctx.Value(workspaceLinkCallerKey{}).(*Workspace)
	if external != nil {
		if external.host != m.linkHome {
			return nil, fmt.Errorf("母体协作宿主不匹配")
		}
		external.mu.Lock()
		defer external.mu.Unlock()
		external.manager.linkOperation.Lock()
		defer external.manager.linkOperation.Unlock()
		r, scope, err = external.coreLinkActorLocked(caller, bound.Generation)
	} else {
		r, err = m.Status(m.owner, caller)
	}
	if err != nil {
		return nil, err
	}
	if r.DeletionPending || r.Generation != bound.Generation || !activeAgent(r.State) || r.State == "cancelling" || ctx.Err() != nil {
		return nil, fmt.Errorf("协作调用所属运行已结束")
	}
	if p.Action == "link_help" {
		if external != nil {
			return nil, fmt.Errorf("母体不能向自身请求修理")
		}
		if p.Cause == "" {
			p.Cause = "help"
		}
		return m.requestMotherHelp(ctx, r, p.Request, p.Cause, p.Message)
	}
	conversationGroupsMu.Lock()
	defer conversationGroupsMu.Unlock()
	var g *conversationGroup
	if external != nil {
		r, g, err = m.bindWorkspaceLink(r, scope)
		caller = r.ID
	} else {
		if !m.coreLinkCapable(r) {
			return nil, fmt.Errorf("该实例不支持核心协作")
		}
		if r.Spec.Kind == "conversation" {
			err = m.checkConversationAuthority(r)
		} else {
			err = m.admitPackageSteering(ctx, r)
		}
		if err == nil {
			g, err = m.linkRoom(r)
		}
	}
	if err != nil {
		return nil, err
	}

	if _, released := g.LinkReleased[caller]; released {
		return nil, fmt.Errorf("该协作成员已结束并归档")
	}
	lead, e := m.linkMember(g, g.Host.Session)
	if e != nil || lead.LinkCancelled || lead.DeletionPending {
		return nil, fmt.Errorf("该协作会话已停止")
	}
	switch p.Action {
	case "link_directory":
		return m.linkDirectory(g)
	case "link_invite":
		if p.Request == "" || len(p.Request) > 128 {
			return nil, fmt.Errorf("需要有界 request_id")
		}
		request := "link-invite-" + workflowHash(caller+"\x00"+p.Request)
		for _, member := range m.linkMembers(g, true) {
			if member.Spec.RequestID == request {
				if member.Spec.ProfileID != p.Contact {
					return nil, fmt.Errorf("request_id conflict")
				}
				row := agentSummary(member)
				_, released := g.LinkReleased[member.ID]
				row["released"] = released
				return row, nil
			}
		}
		if len(m.linkMembers(g)) >= 32 {
			return nil, fmt.Errorf("当前协作会话已达32个实例")
		}
		c, sessions, e := m.liveContact(p.Contact)
		if e != nil {
			return nil, e
		}
		template, e := m.contactSessionTemplate(c, sessions)
		if e != nil {
			return nil, e
		}
		spec := template.Spec
		spec.RequestID = request
		spec.Kind = "conversation"
		spec.ProfileID = c.ID
		spec.GroupID = ""
		spec.Task = ""
		spec.Workdir = r.Spec.Workdir
		// Delegation is a host-authorized role grant, not impersonation by the
		// caller. The target's actual tools/model still pass normal admission.
		createCtx := context.WithValue(conversationPermissions(ctx), liveToolPermissionKey{}, (func(string) bool)(nil))
		createCtx = context.WithValue(createCtx, conversationLinkCreateKey{}, conversationLinkBinding{Scope: g.LinkScope, Parent: caller})
		created, e := m.Create(createCtx, m.owner, spec)
		if e != nil {
			return nil, e
		}
		return agentSummary(created), nil
	case "link_send":
		target, e := m.linkMember(g, p.ID)
		if e != nil {
			return nil, e
		}
		if p.ID == caller {
			return nil, fmt.Errorf("不能给自己派发新的协作任务")
		}
		hops := 0
		for key, o := range r.TurnOrigins {
			if r.TurnGenerations[key] == r.Generation {
				hops = max(hops, o.Hops)
			}
		}
		return m.linkPost(ctx, g, r, target, p.Generation, p.Request, p.Message, p.Brief, "message", hops+1)
	case "link_read":
		if _, e := m.groupIndex(g); e != nil {
			return nil, e
		}
		messages, e := m.groupRange(g, p.After, min(g.Seq, max(0, p.After)+100))
		if e != nil {
			return nil, e
		}
		rows := []map[string]any{}
		for _, msg := range messages {
			if msg.From != caller && msg.To != caller && caller != g.Host.Session {
				continue
			}
			state := "committed"
			target, e := m.Status(m.owner, msg.To)
			if e == nil {
				if gen, ok := target.TurnGenerations[msg.Request]; ok {
					state = "delivered"
					for _, pending := range target.PendingMessages {
						if pending.ID == msg.Request {
							state = "queued"
						}
					}
					if target.Generation == gen && !activeAgent(target.State) {
						state = target.State
					}
				} else if target.Generation != msg.TargetGeneration || target.State == "cancelled" {
					state = "stale"
				}
			}
			rows = append(rows, map[string]any{"seq": msg.Seq, "from": msg.From, "to": msg.To, "text": msg.Text, "kind": msg.Kind, "request_id": msg.Request, "state": state})
		}
		return map[string]any{"messages": rows, "cursor": min(g.Seq, max(0, p.After)+100), "has_more": p.After+100 < g.Seq}, nil
	case "link_result":
		target, e := m.linkMember(g, p.ID, true)
		if e != nil {
			return nil, e
		}
		if target.Generation != p.Generation {
			return nil, fmt.Errorf("目标代次已变化，请先读取态势")
		}
		text := target.Result
		if target.Spec.Kind == "conversation" {
			text, e = m.conversationResult(target.ID, p.Generation, target.Result)
		}
		return map[string]any{"id": target.ID, "generation": p.Generation, "state": target.State, "result": m.redact(text), "error": m.redact(target.Error)}, e
	case "link_stop", "link_release":
		target, e := m.linkMember(g, p.ID, p.Action == "link_release")
		if e != nil {
			return nil, e
		}
		if target.Link == nil || target.Link.Parent != caller && caller != g.Host.Session {
			return nil, fmt.Errorf("只能停止自己邀请或自己主持的成员")
		}
		if target.Generation != p.Generation {
			return nil, fmt.Errorf("目标代次已变化")
		}
		if p.Action == "link_release" {
			m.mu.Lock()
			defer m.mu.Unlock()
			job := m.jobs[target.ID]
			if job == nil || job.record.Generation != p.Generation || activeAgent(job.record.State) || len(job.record.PendingMessages) > 0 {
				return nil, fmt.Errorf("成员仍在工作或有未交付消息")
			}
			select {
			case <-job.done:
			default:
				return nil, errAgentFinishing
			}
			for _, job := range m.jobs {
				child := job.record
				_, released := g.LinkReleased[child.ID]
				if !child.DeletionPending && !released && child.Link != nil && child.Link.Scope == g.LinkScope && child.Link.Parent == target.ID {
					return nil, fmt.Errorf("请先归档该成员邀请的下属")
				}
			}
			if g.LinkReleased == nil {
				g.LinkReleased = map[string]int{}
			}
			g.LinkReleased[target.ID] = target.Generation
			if err := m.writeGroup(g); err != nil {
				return nil, err
			}
			return map[string]any{"released": true, "id": target.ID, "generation": target.Generation, "history_retained": true}, nil
		}
		e = m.CancelGeneration(m.owner, target.ID, p.Generation)
		return map[string]any{"accepted": e == nil}, e
	}
	return nil, fmt.Errorf("未知核心协作操作")
}

func linkMessageRequest(sender, request string) string {
	return internallink.MessageRequest(sender, request)
}

func (m *AgentManager) linkPost(ctx context.Context, g *conversationGroup, from, to AgentRecord, generation int, request, text, brief, kind string, hops int, replyTo ...int) (any, error) {
	if err := internallink.ValidateMessage(request, text, hops, groupMessageLimit); err != nil {
		return nil, err
	}
	request = linkMessageRequest(from.ID, request)
	brief = m.redact(briefText(brief, talkBriefLimit))
	msg, found, err := m.groupFindRequest(g, request)
	if err != nil {
		return nil, err
	}
	if found {
		if msg.From != from.ID || msg.To != to.ID || msg.Text != text || msg.Kind != kind || msg.Brief != "" && msg.Brief != brief || kind != "result" && msg.TargetGeneration != generation {
			return nil, fmt.Errorf("request_id conflict")
		}
	} else {
		if to.Generation != generation || to.State == "cancelling" || to.State == "cancelled" {
			return nil, fmt.Errorf("目标代次已变化或已停止")
		}
		reply := 0
		if len(replyTo) > 0 {
			reply = replyTo[0]
		}
		msg, err = m.appendGroupMessage(g, groupMessage{From: from.ID, To: to.ID, Text: text, Brief: brief, Kind: kind, Request: request, TargetGeneration: generation, SenderGeneration: from.Generation, Hops: hops, ReplyGeneration: reply})
		if err != nil {
			return nil, err
		}
	}
	if recovering, _ := ctx.Value(conversationLinkRecoveryKey{}).(bool); recovering {
		if msg.Kind == "result" {
			if err = m.recordCodingLinkBrief(g, msg, msg.SenderGeneration); err != nil {
				return nil, err
			}
		}
		return map[string]any{"committed": true, "seq": msg.Seq, "request_id": msg.Request, "accepted": false}, nil
	}
	if msg.Kind == "result" && g.LinkScope == codingScopeID() {
		if err = m.recordCodingLinkBrief(g, msg, msg.SenderGeneration); err != nil {
			return map[string]any{"committed": true, "seq": msg.Seq, "request_id": msg.Request, "accepted": false}, err
		}
	}
	return m.deliverLinkMessage(ctx, g, msg)
}

func (m *AgentManager) deliverLinkMessage(ctx context.Context, g *conversationGroup, msg groupMessage) (any, error) {
	if _, e := m.linkMember(g, msg.From, true); e != nil {
		return nil, e
	}
	target, err := m.linkMember(g, msg.To)
	if err != nil {
		return nil, err
	}
	generation := msg.TargetGeneration
	if msg.Kind == "result" {
		if msg.ReplyGeneration > 0 && target.LinkStoppedThrough >= msg.ReplyGeneration {
			return nil, fmt.Errorf("原任务已停止；结果仅供回查")
		}
		generation = target.Generation
	}
	if target.Spec.Kind == "workspace_link" {
		if err = m.recordCodingLinkBrief(g, msg, msg.SenderGeneration); err != nil {
			return map[string]any{"committed": true, "seq": msg.Seq, "request_id": msg.Request, "accepted": false}, err
		}
		m.scheduleWorkspaceLink(g.ID)
		return map[string]any{"committed": true, "queued": true, "accepted": false, "seq": msg.Seq, "request_id": msg.Request}, nil
	}

	origin := conversationLinkOrigin{Scope: g.LinkScope, From: msg.From, Generation: msg.SenderGeneration, Kind: msg.Kind, Hops: msg.Hops}
	deliveryCtx := context.WithValue(ctx, conversationLinkOriginKey{}, origin)
	text := "[Core Link " + msg.Kind + " from instance " + msg.From + "]\n" + msg.Text
	rec, err := m.sendGenerationScoped(deliveryCtx, m.owner, msg.To, msg.Request, text, taskMessageHash(text), generation, nil)
	if err != nil {
		return map[string]any{"committed": true, "seq": msg.Seq, "request_id": msg.Request, "accepted": false}, err
	}
	acceptedGeneration := rec.TurnGenerations[msg.Request]
	if err = m.recordCodingLinkBrief(g, msg, acceptedGeneration); err != nil {
		return map[string]any{"committed": true, "seq": msg.Seq, "request_id": msg.Request, "accepted": true, "generation": acceptedGeneration}, err
	}
	return map[string]any{"accepted": true, "seq": msg.Seq, "request_id": msg.Request, "generation": acceptedGeneration}, nil
}

func validateConversationLinkRecord(r AgentRecord) error {
	if r.Link != nil && (r.Spec.Kind != "conversation" || !sessionIDPattern.MatchString(r.Link.Scope) || !sessionIDPattern.MatchString(r.Link.Parent) || r.Link.Parent == r.ID) {
		return fmt.Errorf("invalid collaboration binding; original retained")
	}
	for request, o := range r.TurnOrigins {
		if (r.Spec.Kind != "conversation" && r.Instance == nil && r.Spec.WorkspaceRole != WorkspaceMatrix) ||
			!o.Valid(sessionIDPattern.MatchString, r.TurnGenerations[request]) {
			return fmt.Errorf("invalid collaboration receipt; original retained")
		}
	}
	return nil
}

func (m *AgentManager) linkDescendantLocked(parent, id string) bool {
	seen := map[string]bool{}
	for i := 0; i < 32 && !seen[id]; i++ {
		seen[id] = true
		j := m.jobs[id]
		if j == nil || j.record.Link == nil {
			return false
		}
		id = j.record.Link.Parent
		if id == parent {
			return true
		}
	}
	return false
}

func conversationOrigin(ctx context.Context) (conversationLinkOrigin, bool) {
	if ctx == nil {
		return conversationLinkOrigin{}, false
	}
	o, ok := ctx.Value(conversationLinkOriginKey{}).(conversationLinkOrigin)
	return o, ok
}
func rememberLinkOrigin(r *AgentRecord, request string, o conversationLinkOrigin) {
	if r.TurnOrigins == nil {
		r.TurnOrigins = map[string]conversationLinkOrigin{}
	}
	r.TurnOrigins[request] = o
}

// Completion outbox is derived from durable admitted turn origins. Retrying
// after a crash uses the same request identity and cannot duplicate execution.
func (m *AgentManager) settleLink(r AgentRecord) {
	if m.primaryCoreLink(r) {
		m.settleWorkspaceLink(r)
		return
	}
	m.settleLinkWithDelivery(r, true)
}

// On reopening, reconcile terminal receipts without starting a model or
// replaying queued work. They are visible in the log and enter the next turn
// only after a caller explicitly resumes that conversation.
func (m *AgentManager) recoverLinkReceipts() {
	for _, r := range m.List(m.owner) {
		m.settleLinkWithDelivery(r, false)
	}
}

func (m *AgentManager) settleLinkWithDelivery(r AgentRecord, deliver bool) {
	if !m.coreLinkCapable(r) || r.DeletionPending || activeAgent(r.State) || m.ctx.Err() != nil {
		return
	}
	conversationGroupsMu.Lock()
	defer conversationGroupsMu.Unlock()
	ctx := m.ctx
	if !deliver {
		ctx = context.WithValue(ctx, conversationLinkRecoveryKey{}, true)
	}
	for request, o := range r.TurnOrigins {
		if r.TurnGenerations[request] != r.Generation || o.Kind != "message" {
			continue
		}
		g, err := m.readGroup(linkLogID(o.Scope))
		if err != nil {
			continue
		}
		coding := g.ProgramMembers[r.ID] == "coding"
		codingRelay := codingRecord(r) && g.LinkScope == codingScopeID()
		if coding || codingRelay {
			if found, exists, e := m.groupFindRequest(g, request); e == nil && exists {
				_ = m.recordCodingLinkBrief(g, found, r.Generation)
			}
		}
		target, err := m.linkMember(g, o.From)
		if err != nil || target.Generation < o.Generation || target.LinkStoppedThrough >= o.Generation || target.LinkCancelled {
			continue
		}
		text := r.Result
		if r.State != "completed" {
			text = "工作状态：" + r.State + "；" + m.redact(r.Error)
		}
		if text == "" {
			text = "任务已结束，未返回正文。"
		}
		text = utf8Prefix(text, 12000) + "\n完整结果引用：instance=" + r.ID + fmt.Sprintf(" generation=%d", r.Generation)
		brief := resultBrief(r)
		if coding || codingRelay {
			brief = codingResultBrief(r)
		}
		_, _ = m.linkPost(ctx, g, r, target, target.Generation, "result:"+request, text, brief, "result", o.Hops, o.Generation)
	}
	if !deliver {
		return
	}
	// Close the finishing/admission race using the existing monotonic log.
	scope, _, e := m.linkScope(r)
	if e != nil {
		return
	}
	g, e := m.readGroup(linkLogID(scope))
	if e != nil {
		return
	}
	m.flushLinkInbox(g, r.ID)
}

// A separate receipt namespace keeps pre-Link session cleanup receipts valid.
func (m *AgentManager) cleanupLinkRoom(ctx context.Context, scope string) error {
	conversationGroupsMu.Lock()
	defer conversationGroupsMu.Unlock()
	if _, e := os.Stat(m.groupDir()); os.IsNotExist(e) {
		return nil
	} else if e != nil {
		return e
	}
	id := linkLogID(scope)
	_, e := sessionservice.Cleanup(ctx, m.groupDir(), id, []sessionservice.Target{
		{ID: "log", Path: id + ".jsonl"},
		{ID: "room", Path: id + ".json"},
	}, nil)
	if e == nil {
		delete(groupLogs, m.groupLogPath(id))
	}
	return e
}

func (m *AgentManager) resumeLinkInbox(r AgentRecord) {
	if !m.coreLinkCapable(r) {
		return
	}
	// Group publication may deliberately hold this mutex while waiting for
	// the model to finish. Do not make starting that model depend on its own
	// publication lock; settleLink will reconcile any deferred inbox later.
	if !conversationGroupsMu.TryLock() {
		return
	}
	defer conversationGroupsMu.Unlock()
	scope, _, e := m.linkScope(r)
	if e != nil {
		return
	}
	g, e := m.readGroup(linkLogID(scope))
	if e == nil {
		m.flushLinkInbox(g, r.ID)
	}
}

func (m *AgentManager) flushLinkInbox(g *conversationGroup, id string) {
	if g.WorkspaceLink != nil && id == g.Host.Session {
		m.scheduleWorkspaceLink(g.ID)
		return
	}

	target, e := m.Status(m.owner, id)
	if e != nil || target.LinkCancelled {
		return
	}
	for m.ctx.Err() == nil {
		messages, e := m.groupRange(g, target.LinkReceiptCursor, target.LinkReceiptCursor+100)
		if e != nil || len(messages) == 0 {
			return
		}
		cursor := target.LinkReceiptCursor
		for _, msg := range messages {
			if msg.To == id {
				target, e = m.Status(m.owner, id)
				if e != nil || target.LinkCancelled {
					return
				}
				if _, ok := target.TurnGenerations[msg.Request]; !ok {
					stale := msg.Kind == "result" && msg.ReplyGeneration > 0 && target.LinkStoppedThrough >= msg.ReplyGeneration || msg.Kind != "result" && target.Generation != msg.TargetGeneration
					if !stale {
						if _, e = m.deliverLinkMessage(m.ctx, g, msg); e != nil {
							break
						}
					}
				}
			}
			cursor = msg.Seq
		}
		if cursor == target.LinkReceiptCursor {
			return
		}
		m.mu.Lock()
		job := m.jobs[id]
		if job == nil || job.record.DeletionPending {
			m.mu.Unlock()
			return
		}
		prior := job.record.LinkReceiptCursor
		job.record.LinkReceiptCursor = cursor
		e = m.saveLocked(job)
		if e != nil {
			job.record.LinkReceiptCursor = prior
		}
		m.mu.Unlock()
		if e != nil {
			return
		}
		target.LinkReceiptCursor = cursor
	}
}
