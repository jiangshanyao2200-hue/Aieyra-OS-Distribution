// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: conversationOwner; conversationManager; conversationCall; conversationCreate; conversationPromptHash; conversationTextProjection; loadConversationPrompt; configureConversation; conversationSearchSettings; conversationImageSettings; conversationTools; conversationSnapshot; conversationMessages
// Impact: python -B scripts/code-atlas.py show Core/conversation_agents.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

// Conversations use the existing child runtime and archive, with one durable
// owner across OS restarts. Their display projection carries no Matrix context.
const conversationOwner = "c0a7e25a51404f229ad7f47b458b8a98"

func (h *WorkspaceHost) conversationManager() (*AgentManager, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || h.terminal {
		return nil, fmt.Errorf("对话智能体当前不可用")
	}
	if h.conversations != nil {
		return h.conversations, nil
	}
	if h.updateFrozen {
		return nil, fmt.Errorf("更新交接中，对话服务暂不新建")
	}
	m, err := newAgentManager(h.config, conversationOwner, h.service, PrivatePaths(h.config).Conversations)
	if err != nil {
		return nil, err
	}
	m.streamProjection = &Workspace{manager: m, epoch: workspaceID(), live: map[string]WorkspaceLive{}, state: workspaceState{ID: conversationOwner, Roles: map[string]string{}, Theme: defaultWorkspaceTheme()}}
	m.linkHome = h
	if err := m.ensureBuiltinContacts(); err != nil {
		m.Close()
		return nil, err
	}
	if err := m.ensureProgramContacts(); err != nil {
		m.Close()
		return nil, err
	}
	if err := m.syncInstalledProgramContacts(context.Background()); err != nil {
		m.Close()
		return nil, err
	}
	m.recoverLinkReceipts()
	h.conversations = m
	return m, nil
}

func (h *WorkspaceHost) conversationCall(ctx context.Context, raw json.RawMessage) (any, error) {
	var read struct {
		Action string `json:"action"`
	}
	if err := json.Unmarshal(raw, &read); err != nil {
		return nil, err
	}
	if read.Action == "receipt" || read.Action == "group_receipt" {
		return h.conversationReceipt(raw)
	}
	if read.Action == "group_terminal_read" || read.Action == "terminal_read" {
		return h.conversationTerminal(raw)
	}
	m, err := h.conversationManager()
	if err != nil {
		return nil, err
	}
	// Full history has an opaque string cursor; live snapshots retain their
	// numeric generation cursor. Dispatch before decoding snapshot parameters.
	if read.Action == "history" || read.Action == "history_receipt" {
		return m.conversationHistory(raw)
	}
	if read.Action == "chat_page" {
		return m.conversationChatPage(raw)
	}
	var p struct {
		AgentSpec
		All        bool    `json:"all"`
		Action     string  `json:"action"`
		ID         string  `json:"id"`
		Message    string  `json:"message"`
		Generation int     `json:"generation"`
		Revision   int     `json:"revision"`
		PromptHash string  `json:"prompt_hash"`
		PromptText *string `json:"prompt_text"`
		Since      int64   `json:"since"`
		Before     int     `json:"before"`
		ImageID    string  `json:"image_id"`
		MemberID   string  `json:"member_id"`
	}
	if err = json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if p.Action == "coding_project" {
		return m.codingProjectCall(raw)
	}
	if p.Action == "programs" || p.Action == "program" || p.Action == "program_open" {
		return h.programAgentCall(ctx, m, raw)
	}
	if p.Action == "session_usage" {
		return m.conversationUsage(p.ID, p.All), nil
	}
	if p.Action == "models" {
		return m.Call(ctx, m.owner, rawJSON(map[string]any{"action": "models"}))
	}
	switch p.Action {
	case "contacts", "contact", "contact_avatar", "contact_create", "contact_update", "contact_delete", "session_create", "session_delete", "eyra_session":
		return h.contactCall(ctx, m, p.Action, raw)
	case "groups", "group", "group_create", "group_post", "group_update", "group_stop", "group_delete", "coding_member_retry", "group_member_retry":
		return h.groupCall(ctx, m, p.Action, raw)
	}
	if p.Action == "list" {
		m.mu.Lock()
		records := []AgentRecord{}
		for _, job := range m.jobs {
			records = append(records, copyRecord(job.record))
		}
		m.mu.Unlock()
		rows := []map[string]any{}
		for _, r := range records {
			c, err := m.contactOf(r)
			if err != nil || r.Spec.GroupID != "" || r.Link != nil {
				continue
			}
			row := agentSummary(r)
			row["contact_id"], row["avatar_rev"] = c.ID, c.AvatarRev
			if c.Name != "" {
				row["title"] = c.Name
			}
			rows = append(rows, row)
		}
		sort.Slice(rows, func(i, j int) bool { return rows[i]["created"].(string) < rows[j]["created"].(string) })
		return rows, nil
	}
	if p.Action == "create" {
		r, err := h.conversationCreate(ctx, m, raw)
		if err != nil {
			return nil, err
		}
		conversationContactsMu.Lock()
		defer conversationContactsMu.Unlock()
		if c, err := m.readContact(r.ID); err == nil && c.CreatedBy == "" {
			c.Name, c.CreatedBy = r.Spec.Title, conversationCaller(ctx)
			if err = m.writeContact(c); err != nil {
				return nil, err
			}
		}
		return r, nil
	}
	r, err := m.Status(m.owner, p.ID)
	if err != nil {
		return nil, err
	}
	if r.Spec.Kind != "conversation" {
		return nil, fmt.Errorf("不是对话智能体")
	}
	if _, err = m.contactOf(r); err != nil && p.Action != "status" && p.Action != "snapshot" && p.Action != "image" {
		return nil, err
	}
	switch p.Action {
	case "status":
		return agentSummary(r), nil
	case "snapshot":
		return m.conversationSnapshot(r, p.Since, p.Before)
	case "document_read", "document_state":
		return m.conversationDocument(r.ID, raw)
	case "member_avatar":
		view, err := m.conversationLinkView(r)
		if err != nil {
			return nil, err
		}
		for _, key := range []string{"members", "authors"} {
			members, _ := view[key].([]map[string]any)
			for _, member := range members {
				if member["id"] == p.MemberID && member["contact_id"] != nil {
					return h.contactCall(ctx, m, "contact_avatar", rawJSON(map[string]any{"id": member["contact_id"]}))
				}
			}
		}
		return nil, fmt.Errorf("目标不属于当前协作会话")
	case "greet":
		return m.greetConversation(ctx, r.ID)
	case "settings":
		prompt, err := m.conversationPrompt(r)
		if err != nil {
			return nil, err
		}
		models, err := m.Call(ctx, m.owner, rawJSON(map[string]any{"action": "models"}))
		if err != nil {
			return nil, err
		}
		if resolved, e := m.resolveConversationSpec(r); e == nil {
			r.Spec = resolved
		}
		settings, _ := m.settings(r.Spec.ModelID)
		c, _ := m.readContact(conversationPromptID(r))
		return map[string]any{"contact": m.contactView(c, []AgentRecord{r}), "agent": agentSummary(r), "prompt": prompt, "prompt_hash": conversationPromptHash(prompt), "models": models, "capabilities": map[string]bool{"view_image": m.imageToolAvailable(settings), "web_search": SupportsWebSearch(m.conversationSearchSettings(settings))}}, nil
	case "session_model":
		return m.configureSessionModel(r.ID, p.Revision, p.ModelID)
	case "configure":
		result, err := m.configureConversation(r.ID, p.Revision, p.ModelID, p.Title, p.PromptText, p.PromptHash)
		if err != nil || strings.TrimSpace(p.Title) == "" {
			return result, err
		}
		// A session rename renames its contact, keeping every session title in step.
		title := strings.TrimSpace(p.Title)
		conversationContactsMu.Lock()
		defer conversationContactsMu.Unlock()
		if _, err = m.updateContact(contactPatch{ID: conversationPromptID(r), Name: &title}); err != nil {
			return nil, err
		}
		return result, nil
	case "human_reply":
		var reply HumanReply
		if err := json.Unmarshal(raw, &reply); err != nil {
			return nil, err
		}
		if reply.AgentID != r.ID || reply.SessionID != m.owner || r.Link != nil || r.Spec.GroupID != "" {
			return nil, fmt.Errorf("人工决策不属于当前私聊")
		}
		return m.ReplyHuman(m.owner, reply)
	case "send":
		if r.Link != nil || r.Spec.GroupID != "" {
			return nil, fmt.Errorf("这是协作成员实例，请向原会话主角或群聊发送消息")
		}
		return m.sendGenerationAttachments(m.owner, r.ID, p.RequestID, p.Message, attachmentMessageHash(p.Message, p.Attachments), p.Generation, p.Attachments)
	case "retry_chat":
		var retry chatRetryRequest
		if err := json.Unmarshal(raw, &retry); err != nil {
			return nil, err
		}
		if r.Spec.GroupID != "" || r.Link != nil {
			return nil, fmt.Errorf("请从原会话重试")
		}
		return m.retryChat(m.owner, r.ID, retry, nil)
	case "cancel":
		return map[string]any{"ok": true}, m.CancelGeneration(m.owner, r.ID, p.Generation)
	case "image":
		m.mu.Lock()
		job := m.jobs[r.ID]
		shell := job.shell
		m.mu.Unlock()
		if shell == nil {
			shell, err = m.shellForRun(job, r)
			if err != nil {
				return nil, err
			}
		}
		return shell.toolImage(p.ImageID)
	default:
		return nil, fmt.Errorf("未知的对话智能体操作")
	}
}

// conversationCreate creates one idle conversation session. profile_id is only
// set by session_create, which has already resolved a live contact.
func (h *WorkspaceHost) conversationCreate(ctx context.Context, m *AgentManager, raw json.RawMessage) (AgentRecord, error) {
	var spec AgentSpec
	if err := json.Unmarshal(raw, &spec); err != nil {
		return AgentRecord{}, err
	}
	spec.Kind, spec.ProfileID, spec.GroupID = "conversation", "", ""
	if strings.TrimSpace(spec.Title) == "" {
		spec.Title = "智能体"
	}
	if spec.Workdir == "" {
		spec.Workdir = filepath.Join(PrivatePaths(h.config).Conversations, "files")
		if err := os.MkdirAll(spec.Workdir, 0700); err != nil {
			return AgentRecord{}, err
		}
	}
	r, err := m.Create(conversationPermissions(ctx), m.owner, spec)
	if err != nil {
		return r, err
	}
	if ownProfile, _ := ctx.Value(contactProfileCreateKey{}).(bool); !ownProfile {
		conversationContactsMu.Lock()
		defer conversationContactsMu.Unlock()
		c, e := m.readContact(r.ID)
		if e != nil {
			return r, e
		}
		changed := false
		if c.CreatedBy == "" && c.Defaults == nil {
			c.Defaults = conversationDefaults(r.Spec)
			c.Description = "与你协作的助手"
			changed = true
		}
		if initialized, e := m.initializeContactAvatar(&c); e != nil {
			return r, e
		} else if changed || initialized {
			if e = m.writeContact(c); e != nil {
				return r, e
			}
		}
	}
	return r, nil
}

func conversationPromptHash(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}

// Project old image turns for a text-only model without altering the durable
// archive. Asset references let view_image inspect them through the vision pool.
func conversationTextProjection(messages []Message) []Message {
	result := append([]Message(nil), messages...)
	for i := range result {
		if len(result[i].Images) == 0 {
			continue
		}
		assets, _ := json.Marshal(map[string]any{"image_assets": result[i].Images})
		result[i].Images = nil
		result[i].Content = strings.ReplaceAll(result[i].Content, "Images are supplied as image inputs.", "Image assets:") + "\n" + string(assets)
	}
	return result
}

func loadConversationPrompt(config, id, original string) (string, error) {
	file, err := childPromptFile(config, id)
	if err != nil {
		return "", err
	}
	if _, err = os.Stat(file); os.IsNotExist(err) {
		if strings.TrimSpace(original) == "" {
			original = runtimePrompt("子代/模板/对话.txt")
		}
		if err = os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			return "", err
		}
		f, e := os.OpenFile(file, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil && !os.IsExist(e) {
			return "", e
		}
		if e == nil {
			_, writeErr := f.WriteString(original)
			closeErr := f.Close()
			if writeErr != nil {
				return "", writeErr
			}
			if closeErr != nil {
				return "", closeErr
			}
		}
	}
	// Reuse validation without adding the execution-assistant template.
	return loadChildPrompt(config, id, original)
}

func (m *AgentManager) configureConversation(id string, revision int, model, title string, prompt *string, expectedHash string) (any, error) {
	m.sessionDeleteMu.Lock()
	defer m.sessionDeleteMu.Unlock()
	if model != "" {
		if _, err := m.settings(model); err != nil {
			return nil, err
		}
	}
	if len(title) > 256 || prompt != nil && (len(*prompt) > 256<<10 || !utf8.ValidString(*prompt)) {
		return nil, fmt.Errorf("名称或提示词过长")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	j := m.jobs[id]
	if j == nil || j.record.Spec.Kind != "conversation" || j.record.ConversationRevision != revision {
		return nil, fmt.Errorf("设置已更新，请重新读取后保存")
	}
	if j.record.DeletionPending {
		return nil, fmt.Errorf("会话清理尚未完成，请先重试删除")
	}
	c, err := m.readContact(conversationPromptID(j.record))
	if err != nil {
		return nil, err
	}
	if builtinConversationRole(c.Builtin) != "" && (model != "" || title != "" || prompt != nil) {
		return nil, fmt.Errorf("内置主体的模型请在模型连接中配置")
	}
	old := copyRecord(j.record)
	var previous, file string
	if prompt != nil {
		var err error
		previous, err = loadConversationPrompt(m.config, conversationPromptID(j.record), j.record.Spec.Prompt)
		if err != nil {
			return nil, err
		}
		if conversationPromptHash(previous) != expectedHash {
			return nil, fmt.Errorf("提示词文件已修改，请重新读取后保存")
		}
		file, _ = childPromptFile(m.config, conversationPromptID(j.record))
		if err = atomicWorkspaceFile(filepath.Dir(file), filepath.Base(file), []byte(*prompt)); err != nil {
			return nil, err
		}
	}
	if model != "" {
		if model != j.record.Spec.ModelID {
			j.record.Spec.ModelParameters = nil
		}
		j.record.Spec.ModelID = model
	}
	if title != "" {
		j.record.Spec.Title = title
	}
	j.record.ConversationRevision++
	if err := m.saveLocked(j); err != nil {
		j.record = old
		if prompt != nil {
			_ = atomicWorkspaceFile(filepath.Dir(file), filepath.Base(file), []byte(previous))
		}
		return nil, err
	}
	return agentSummary(j.record), nil
}

func (m *AgentManager) conversationSearchSettings(selected *Settings) *Settings {
	if SupportsWebSearch(selected) {
		return selected
	}
	s, err := Load(m.config)
	if err != nil {
		return nil
	}
	for _, p := range s.APIProfiles {
		if p.Enabled != nil && !*p.Enabled {
			continue
		}
		candidate, err := m.settings(p.ID)
		if err == nil && SupportsWebSearch(candidate) {
			return candidate
		}
	}
	return nil
}

func (m *AgentManager) conversationImageSettings(selected *Settings) *Settings {
	if SupportsToolImages(selected) {
		return selected
	}
	s, err := Load(m.config)
	if err != nil {
		return selected
	}
	for _, p := range s.APIProfiles {
		if p.Enabled != nil && !*p.Enabled {
			continue
		}
		candidate, err := m.settings(p.ID)
		if err == nil && SupportsToolImages(candidate) {
			return candidate
		}
	}
	return selected
}

func (m *AgentManager) conversationTools(ctx context.Context, job *agentJob, selected *Settings) context.Context {
	if turn := job.conversationTurn; turn != nil && turn.GroupID != "" {
		ctx = context.WithValue(ctx, groupToolKey{}, groupToolContext{manager: m, group: turn.GroupID, session: job.record.ID})
	}
	ctx = WithWebSearch(ctx, m.conversationSearchSettings(selected))
	return ctx
}

func (m *AgentManager) conversationSnapshot(r AgentRecord, since int64, before int) (any, error) {
	activity, err := m.Activity(m.owner, r.ID, since, 0, 120)
	if err != nil {
		return nil, err
	}
	// Read again after the activity scan, keeping current generation authoritative.
	r, err = m.Status(m.owner, r.ID)
	if err != nil {
		return nil, err
	}
	messages, start, err := m.conversationMessages(r, before)
	if err != nil {
		return nil, err
	}
	for _, row := range messages {
		for _, key := range []string{"text", "error"} {
			if text, ok := row[key].(string); ok {
				row[key] = m.redact(text)
			}
		}
	}
	w := m.streamProjection
	w.mu.Lock()
	live := w.live[r.ID]
	w.mu.Unlock()
	if live.Generation != r.Generation {
		live = WorkspaceLive{Generation: r.Generation}
	}
	live.Text = m.redact(live.Text)
	live.Thought = m.redact(live.Thought)
	link, err := m.conversationLinkView(r)
	if err != nil {
		return nil, err
	}
	documents, err := m.conversationReports(r.ID)
	if err != nil {
		return nil, err
	}
	agent := agentSummary(r)
	agent["chat_retry_attempt"] = r.ChatRetryAttempt
	agent["error"] = m.redact(r.Error)
	if r.Failure != nil {
		failure := *r.Failure
		failure.Title = m.redact(failure.Title)
		agent["failure"] = &failure
	}
	return map[string]any{"core_epoch": w.epoch, "documents": documents, "greeting": r.Greeting, "usage": workspaceUsage(r.Usage), "read_only": r.Link != nil || r.Spec.GroupID != "", "agent": agent, "human_requests": r.HumanRequests, "messages": messages, "has_older": start > 1, "before": start, "live": live, "activity": activity, "context": r.Context, "link": link, "error": agent["error"]}, nil
}

// Share durable message identities with full history before display redaction.
// This only projects the existing turn ledger and never starts execution.
func (m *AgentManager) conversationMessages(r AgentRecord, before int) ([]map[string]any, int, error) {
	var err error
	end := r.Generation + 1
	if before > 0 && before < end {
		end = before
	}
	start := max(1, end-30)
	outcomes := map[int]AgentOutcome{}
	for _, v := range r.History {
		outcomes[v.Generation] = v
	}
	outcomes[r.Generation] = AgentOutcome{Generation: r.Generation, State: r.State, Result: r.Result, Error: r.Error, SubmittedAt: r.SubmittedAt, CompletedAt: r.CompletedAt}
	if v := r.Compactions[r.CompactionRun]; v != nil && v.PriorState != "" {
		outcome := outcomes[r.Generation]
		outcome.State = v.PriorState
		outcomes[r.Generation] = outcome
	}
	messages := []map[string]any{}
	replies := map[int]bool{}
	for request, generation := range r.TurnGenerations {
		if generation < start || generation >= end {
			continue
		}
		v := outcomes[generation]
		v.Result, err = m.conversationResult(r.ID, generation, v.Result)
		if err != nil {
			return nil, 0, err
		}
		text, submitted := r.Turns[request]
		if r.Spec.GroupID != "" {
			text = groupTurnDisplay(text)
		}
		from := "user"
		if origin, internal := r.TurnOrigins[request]; internal {
			from = "core_link"
			if origin.Kind == "intervention" {
				from = "mother"
			}
		}
		// The creation request can alias generation one without being a user turn.
		if submitted || len(r.TurnAttachments[request]) > 0 {
			messages = append(messages, map[string]any{"id": request, "generation": generation, "from": from, "text": text, "at": v.SubmittedAt, "attachments": r.TurnAttachments[request]})
		}
		if !replies[generation] && (v.Result != "" || v.Error != "") {
			replies[generation] = true
			messages = append(messages, map[string]any{"id": fmt.Sprintf("%s:%d:reply", r.ID, generation), "generation": generation, "from": "eyra", "text": v.Result, "error": v.Error, "state": v.State, "at": v.CompletedAt})
		}
	}
	sort.Slice(messages, func(i, j int) bool {
		a, b := messages[i]["generation"].(int), messages[j]["generation"].(int)
		if a == b {
			if messages[i]["from"] == messages[j]["from"] {
				return messages[i]["id"].(string) < messages[j]["id"].(string)
			}
			return messages[i]["from"] == "user" || messages[j]["from"] == "eyra"
		}
		return a < b
	})
	return messages, start, nil
}
