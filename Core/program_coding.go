// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: codingScopeID; codingGroupCreateKey; codingRecord; codingModel; codingProgram; retryCodingMember; retryGroupExecution; retryGroupMember; codingGroupAction
// Impact: python -B scripts/code-atlas.py show Core/program_coding.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/storage"
	"os"
	"path/filepath"
	"slices"
)

// Coding owns one managed group. Its participants remain the existing builtin
// contacts; neither the mother nor their private conversations join this scope.
func codingScopeID() string { return taskMessageHash("group:program:coding")[:32] }

type codingGroupCreateKey struct{}

func codingRecord(r AgentRecord) bool {
	return r.Spec.GroupID == codingScopeID() || r.Link != nil && r.Link.Scope == codingScopeID()
}

func (m *AgentManager) codingModel(c conversationContact, overrides ...string) (string, error) {
	if !CurrentReleaseStage().TeamCollaboration {
		return "", fmt.Errorf("Coding 协作已关闭")
	}
	return m.builtinModel(c, overrides...)
}

// Opening registers idle sessions when the role has an effective model. Empty
// role bindings follow Eyra through the shared resolver; no model call is made.
// The stable group creation request also survives an interrupted opening.
func (h *WorkspaceHost) codingProgram(ctx context.Context, m *AgentManager, open bool) (any, error) {
	conversationGroupsMu.Lock()
	defer conversationGroupsMu.Unlock()
	id := codingScopeID()
	var g *conversationGroup
	if _, err := os.Stat(filepath.Join(m.groupDir(), id+".json")); err == nil {
		g, err = m.readGroup(id)
		if err != nil {
			return nil, err
		}
		if g.ManagedProgram != "coding" || g.HostContact != builtinContactID("cota") || g.coordinatorContact() != g.HostContact {
			return nil, fmt.Errorf("Coding 绑定不一致，原会话已保留")
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	cota, err := m.readContact(builtinContactID("cota"))
	if err != nil {
		return nil, err
	}
	vaya, err := m.readContact(builtinContactID("vaya"))
	if err != nil {
		return nil, err
	}
	modelFor := func(c conversationContact) (string, error) {
		key := c.ID
		if c.Builtin == "cota" {
			key = groupHost
		}
		if g != nil {
			if member := g.member(key); member != nil {
				if r, e := m.Status(m.owner, member.Session); e == nil {
					return m.codingModel(c, r.ConversationModel)
				}
			}
		}
		return m.codingModel(c)
	}
	_, cotaErr := modelFor(cota)
	_, vayaErr := modelFor(vaya)
	if open && cotaErr == nil {
		contacts := []string{cota.ID}
		if vayaErr == nil {
			contacts = append(contacts, vaya.ID)
		}
		if g == nil {
			g, err = m.createGroup(context.WithValue(ctx, codingGroupCreateKey{}, true), "Coding", contacts, "program:coding", cota.ID)
			if err != nil {
				return nil, err
			}
		} else if vayaErr == nil && g.member(vaya.ID) == nil {
			if err = m.groupSetMembers(ctx, g, contacts); err != nil {
				return nil, err
			}
			if err = m.writeGroup(g); err != nil {
				return nil, err
			}
		}
	}
	project, err := m.readCodingProject()
	if err != nil {
		return nil, err
	}
	rows := []map[string]any{}
	hostSession := ""
	for _, c := range []conversationContact{cota, vaya} {
		model, modelErr := modelFor(c)
		profile := m.builtinProfile(c)
		row := map[string]any{"contact_id": c.ID, "session_id": "", "role": c.Builtin, "name": profile.Name, "ring": profile.Ring, "configured": modelErr == nil, "enabled": false, "state": "idle", "model_id": model}
		if settings, e := Load(m.config); e == nil {
			row["enabled"] = CurrentReleaseStage().TeamCollaboration && settings.TeamRoleOn(builtinConversationRole(c.Builtin))
		}
		if modelErr != nil {
			row["warning"] = modelErr.Error()
		}
		key := c.ID
		if c.Builtin == "cota" {
			key = groupHost
		}
		if g != nil {
			if member := g.member(key); member != nil {
				row["session_id"] = member.Session
				if c.Builtin == "cota" {
					hostSession = member.Session
				}
				if r, e := m.Status(m.owner, member.Session); e == nil {
					row["state"], row["generation"] = r.State, r.Generation
					row["workdir"] = storage.Relocate(m.config, r.Spec.Workdir)
				}
			}
		}
		if project.Root != "" {
			row["workdir"] = project.Root
		}
		rows = append(rows, row)
	}
	binding := map[string]any{"kind": "group", "program": "coding", "scope_id": id, "revision": 1, "host_contact_id": cota.ID, "host_session_id": hostSession, "members": rows, "project": project}
	result := map[string]any{"ok": true, "configured": cotaErr == nil, "binding": binding, "contact": m.contactView(cota, nil)}
	if hostSession != "" {
		if r, e := m.Status(m.owner, hostSession); e == nil {
			result["session"] = agentSummary(r)
		}
	}
	return result, nil
}

// Called under the group lock shared with project switches. The durable request
// belongs to this particular member and generation, including across a restart.
func (m *AgentManager) retryCodingMember(g *conversationGroup, p groupPatch) (any, error) {
	if g.ID != codingScopeID() || g.ManagedProgram != "coding" || p.Generation < 1 || len(p.Text) > groupMessageLimit {
		return nil, fmt.Errorf("当前编程任务不可重试")
	}
	member := g.member(p.Member)
	if member == nil || member.Session == "" {
		return nil, fmt.Errorf("编程成员已变化，请刷新")
	}
	project, err := m.readCodingProject()
	if err != nil {
		return nil, err
	}
	if !sameCodingProjectRoot(project.Root, p.ProjectRoot) || p.Generation <= project.GenerationFloor[member.Session] {
		return nil, fmt.Errorf("项目已切换，请查看当前任务")
	}
	if p.Text == "" {
		if p.SessionID != member.Session {
			return nil, fmt.Errorf("编程成员已变化，请刷新")
		}
		return m.retryGroupExecution(g, member, p)
	}
	return m.retryGroupMember(g, member, p, "coding-retry")
}

func (m *AgentManager) retryGroupExecution(g *conversationGroup, member *groupMember, p groupPatch) (any, error) {
	value, err := m.retryChat(m.owner, member.Session, chatRetryRequest{Generation: p.Generation, Attempt: p.Attempt}, nil)
	if err == nil && value["accepted"] == true {
		go m.groupWatch(g.ID, p.Member, member.Session, p.Generation)
	}
	return value, err
}

// Both managed and ordinary groups commit the retry before delivering it.
func (m *AgentManager) retryGroupMember(g *conversationGroup, member *groupMember, p groupPatch, prefix string) (any, error) {
	if p.Generation < 1 || p.Text == "" || len(p.Text) > groupMessageLimit {
		return nil, fmt.Errorf("重试回合无效")
	}
	request := fmt.Sprintf("%s:%s:%d", prefix, member.Session, p.Generation)
	msg, committed, err := m.groupFindRequest(g, request)
	if err != nil {
		return nil, err
	}
	if !committed {
		r, err := m.Status(m.owner, member.Session)
		if err != nil {
			return nil, err
		}
		if r.Generation != p.Generation || activeAgent(r.State) || r.Failure == nil || !r.Failure.Retryable {
			return nil, fmt.Errorf("任务状态已变化，请查看当前回执")
		}
		// Store the target by identity so identical display names cannot reroute the retry.
		msg, err = m.appendGroupMessage(g, groupMessage{From: "user", Name: "你", Kind: "chat", Text: p.Text, Mentions: []string{p.Member}, Request: request})
		if err != nil {
			return nil, err
		}
	}
	if member.Delivered < msg.Seq {
		if err := m.groupDispatch(g, msg, "", 0); err != nil {
			return nil, err
		}
	}
	return map[string]any{"ok": true, "seq": msg.Seq}, nil
}

// The public group endpoint cannot repurpose or delete a program's fixed scope.
func codingGroupAction(g *conversationGroup, action string) error {
	if g.ManagedProgram == "coding" && slices.Contains([]string{"group_update", "group_delete"}, action) {
		return fmt.Errorf("Coding 成员由程序管理；请在联系人中编辑角色，在资源中心停用程序")
	}
	return nil
}
