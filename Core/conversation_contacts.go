// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: conversationCallerKey; contactProfileCreateKey; conversationContactsMu; conversationContact; builtinConversationRole; conversationPromptID; contactDir; readContact; writeAvatar; writeContact; decodeContactAvatar; validContactText; contactPatch; thinkingParameterKeys; cleanModelParameters; mergeModelParameters; validContactWorkdir; contactSessionsLocked; clipRunes; sessionLast; sessionActivity; contactView; listContacts; conversationListLess; liveContact; contactOf; conversationCaller; contactCall; newContactSession; deleteContactSession; finishContactCleanup; quiesceLinkChild; eyraSession; createContact; updateContact; conversationWorkTools; conversationCapabilities; conversationToolList; conversationPermissions; conversationWorks; conversationToolDefinitions; conversationDefaults
// Impact: python -B scripts/code-atlas.py show Core/conversation_contacts.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// Contacts group conversation sessions under one durable identity. The first
// session's id is the contact id, so contacts created before this layer keep
// their prompt file and need no migration. Later sessions carry profile_id and
// share the contact's prompt; each session still owns its own context.
import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/CORE/sessionservice"
	"github.com/aieyra/aieyra-os/contracts/storage"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

type conversationCallerKey struct{}
type contactProfileCreateKey struct{}

var conversationContactsMu sync.Mutex

type conversationContact struct {
	Ring                string          `json:"ring,omitempty"`
	ProgramToolsVersion int             `json:"program_tools_version,omitempty"`
	ModelRevision       int             `json:"model_revision,omitempty"`
	Defaults            *AgentSpec      `json:"defaults,omitempty"`
	ID                  string          `json:"id"`
	Name                string          `json:"name,omitempty"`
	Description         string          `json:"description,omitempty"`
	CreatedBy           string          `json:"created_by,omitempty"`
	AvatarRev           int             `json:"avatar_rev,omitempty"`
	AvatarType          string          `json:"avatar_type,omitempty"`
	AvatarRotation      json.RawMessage `json:"avatar_rotation,omitempty"`
	AvatarRevision      int             `json:"avatar_revision,omitempty"`
	Builtin             string          `json:"builtin,omitempty"`
	Program             string          `json:"program,omitempty"`
	Deleted             bool            `json:"deleted,omitempty"`
	DeletedAt           string          `json:"deleted_at,omitempty"`
	Updated             string          `json:"updated,omitempty"`
}

// Builtin identity is persisted by the host, never inferred from a name or
// accepted from a contact editor. Its model belongs to model connections.
func builtinConversationRole(builtin string) string {
	switch builtin {
	case "eyra":
		return WorkspaceMatrix
	case "cota":
		return WorkspaceExecution
	case "vaya":
		return WorkspaceProject
	}
	return ""
}

const (
	contactNameLimit        = 120
	contactDescriptionLimit = 1000
	contactAvatarLimit      = 512 << 10
)

func conversationPromptID(r AgentRecord) string {
	if r.Spec.ProfileID != "" {
		return r.Spec.ProfileID
	}
	return r.ID
}

func (m *AgentManager) contactDir() string { return filepath.Join(m.dir, "contacts") }

func (m *AgentManager) readContact(id string) (conversationContact, error) {
	if m.linkContacts != nil {
		source, err := m.linkContacts()
		if err != nil {
			return conversationContact{}, err
		}
		return source.readContact(id)
	}
	c := conversationContact{ID: id}
	if !childPromptID.MatchString(id) {
		return c, fmt.Errorf("联系人标识无效")
	}
	data, err := os.ReadFile(filepath.Join(m.contactDir(), id+".json"))
	if os.IsNotExist(err) {
		return c, nil
	}
	if err != nil {
		return c, err
	}
	if err = json.Unmarshal(data, &c); err != nil {
		return c, fmt.Errorf("联系人资料损坏")
	}
	c.ID = id
	return c, nil
}

func (m *AgentManager) writeAvatar(id string, data []byte) error {
	if err := os.MkdirAll(m.contactDir(), 0700); err != nil {
		return err
	}
	return atomicWorkspaceFile(m.contactDir(), id+".avatar", data)
}

func (m *AgentManager) writeContact(c conversationContact) error {
	if err := os.MkdirAll(m.contactDir(), 0700); err != nil {
		return err
	}
	c.Updated = time.Now().UTC().Format(time.RFC3339Nano)
	data, err := json.MarshalIndent(c, "", " ")
	if err != nil {
		return err
	}
	return atomicWorkspaceFile(m.contactDir(), c.ID+".json", data)
}

// decodeContactAvatar accepts a PNG or JPEG data URL produced by the avatar cropper.
func decodeContactAvatar(raw string) ([]byte, string, error) {
	var mime string
	switch {
	case strings.HasPrefix(raw, "data:image/png;base64,"):
		mime = "image/png"
	case strings.HasPrefix(raw, "data:image/jpeg;base64,"):
		mime = "image/jpeg"
	default:
		return nil, "", fmt.Errorf("头像只支持 PNG 或 JPEG")
	}
	data, err := base64.StdEncoding.DecodeString(raw[strings.IndexByte(raw, ',')+1:])
	if err != nil || len(data) == 0 {
		return nil, "", fmt.Errorf("头像内容无效")
	}
	if len(data) > contactAvatarLimit {
		return nil, "", fmt.Errorf("头像不能超过 512 KiB")
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 1024 || cfg.Height > 1024 {
		return nil, "", fmt.Errorf("头像需要是 1024×1024 以内的有效图片")
	}
	return data, mime, nil
}

func validContactText(name, description string) error {
	if utf8.RuneCountInString(name) > contactNameLimit || utf8.RuneCountInString(description) > contactDescriptionLimit || !utf8.ValidString(name) || !utf8.ValidString(description) {
		return fmt.Errorf("名字最多 %d 字，简介最多 %d 字", contactNameLimit, contactDescriptionLimit)
	}
	return nil
}

type contactPatch struct {
	Ring                   *string         `json:"ring,omitempty"`
	ExpectedModelRevision  *int            `json:"expected_model_revision,omitempty"`
	ModelUnconfigured      bool            `json:"model_unconfigured,omitempty"`
	ExpectedRevision       *int            `json:"expected_revision,omitempty"`
	ID                     string          `json:"id"`
	Name                   *string         `json:"name"`
	Description            *string         `json:"description"`
	Avatar                 *string         `json:"avatar"`
	AvatarRotation         json.RawMessage `json:"avatar_rotation"`
	AvatarExpectedRevision *int            `json:"avatar_expected_revision"`
	ModelID                string          `json:"model_id"`
	PromptText             *string         `json:"prompt_text"`
	PromptHash             string          `json:"prompt_hash"`
	RequestID              string          `json:"request_id"`
	ContactID              string          `json:"contact_id"`
	Tools                  *[]string       `json:"tools"`
	Workdir                string          `json:"workdir"`
	// Absent: unchanged. null or {}: follow the model pool again.
	ModelParameters json.RawMessage `json:"model_parameters"`
}

// An agent may choose only how much its model thinks; everything else stays
// with the model pool. Values are plain scalars; null removes a pool value.
var thinkingParameterKeys = []string{"reasoning_effort", "thinking_type", "thinking_mode", "reasoning_enabled", "reasoning_budget"}

func cleanModelParameters(raw json.RawMessage) (json.RawMessage, error) {
	if len(bytes.TrimSpace(raw)) == 0 || string(bytes.TrimSpace(raw)) == "null" {
		return nil, nil
	}
	plain := func(key string, v any) (any, error) {
		if !slices.Contains(thinkingParameterKeys, key) {
			return nil, fmt.Errorf("智能体只能单独设置思考参数")
		}
		switch x := v.(type) {
		case nil, bool:
			return x, nil
		case string:
			if x != "" && len(x) <= 32 {
				return x, nil
			}
		case float64:
			if x >= 0 && x <= 1<<24 && x == float64(int64(x)) {
				return x, nil
			}
		}
		return nil, fmt.Errorf("思考参数取值无效")
	}
	var in map[string]any
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, fmt.Errorf("思考参数格式无效")
	}
	out := map[string]any{}
	for key, value := range in {
		if key != "model_options" {
			v, err := plain(key, value)
			if err != nil {
				return nil, err
			}
			out[key] = v
			continue
		}
		options, ok := value.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("思考参数格式无效")
		}
		clean := map[string]any{}
		for k, v := range options {
			x, err := plain(k, v)
			if err != nil {
				return nil, err
			}
			clean[k] = x
		}
		if len(clean) > 0 {
			out[key] = clean
		}
	}
	if len(out) == 0 {
		return nil, nil
	}
	return json.Marshal(out)
}

// The pool profile's parameters with an agent's choice laid over them.
func mergeModelParameters(base, patch json.RawMessage) (json.RawMessage, error) {
	params := map[string]any{}
	if len(base) > 0 && string(base) != "null" {
		if err := json.Unmarshal(base, &params); err != nil {
			return nil, err
		}
	}
	var over map[string]any
	if err := json.Unmarshal(patch, &over); err != nil {
		return nil, err
	}
	set := func(into map[string]any, key string, value any) {
		if value == nil {
			delete(into, key)
		} else {
			into[key] = value
		}
	}
	for key, value := range over {
		options, nested := value.(map[string]any)
		if key != "model_options" || !nested {
			set(params, key, value)
			continue
		}
		into, _ := params["model_options"].(map[string]any)
		if into == nil {
			into = map[string]any{}
		}
		for k, v := range options {
			set(into, k, v)
		}
		if len(into) > 0 {
			params["model_options"] = into
		} else {
			delete(params, "model_options")
		}
	}
	return json.Marshal(params)
}

func validContactWorkdir(dir string) error {
	if dir == "" {
		return nil
	}
	info, err := os.Stat(dir)
	if !filepath.IsAbs(dir) || err != nil || !info.IsDir() {
		return fmt.Errorf("工作目录需要是已存在的绝对路径")
	}
	return nil
}

// contactSessionsLocked returns the sessions of every contact, keyed by contact id.
func (m *AgentManager) contactSessionsLocked() map[string][]AgentRecord {
	out := map[string][]AgentRecord{}
	for _, j := range m.jobs {
		if j.record.Spec.Kind != "conversation" || j.record.Spec.GroupID != "" || j.record.Link != nil {
			continue
		}
		id := conversationPromptID(j.record)
		out[id] = append(out[id], copyRecord(j.record))
	}
	for _, rows := range out {
		sort.Slice(rows, func(i, j int) bool {
			if rows[i].Created != rows[j].Created {
				return rows[i].Created < rows[j].Created
			}
			return rows[i].ID < rows[j].ID
		})
	}
	return out
}

func clipRunes(text string, limit int) string {
	text = strings.Join(strings.Fields(text), " ")
	if utf8.RuneCountInString(text) <= limit {
		return text
	}
	return string([]rune(text)[:limit]) + "…"
}

func (m *AgentManager) sessionLast(r AgentRecord) map[string]any {
	if r.Result != "" && !activeAgent(r.State) {
		return map[string]any{"from": "agent", "text": clipRunes(m.redact(r.Result), 80), "at": r.CompletedAt}
	}
	for request, generation := range r.TurnGenerations {
		if generation == r.Generation {
			return map[string]any{"from": "user", "text": clipRunes(m.redact(r.Turns[request]), 80), "at": r.SubmittedAt}
		}
	}
	return nil
}

func sessionActivity(r AgentRecord) string {
	return max(r.Updated, r.CompletedAt, r.SubmittedAt, r.Created)
}

func (m *AgentManager) contactView(c conversationContact, sessions []AgentRecord) map[string]any {
	rows := []map[string]any{}
	var programSession map[string]any
	latest, model, name, created := "", "", c.Name, ""
	running := false
	var tools []string
	var params json.RawMessage
	workdir := ""
	for _, r := range sessions {
		row := agentSummary(r)
		row["contact_id"] = c.ID
		row["last"] = m.sessionLast(r)
		row["activity"] = sessionActivity(r)
		row["deletion_pending"] = r.DeletionPending
		if r.DeletionPending {
			if receipt, e := sessionservice.ReadCleanup(m.dir, r.ID); e == nil {
				row["cleanup"] = receipt
			}
		}
		if c.Program != "" && r.Spec.RequestID == "program/"+c.Program {
			row["surface"] = "program"
			programSession = row
		} else {
			row["surface"] = "os"
			rows = append(rows, row)
		}
		if a := sessionActivity(r); a >= latest {
			latest, model, tools, workdir, params = a, r.Spec.ModelID, r.Spec.Tools, r.Spec.Workdir, r.Spec.ModelParameters
		}
		if r.ID == c.ID || created == "" {
			created = r.Created
			if name == "" {
				name = r.Spec.Title
			}
		}
		running = running || activeAgent(r.State)
	}
	if c.Defaults != nil {
		model, tools, workdir, params = c.Defaults.ModelID, c.Defaults.Tools, c.Defaults.Workdir, c.Defaults.ModelParameters
	}
	sort.Slice(rows, func(i, j int) bool { return conversationListLess(rows[i], rows[j]) })
	if name == "" {
		name = "智能体"
	}
	role := builtinConversationRole(c.Builtin)
	ring := c.Ring
	var modelError string
	if role != "" {
		p := m.builtinProfile(c)
		name, c.Description, ring = p.Name, p.Description, p.Ring
		if p.Avatar != "" {
			sum := sha256.Sum256([]byte(p.Avatar))
			c.AvatarRev = int(binary.BigEndian.Uint32(sum[:4])&0x7fffffff) + 1
		} else {
			c.AvatarRev = 0
		}
		var e error
		model, e = m.builtinModel(c)
		if e != nil {
			modelError = e.Error()
		}
		params = nil
		tools = m.builtinTools(c)
	}
	// Project the same effective base capabilities used by program execution and
	// edits. Reading legacy profiles must not change their persisted selection.
	if c.Program != "" {
		if effective, err := programToolList(tools); err == nil {
			tools = effective
		}
	}
	inherited := role == "" && model == ""
	if c.Program != "" || inherited {
		var e error
		model, e = m.programModel(c)
		if e != nil {
			modelError = e.Error()
		}
	}
	return map[string]any{"model_inherited": inherited, "model_revision": c.ModelRevision, "program": c.Program, "embedded": embeddedProgram(c.Program), "role": role, "ring": ring, "model_error": modelError, "model_managed": role != "", "id": c.ID, "name": name, "description": c.Description, "created_by": c.CreatedBy, "builtin": c.Builtin, "avatar_rev": c.AvatarRev, "avatar_rotation": c.AvatarRotation, "avatar_revision": contactAvatarRevision(c),
		"model_id": model, "model_parameters": params, "tools": tools, "works": conversationWorks(tools), "workdir": storage.Relocate(m.config, workdir), "created": created, "activity": latest, "active": running, "program_session": programSession, "sessions": rows}
}

func (m *AgentManager) listContacts() ([]map[string]any, error) {
	if m.linkContacts != nil {
		source, err := m.linkContacts()
		if err != nil {
			return nil, err
		}
		return source.listContacts()
	}
	m.mu.Lock()
	groups := m.contactSessionsLocked()
	m.mu.Unlock()
	entries, err := os.ReadDir(m.contactDir())
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".json")
		if !childPromptID.MatchString(id) {
			continue
		}
		c, e := m.readContact(id)
		if e != nil {
			return nil, e
		}
		if (builtinConversationRole(c.Builtin) != "" || c.Defaults != nil) && !c.Deleted {
			if _, ok := groups[id]; !ok {
				groups[id] = nil
			}
		}
	}
	out := []map[string]any{}
	for id, sessions := range groups {
		c, err := m.readContact(id)
		if err != nil {
			return nil, err
		}
		if !c.Deleted && c.Program != "market" {
			out = append(out, m.contactView(c, sessions))
		}
	}
	sort.Slice(out, func(i, j int) bool { return conversationListLess(out[i], out[j]) })
	return out, nil
}

// Empty or equal activity timestamps are common before the first message.
// Map iteration must never become a new visual order on each polling request.
func conversationListLess(a, b map[string]any) bool {
	activityA, _ := a["activity"].(string)
	activityB, _ := b["activity"].(string)
	if activityA != activityB {
		return activityA > activityB
	}
	rank := func(row map[string]any) int {
		for i, name := range builtinContactNames {
			if row["builtin"] == name {
				return i
			}
		}
		return len(builtinContactNames)
	}
	if rank(a) != rank(b) {
		return rank(a) < rank(b)
	}
	idA, _ := a["id"].(string)
	idB, _ := b["id"].(string)
	return idA < idB
}

// liveContact accepts a contact id or the id of any of its sessions.
func (m *AgentManager) liveContact(id string) (conversationContact, []AgentRecord, error) {
	if m.linkContacts != nil {
		source, err := m.linkContacts()
		if err != nil {
			return conversationContact{}, nil, err
		}
		return source.liveContact(id)
	}
	m.mu.Lock()
	if j := m.jobs[id]; j != nil && j.record.Spec.Kind == "conversation" {
		id = conversationPromptID(j.record)
	}
	m.mu.Unlock()
	c, err := m.readContact(id)
	if err != nil {
		return c, nil, err
	}
	m.mu.Lock()
	sessions := m.contactSessionsLocked()[id]
	m.mu.Unlock()
	if len(sessions) == 0 && builtinConversationRole(c.Builtin) == "" && c.Defaults == nil || c.Deleted {
		return c, nil, fmt.Errorf("联系人不存在或已删除")
	}
	return c, sessions, nil
}

// contactOf resolves the contact a session belongs to and rejects deleted ones.
func (m *AgentManager) contactOf(r AgentRecord) (conversationContact, error) {
	c, err := m.readContact(conversationPromptID(r))
	if err == nil && c.Deleted {
		err = fmt.Errorf("联系人已删除")
	}
	return c, err
}

func conversationCaller(ctx context.Context) string {
	if v, _ := ctx.Value(conversationCallerKey{}).(string); v != "" {
		return v
	}
	return "user"
}

func (h *WorkspaceHost) contactCall(ctx context.Context, m *AgentManager, action string, raw json.RawMessage) (any, error) {
	var p contactPatch
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	conversationContactsMu.Lock()
	defer conversationContactsMu.Unlock()
	switch action {
	case "contacts":
		return m.listContacts()
	case "contact":
		c, sessions, err := m.liveContact(p.ID)
		if err != nil {
			return nil, err
		}
		view := m.contactView(c, sessions)
		if builtinConversationRole(c.Builtin) != "" {
			view["prompt_managed"] = true
			return view, nil
		}
		fallback := ""
		if len(sessions) > 0 {
			fallback = sessions[0].Spec.Prompt
		}
		prompt, err := loadConversationPrompt(m.config, c.ID, fallback)
		if err != nil {
			return nil, err
		}
		view["prompt"], view["prompt_hash"] = prompt, conversationPromptHash(prompt)
		return view, nil
	case "contact_avatar":
		c, _, err := m.liveContact(p.ID)
		if err != nil {
			return nil, err
		}
		if builtinConversationRole(c.Builtin) != "" {
			view := m.contactView(c, nil)
			return map[string]any{"ok": true, "avatar": m.builtinProfile(c).Avatar, "avatar_rev": view["avatar_rev"]}, nil
		}
		if c.AvatarRev == 0 {
			return map[string]any{"ok": true, "avatar": ""}, nil
		}
		data, err := os.ReadFile(filepath.Join(m.contactDir(), c.ID+".avatar"))
		if err != nil {
			return nil, fmt.Errorf("头像暂时无法读取")
		}
		return map[string]any{"ok": true, "avatar": "data:" + c.AvatarType + ";base64," + base64.StdEncoding.EncodeToString(data), "avatar_rev": c.AvatarRev}, nil
	case "contact_create":
		return h.createContact(ctx, m, p)
	case "contact_update":
		return m.updateContact(p)
	case "contact_delete":
		if c, _, err := m.liveContact(p.ID); err == nil && c.Program != "" {
			return nil, fmt.Errorf("程序智能体随程序管理，不能独立删除")
		}
		c, _, err := m.liveContact(p.ID)
		if err != nil {
			return nil, err
		}
		if builtinConversationRole(c.Builtin) != "" {
			return nil, fmt.Errorf("内置主体不能删除；可以编辑资料与提示词")
		}
		m.mu.Lock()
		active := []string{}
		for _, j := range m.jobs {
			if j.record.Spec.Kind == "conversation" && conversationPromptID(j.record) == c.ID {
				active = append(active, j.record.ID)
			}
		}
		m.mu.Unlock()
		for _, id := range active {
			if err = m.CancelGeneration(m.owner, id, 0); err != nil {
				return nil, err
			}
		}
		// Archive only: sessions, prompt and avatar stay on disk and are hidden.
		c.Deleted, c.DeletedAt = true, time.Now().UTC().Format(time.RFC3339Nano)
		if err = m.writeContact(c); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true, "id": c.ID, "archived": true}, nil
	case "session_create":
		c, sessions, err := m.liveContact(p.ContactID)
		if err != nil {
			return nil, err
		}
		return m.newContactSession(ctx, c, sessions, p.RequestID)
	case "session_delete":
		return m.deleteContactSession(ctx, p.ID, p.RequestID)
	case "eyra_session":
		return h.eyraSession(ctx, m, p)
	}
	return nil, fmt.Errorf("未知的联系人操作")
}

func (m *AgentManager) newContactSession(ctx context.Context, c conversationContact, sessions []AgentRecord, request string) (map[string]any, error) {
	if strings.HasPrefix(request, "program/") {
		return nil, fmt.Errorf("会话请求编号由程序保留")
	}
	if c.Program != "" {
		if c.Defaults == nil {
			return nil, fmt.Errorf("专员配置缺失")
		}
		model, err := m.programModel(c)
		if err != nil {
			return nil, err
		}
		spec := *c.Defaults
		spec.Kind, spec.ProfileID, spec.Title, spec.ModelID, spec.RequestID = "conversation", c.ID, c.Name, model, request
		trusted := context.WithValue(programPermissions(ctx, spec.Tools), programAgentCreateKey{}, c.Program)
		r, err := m.Create(trusted, m.owner, spec)
		if err != nil {
			return nil, err
		}
		row := agentSummary(r)
		row["contact_id"] = c.ID
		return row, nil
	}
	if builtinConversationRole(c.Builtin) != "" {
		return m.newBuiltinSession(ctx, c, request)
	}
	template, err := m.contactSessionTemplate(c, sessions)
	if err != nil {
		return nil, err
	}
	name := m.contactView(c, sessions)["name"].(string)
	r, err := m.Create(conversationPermissions(ctx), m.owner, AgentSpec{
		Kind: "conversation", ProfileID: c.ID, RequestID: request, ModelID: template.Spec.ModelID, ModelParameters: template.Spec.ModelParameters, Title: name, Workdir: template.Spec.Workdir, Tools: template.Spec.Tools,
	})
	if err != nil {
		return nil, err
	}
	row := agentSummary(r)
	row["contact_id"] = c.ID
	return row, nil
}

// 删除一段会话：停下正在进行的回复，聊天和这段会话的记忆一起从磁盘删除。
// 联系人的提示词、头像和默认设置保留；允许零会话，不自动补建。
func (m *AgentManager) deleteContactSession(ctx context.Context, id, request string) (any, error) {
	m.sessionDeleteMu.Lock()
	defer m.sessionDeleteMu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	// Resume receipt finalization even if the last file removal succeeded but
	// saving its receipt failed before the process exited.
	if receipt, e := sessionservice.ReadCleanup(m.dir, id); e == nil {
		_, statErr := os.Lstat(filepath.Join(m.dir, id+".json"))
		if os.IsNotExist(statErr) {
			return m.finishContactCleanup(ctx, id, nil)
		}
		if statErr != nil {
			return nil, statErr
		}
		if receipt.State == "completed" {
			return nil, fmt.Errorf("已清理会话的记录重新出现，保留现场待核对")
		}
	} else if !os.IsNotExist(e) {
		return nil, e
	}
	c, sessions, err := m.liveContact(id)
	if err != nil {
		return nil, err
	}
	if c.Program != "" && slices.ContainsFunc(sessions, func(r AgentRecord) bool { return r.ID == id && r.Spec.RequestID == "program/"+c.Program }) {
		return nil, fmt.Errorf("程序会话与程序绑定，不能独立删除")
	}
	if !slices.ContainsFunc(sessions, func(r AgentRecord) bool { return r.ID == id }) {
		return nil, fmt.Errorf("会话不存在")
	}
	// Keep the contact's defaults before deleting its last context. Deleting
	// a session must not manufacture a replacement conversation.
	if c.Defaults == nil && builtinConversationRole(c.Builtin) == "" {
		c.Defaults = conversationDefaults(sessions[len(sessions)-1].Spec)
		if c.Name == "" {
			c.Name = sessions[len(sessions)-1].Spec.Title
		}
		if err = m.writeContact(c); err != nil {
			return nil, err
		}
	}
	conversationGroupsMu.Lock()
	m.mu.Lock()
	job := m.jobs[id]
	if job == nil {
		m.mu.Unlock()
		conversationGroupsMu.Unlock()
		return nil, fmt.Errorf("会话不存在")
	}
	// Persist intent before touching history. A failed or interrupted cleanup
	// keeps the session discoverable and prevents a new turn recreating files.
	if !job.record.DeletionPending {
		job.record.DeletionPending = true
		if err = m.saveLocked(job); err != nil {
			job.record.DeletionPending = false
			m.mu.Unlock()
			conversationGroupsMu.Unlock()
			return nil, err
		}
	}
	active := job != nil && activeAgent(job.record.State)
	var done chan struct{}
	if job != nil {
		done = job.done
	}
	m.mu.Unlock()
	conversationGroupsMu.Unlock()
	// The lead may already have finished while an invited member is still
	// working. Cancellation must cover its entire collaboration tree.
	if err = m.CancelGeneration(m.owner, id, 0); err != nil {
		return nil, err
	}
	if active {
		if done == nil {
			return nil, fmt.Errorf("会话尚未确认停止，请稍后重试清理")
		}
	}
	// A terminal status may be published before final archive/shell flushes.
	// Wait for release even after the visible task state has become completed.
	if done != nil {
		select {
		case <-done:
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(15 * time.Second):
			return nil, fmt.Errorf("这段会话还在收尾，请稍后再删")
		}
	}

	m.mu.Lock()
	var shell *ShellManager
	if job := m.jobs[id]; job != nil {
		shell = job.shell
		job.shell = nil
	}
	m.mu.Unlock()
	if shell != nil {
		shell.Close()
	}
	return m.finishContactCleanup(ctx, id, nil)
}

func (m *AgentManager) finishContactCleanup(ctx context.Context, id string, replacement map[string]any) (any, error) {
	// Children are removed before their parent so an interrupted cleanup can
	// always rediscover the remaining subtree from durable Link bindings.
	m.mu.Lock()
	children := []string{}
	for child, job := range m.jobs {
		if job.record.Link != nil && job.record.Link.Parent == id {
			children = append(children, child)
		}
	}
	m.mu.Unlock()
	for _, child := range children {
		if err := m.quiesceLinkChild(ctx, child); err != nil {
			return nil, err
		}
		if _, err := m.finishContactCleanup(ctx, child, nil); err != nil {
			return nil, err
		}
	}
	if err := m.cleanupLinkRoom(ctx, id); err != nil {
		return nil, err
	}
	// The owning record is the last target; interruption leaves a durable
	// per-resource receipt and the existing pending-deletion fence.
	receipt, err := sessionservice.Cleanup(ctx, m.dir, id, []sessionservice.Target{
		{ID: "archive", Path: filepath.Join("sessions", id+".jsonl")},
		{ID: "interrupted_tail", Path: filepath.Join("sessions", id+".jsonl.interrupted-tail")},
		{ID: "archive_lock", Path: filepath.Join("sessions", id+".lock")},
		{ID: "shell", Path: id + ".shell", Tree: true},
		{ID: "results", Path: filepath.Join("results", id), Tree: true},
		{ID: "record", Path: id + ".json"},
	}, []sessionservice.Retained{
		{ID: "contact", Reason: "联系人提示词和头像由联系人所有，其他会话继续使用"},
		{ID: "shared_assets", Reason: "共享附件由引用回收服务判定；本回执不承诺物理删除其他会话仍引用的资产"},
		{ID: "diagnostics", Reason: "共享诊断资料按诊断保留策略管理，不在本会话文件清理范围"},
	})
	if err != nil {
		return map[string]any{"ok": false, "id": id, "cleanup": receipt, "retryable": true, "error": err.Error()}, err
	}
	m.mu.Lock()
	delete(m.jobs, id)
	m.mu.Unlock()
	if w := m.streamProjection; w != nil {
		w.mu.Lock()
		delete(w.live, id)
		w.mu.Unlock()
	}
	result := map[string]any{"ok": true, "id": id, "cleanup": receipt}
	if replacement != nil {
		result["replacement"] = replacement
	}
	return result, nil
}

func (m *AgentManager) quiesceLinkChild(ctx context.Context, id string) error {
	m.mu.Lock()
	job := m.jobs[id]
	if job == nil {
		m.mu.Unlock()
		return nil
	}
	job.record.DeletionPending = true
	err := m.saveLocked(job)
	done := job.done
	m.mu.Unlock()
	if err != nil {
		return err
	}
	if err = m.CancelGeneration(m.owner, id, 0); err != nil {
		return err
	}
	if done != nil {
		select {
		case <-done:
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(15 * time.Second):
			return fmt.Errorf("协作成员还在收尾，请稍后重试清理")
		}
	}
	m.mu.Lock()
	shell := job.shell
	job.shell = nil
	m.mu.Unlock()
	if shell != nil {
		shell.Close()
	}
	return nil
}

// Compatibility action: create an independent Eyra instance, never the mother.
func (h *WorkspaceHost) eyraSession(ctx context.Context, m *AgentManager, p contactPatch) (any, error) {
	rows, err := m.listContacts()
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if row["builtin"] == "eyra" {
			c, _, err := m.liveContact(row["id"].(string))
			if err != nil {
				return nil, err
			}
			return m.newBuiltinSession(ctx, c, p.RequestID)
		}
	}
	return nil, fmt.Errorf("内置 Eyra 联系人暂不可用")
}

func (h *WorkspaceHost) createContact(ctx context.Context, m *AgentManager, p contactPatch) (any, error) {
	if p.Ring != nil && !slices.Contains([]string{"orbit", "pulse", "wave", "spark"}, *p.Ring) {
		return nil, fmt.Errorf("未知联系人光圈样式")
	}
	rotation, err := cleanContactAvatarRotation(p.AvatarRotation)
	if err != nil {
		return nil, err
	}
	name, description := "智能体", "与你协作的助手"
	if p.Name != nil {
		name = strings.TrimSpace(*p.Name)
	}
	if p.Description != nil {
		description = strings.TrimSpace(*p.Description)
	}
	if name == "" {
		name = "智能体"
	}
	if err := validContactText(name, description); err != nil {
		return nil, err
	}
	var avatar []byte
	var mime string
	if p.Avatar != nil && *p.Avatar != "" {
		var err error
		if avatar, mime, err = decodeContactAvatar(*p.Avatar); err != nil {
			return nil, err
		}
	}
	prompt := ""
	if p.PromptText != nil {
		if len(*p.PromptText) > 32<<10 || !utf8.ValidString(*p.PromptText) {
			return nil, fmt.Errorf("提示词过长")
		}
		prompt = *p.PromptText
	}
	if err := validContactWorkdir(p.Workdir); err != nil {
		return nil, err
	}
	fields := map[string]any{"action": "create", "request_id": p.RequestID, "model_id": p.ModelID, "title": name, "prompt": prompt, "workdir": p.Workdir}
	if p.Tools != nil {
		fields["tools"] = *p.Tools
	}
	if params, err := cleanModelParameters(p.ModelParameters); err != nil {
		return nil, err
	} else if params != nil {
		fields["model_parameters"] = params
	}
	spec, _ := json.Marshal(fields)
	r, err := h.conversationCreate(context.WithValue(ctx, contactProfileCreateKey{}, true), m, spec)
	if err != nil {
		return nil, err
	}
	c, err := m.readContact(r.ID)
	if err != nil {
		return nil, err
	}
	// A retried request returns the original contact unchanged.
	if c.CreatedBy != "" {
		_, sessions, err := m.liveContact(r.ID)
		if err != nil {
			return nil, err
		}
		return m.contactView(c, sessions), nil
	}
	if p.Ring != nil {
		c.Ring = *p.Ring
	}
	c.Name, c.Description, c.CreatedBy = name, description, conversationCaller(ctx)
	c.AvatarRotation = rotation
	if rotation != nil || p.Avatar != nil {
		c.AvatarRevision = 1
	}
	c.Defaults = conversationDefaults(r.Spec)
	if avatar != nil {
		if err = m.writeAvatar(c.ID, avatar); err != nil {
			return nil, err
		}
		c.AvatarRev, c.AvatarType = 1, mime
	}
	if _, err = m.initializeContactAvatar(&c); err != nil {
		return nil, err
	}
	if err = m.writeContact(c); err != nil {
		return nil, err
	}
	return m.contactView(c, []AgentRecord{r}), nil
}

func (m *AgentManager) updateContact(p contactPatch) (any, error) {
	m.sessionDeleteMu.Lock()
	defer m.sessionDeleteMu.Unlock()
	c, sessions, err := m.liveContact(p.ID)
	if err != nil {
		return nil, err
	}
	if c.Defaults == nil && len(sessions) > 0 {
		c.Defaults = conversationDefaults(sessions[len(sessions)-1].Spec)
	}
	if p.ModelUnconfigured && p.ModelID != "" {
		return nil, fmt.Errorf("跟随 Eyra 时不能同时指定模型")
	}
	if p.ExpectedModelRevision != nil && c.ModelRevision != *p.ExpectedModelRevision {
		return nil, fmt.Errorf("模型设置已更新，请重新读取后保存")
	}
	if p.ExpectedRevision != nil {
		if len(sessions) != 1 || sessions[0].ConversationRevision != *p.ExpectedRevision {
			return nil, fmt.Errorf("设置已更新，请重新读取后保存")
		}
	}
	if builtinConversationRole(c.Builtin) != "" && (p.ModelID != "" || len(p.ModelParameters) > 0) {
		return nil, fmt.Errorf("内置主体的模型与参数请在模型连接中配置")
	}
	if builtinConversationRole(c.Builtin) != "" {
		return nil, fmt.Errorf("内置主体资料与提示词请使用共同角色编辑器；工具在模型连接中配置")
	}
	if p.Ring != nil {
		if !slices.Contains([]string{"orbit", "pulse", "wave", "spark"}, *p.Ring) {
			return nil, fmt.Errorf("未知联系人光圈样式")
		}
		c.Ring = *p.Ring
	}
	if p.AvatarExpectedRevision != nil && *p.AvatarExpectedRevision != contactAvatarRevision(c) {
		return nil, fmt.Errorf("头像设置已变化，请重新读取后保存")
	}
	rotation, err := cleanContactAvatarRotation(p.AvatarRotation)
	if err != nil {
		return nil, err
	}
	if p.Avatar != nil || rotation != nil {
		c.AvatarRevision = contactAvatarRevision(c) + 1
		if rotation == nil {
			mode := "custom"
			if p.Avatar != nil && *p.Avatar == "" {
				mode = "off"
			}
			rotation = json.RawMessage(fmt.Sprintf(`{"mode":%q,"intervalSeconds":900,"nextAt":0,"id":"","digest":""}`, mode))
		}
		c.AvatarRotation = rotation
	}
	if c.Defaults == nil && len(sessions) > 0 {
		c.Defaults = conversationDefaults(sessions[len(sessions)-1].Spec)
	}
	if p.Name != nil {
		name := strings.TrimSpace(*p.Name)
		if name == "" {
			return nil, fmt.Errorf("名字不能为空")
		}
		c.Name = name
	}
	if p.Description != nil {
		c.Description = strings.TrimSpace(*p.Description)
	}
	if err = validContactText(c.Name, c.Description); err != nil {
		return nil, err
	}
	// A new model starts from its pool parameters unless a choice comes with it.
	paramsSet := len(p.ModelParameters) > 0
	var params json.RawMessage
	if paramsSet {
		if params, err = cleanModelParameters(p.ModelParameters); err != nil {
			return nil, err
		}
	}
	if !p.ModelUnconfigured && (p.ModelID != "" || paramsSet) {
		model := p.ModelID
		if model == "" {
			model, _ = m.contactView(c, sessions)["model_id"].(string)
		}
		if _, err = m.settingsWith(model, params); err != nil {
			return nil, err
		}
	}
	var tools []string
	if p.Tools != nil {
		if c.Program != "" {
			tools, err = programToolList(*p.Tools)
		} else {
			tools, err = conversationToolList(*p.Tools, false)
		}
		if err != nil {
			return nil, err
		}
	}
	if err = validContactWorkdir(p.Workdir); err != nil {
		return nil, err
	}
	var avatar []byte
	var mime string
	if p.Avatar != nil && *p.Avatar != "" {
		if avatar, mime, err = decodeContactAvatar(*p.Avatar); err != nil {
			return nil, err
		}
	}
	// Each committed step registers its undo; a later failure rolls all of them
	// back, so a rejected save never leaves part of the profile changed.
	undo := []func(){}
	rollback := func(err error) (any, error) {
		for i := len(undo) - 1; i >= 0; i-- {
			undo[i]()
		}
		return nil, err
	}
	restore := func(dir, name string) func() {
		before, readErr := os.ReadFile(filepath.Join(dir, name))
		return func() {
			if readErr == nil {
				_ = atomicWorkspaceFile(dir, name, before)
			} else if os.IsNotExist(readErr) {
				_ = os.Remove(filepath.Join(dir, name))
			}
		}
	}
	if p.PromptText != nil {
		if len(*p.PromptText) > 32<<10 || !utf8.ValidString(*p.PromptText) {
			return nil, fmt.Errorf("提示词过长")
		}
		fallback := ""
		if len(sessions) > 0 {
			fallback = sessions[0].Spec.Prompt
		}
		previous, err := loadConversationPrompt(m.config, c.ID, fallback)
		if err != nil {
			return nil, err
		}
		if conversationPromptHash(previous) != p.PromptHash {
			return nil, fmt.Errorf("提示词文件已修改，请重新读取后保存")
		}
		file, _ := childPromptFile(m.config, c.ID)
		back := restore(filepath.Dir(file), filepath.Base(file))
		if err = atomicWorkspaceFile(filepath.Dir(file), filepath.Base(file), []byte(*p.PromptText)); err != nil {
			return nil, err
		}
		undo = append(undo, back)
	}
	if p.Avatar != nil {
		back := restore(m.contactDir(), c.ID+".avatar")
		if avatar != nil {
			if err = m.writeAvatar(c.ID, avatar); err != nil {
				return rollback(err)
			}
			// Clearing an image must never let the next image reuse an old cache key.
			c.AvatarRev, c.AvatarType = c.AvatarRevision, mime
		} else {
			_ = os.Remove(filepath.Join(m.contactDir(), c.ID+".avatar"))
			c.AvatarRev, c.AvatarType = 0, ""
		}
		undo = append(undo, back)
	}
	// Name and model apply to every session from its next turn; running turns keep their frozen spec.
	// Any profile change, the prompt included, bumps the revision so open session windows reload it.
	if p.Ring != nil || p.Name != nil || p.ModelUnconfigured || p.ModelID != "" || paramsSet || p.Avatar != nil || p.AvatarRotation != nil || p.Description != nil || p.Tools != nil || p.Workdir != "" || p.PromptText != nil {
		type saved struct {
			job *agentJob
			old AgentRecord
		}
		changed := []saved{}
		undo = append(undo, func() {
			m.mu.Lock()
			defer m.mu.Unlock()
			for _, x := range changed {
				x.job.record = x.old
				_ = m.saveLocked(x.job)
			}
		})
		m.mu.Lock()
		// Group sessions of this contact follow too; they keep their group tool.
		for _, j := range m.jobs {
			if j.record.Spec.Kind != "conversation" || conversationPromptID(j.record) != c.ID || j.record.DeletionPending {
				continue
			}
			old := copyRecord(j.record)
			if p.Name != nil {
				j.record.Spec.Title = c.Name
			}
			if p.ModelUnconfigured {
				j.record.Spec.ModelID, j.record.Spec.ModelParameters = "", nil
				if c.Program != "" {
					j.record.ConversationModel = ""
				}
			}
			if p.ModelID != "" {
				if c.Program != "" {
					j.record.ConversationModel = ""
				}
				if p.ModelID != j.record.Spec.ModelID {
					j.record.Spec.ModelParameters = nil
				}
				j.record.Spec.ModelID = p.ModelID
			}
			if paramsSet {
				j.record.Spec.ModelParameters = slices.Clone(params)
			}
			if p.Tools != nil {
				j.record.Spec.Tools = append([]string(nil), tools...)
				if j.record.Spec.GroupID != "" {
					j.record.Spec.Tools = append(j.record.Spec.Tools, "group")
				}
			}
			if p.Workdir != "" {
				j.record.Spec.Workdir = p.Workdir
			}
			j.record.ConversationRevision++
			if err = m.saveLocked(j); err != nil {
				j.record = old
				m.mu.Unlock()
				return rollback(err)
			}
			changed = append(changed, saved{j, old})
		}
		m.mu.Unlock()
	}
	if c.Defaults != nil {
		if p.ModelUnconfigured {
			c.Defaults.ModelID, c.Defaults.ModelParameters = "", nil
		}
		if p.ModelID != "" {
			c.Defaults.ModelID, c.Defaults.ModelParameters = p.ModelID, nil
		}
		if paramsSet {
			c.Defaults.ModelParameters = slices.Clone(params)
		}
		if p.Tools != nil {
			c.Defaults.Tools = slices.Clone(tools)
		}
		if p.Workdir != "" {
			c.Defaults.Workdir = p.Workdir
		}
	}
	if p.ModelUnconfigured || p.ModelID != "" || paramsSet {
		c.ModelRevision++
	}
	if err = m.writeContact(c); err != nil {
		return rollback(err)
	}
	c, sessions, err = m.liveContact(c.ID)
	if err != nil {
		return nil, err
	}
	return m.contactView(c, sessions), nil
}

// Work tools use the same executors and permission checks as the main host.
// Core Link is always present, and never grants global mother capabilities.
var conversationWorkTools = []string{"project", "terminal", "exec_command", "write_stdin", "read_shell_output", "apply_patch", "update_plan", "report"}

func conversationCapabilities() []string {
	return append([]string{"view_image", "web_search", "agents", "memory"}, conversationWorkTools...)
}

func conversationToolList(requested []string, group bool) ([]string, error) {
	have := map[string]bool{"view_image": true, "web_search": true, "agents": true, "memory": true}
	for _, name := range requested {
		if !have[name] && !slices.Contains(conversationWorkTools, name) && !(group && name == "group") {
			return nil, fmt.Errorf("对话智能体只能使用 web_search、view_image、%s", strings.Join(conversationWorkTools, "、"))
		}
		have[name] = true
	}
	out := []string{"view_image", "web_search", "agents", "memory"}
	for _, name := range conversationWorkTools {
		if have[name] {
			out = append(out, name)
		}
	}
	if have["group"] {
		out = append(out, "group")
	}
	return out, nil
}

func conversationPermissions(ctx context.Context) context.Context {
	return WithToolPermissions(ctx, conversationCapabilities())
}

func conversationWorks(tools []string) bool {
	for _, name := range tools {
		if slices.Contains(conversationWorkTools, name) {
			return true
		}
	}
	return false
}

// conversationToolDefinitions keeps the stable chat pair first, then the assigned work tools.
func conversationToolDefinitions(ctx context.Context, settings *Settings, tools []string) []ToolDefinition {
	ctx = withOfficialToolAdmission(ctx)
	out := []ToolDefinition{WebSearchToolDefinition(), ImageToolDefinition()}
	if slices.Contains(tools, "memory") {
		out = append(out, MemoryToolDefinition())
	}
	if slices.Contains(tools, "report") {
		out = append(out, ReportToolDefinition())
	}
	if slices.Contains(tools, "project") && !projectOnDemand(ctx) {
		for _, d := range WorkspaceToolDefinitions() {
			if d.Name == "project" {
				out = append(out, d)
				break
			}
		}
	}
	for _, d := range FilterToolDefinitions(WithToolPermissions(ctx, tools), CodingToolDefinitions(settings)) {
		if d.Name != "web_search" && d.Name != "view_image" && d.Name != "agents" && d.Name != "toolbox" && d.Name != "memory" && d.Name != "report" && d.Name != "project" {
			out = append(out, d)
		}
	}
	if slices.Contains(tools, "project") && projectOnDemand(ctx) {
		out = append(out, toolboxContextDefinition(ctx, ToolboxDefinition()))
	}
	if bound, ok := ctx.Value(programAgentContextKey{}).(programAgentContext); ok {
		if slices.Contains(tools, "toolbox") {
			out = append(out, toolboxContextDefinition(ctx, ToolboxDefinition()))
		}
		if bound.program == "contacts" && slices.Contains(tools, "agents") {
			out = append(out, AgentToolDefinition())
		}
	}
	return out
}

// Only role defaults survive deletion; no context, task or instance identity.
func conversationDefaults(spec AgentSpec) *AgentSpec {
	return &AgentSpec{ModelID: spec.ModelID, ModelParameters: slices.Clone(spec.ModelParameters), Tools: slices.Clone(spec.Tools), Workdir: spec.Workdir}
}
