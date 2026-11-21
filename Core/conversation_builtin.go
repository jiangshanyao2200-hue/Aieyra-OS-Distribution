// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: builtinContactNames; builtinContactID; ensureBuiltinContacts; builtinProfile; builtinProfile; defaultMotherModel; builtinModel; builtinTools; checkConversationAuthority; currentConversationToolAllowed; conversationPrompt; resolveConversationSpec; newBuiltinSession; contactSessionTemplate
// Impact: python -B scripts/code-atlas.py show Core/conversation_builtin.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// Builtin contacts reference the existing role configuration. They do not own
// another editable model, avatar or prompt, and they exist before any session.
import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"

	"github.com/aieyra/aieyra-os/agent/official"
)

var builtinContactNames = []string{"eyra", "cota", "vaya"}

func builtinContactID(name string) string {
	sum := sha256.Sum256([]byte("aieyra.builtin.contact/" + name))
	return hex.EncodeToString(sum[:16])
}

// Keep old Eyra contact IDs and their independent session archives. Only the
// missing identities are created; this does not start or enable any model.
func (m *AgentManager) ensureBuiltinContacts() error {
	entries, err := os.ReadDir(m.contactDir())
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	found := map[string]bool{}
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		id := entry.Name()[:len(entry.Name())-5]
		if !childPromptID.MatchString(id) {
			continue
		}
		c, e := m.readContact(id)
		if e != nil {
			return e
		}
		if builtinConversationRole(c.Builtin) != "" && !c.Deleted {
			found[c.Builtin] = true
		}
	}
	for _, name := range builtinContactNames {
		if found[name] {
			continue
		}
		id := builtinContactID(name)
		if _, err := os.Lstat(filepath.Join(m.contactDir(), id+".json")); err == nil {
			return fmt.Errorf("内置联系人标识已被占用，原资料保留")
		} else if !os.IsNotExist(err) {
			return err
		}
		if err := m.writeContact(conversationContact{ID: id, Builtin: name, CreatedBy: "system"}); err != nil {
			return err
		}
	}
	return nil
}

type builtinProfile struct {
	Name        string `json:"name"`
	Avatar      string `json:"avatar"`
	Ring        string `json:"ring"`
	Description string `json:"description"`
}

func (m *AgentManager) builtinProfile(c conversationContact) builtinProfile {
	role := builtinConversationRole(c.Builtin)
	d, _ := official.Role(role)
	p := builtinProfile{Name: d.Name}
	switch role {
	case WorkspaceMatrix:
		p.Ring = "pulse"
	case WorkspaceExecution:
		p.Ring = "wave"
	case WorkspaceProject:
		p.Ring = "orbit"
	}
	file := filepath.Join(filepath.Dir(m.config), "companion-profile.json")
	info, err := os.Stat(file)
	if err != nil || info.Size() > 4_000_000 {
		return p
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return p
	}
	var saved struct {
		EyraName   string                    `json:"eyraName"`
		EyraAvatar string                    `json:"eyraAvatar"`
		Roles      map[string]builtinProfile `json:"roles"`
	}
	if json.Unmarshal(data, &saved) != nil {
		return p
	}
	r := saved.Roles[role]
	if role == WorkspaceMatrix {
		r.Name, r.Avatar = saved.EyraName, saved.EyraAvatar
	}
	if r.Name != "" && !(role == WorkspaceProject && r.Name == "莹") && !(role == WorkspaceExecution && r.Name == "Nova") {
		p.Name = r.Name
	}
	p.Avatar, p.Description = r.Avatar, r.Description
	if r.Ring != "" {
		p.Ring = r.Ring
	}
	return p
}

func (s *Settings) defaultMotherModel() string {
	if s.MatrixProfile != "" {
		return s.MatrixProfile
	}
	return s.ActiveProfile
}

func (m *AgentManager) builtinModel(c conversationContact, overrides ...string) (string, error) {
	s, err := Load(m.config)
	if err != nil {
		return "", err
	}
	role := builtinConversationRole(c.Builtin)
	if role != WorkspaceMatrix && !s.TeamRoleOn(role) {
		return "", fmt.Errorf("该主体已停用，请在模型连接中启用")
	}
	id := s.defaultMotherModel()
	// An explicitly configured but disabled/missing model must not silently
	// switch providers. Only an empty role binding means follow Eyra.
	if role == WorkspaceExecution && s.ExecutionProfile != "" {
		id = s.ExecutionProfile
	}
	if role == WorkspaceProject && s.VisionProfile != "" {
		id = s.VisionProfile
	}
	if len(overrides) > 0 && overrides[0] != "" {
		id = overrides[0]
	}
	if s.rolePoolProfile(id) == nil {
		return "", fmt.Errorf("请在模型连接中为该主体配置可用模型")
	}
	return id, nil
}

func (m *AgentManager) builtinTools(c conversationContact) []string {
	role := builtinConversationRole(c.Builtin)
	d, _ := official.Role(role)
	selected := d.DefaultTools
	if s, err := Load(m.config); err == nil {
		if role == WorkspaceExecution && s.ExecutionTools != nil {
			selected = s.ExecutionTools
		}
		if role == WorkspaceProject && s.VisionTools != nil {
			selected = s.VisionTools
		}
	}
	// Global mother capabilities are never inherited by a conversation clone.
	allowed := append([]string{"view_image", "web_search"}, conversationWorkTools...)
	out := []string{"agents", "memory"}
	for _, tool := range allowed {
		if slices.Contains(selected, tool) {
			out = append(out, tool)
		}
	}
	return out
}

// A request snapshot fixes provider parameters, but is never a grant to keep
// using a role/model that the user has revoked while the turn is in flight.
func (m *AgentManager) checkConversationAuthority(r AgentRecord) error {
	c, err := m.contactOf(r)
	if err != nil {
		return err
	}
	if c.Program != "" {
		if err := m.installedProgramAvailable(context.Background(), c.Program); err != nil {
			return err
		}
	}
	if c.Program != "" {
		if _, err := m.programModel(c); err != nil {
			return err
		}
	}
	if c.Deleted {
		return fmt.Errorf("联系人已删除")
	}
	if codingRecord(r) && (c.Builtin == "cota" || c.Builtin == "vaya") {
		if _, err := m.codingModel(c, r.ConversationModel); err != nil {
			return err
		}
	}
	s, err := Load(m.config)
	if err != nil {
		return err
	}
	if s.rolePoolProfile(r.Spec.ModelID) == nil {
		return fmt.Errorf("本回合模型已停用或删除")
	}
	role := builtinConversationRole(c.Builtin)
	if role != "" && role != WorkspaceMatrix && !s.TeamRoleOn(role) {
		return fmt.Errorf("该主体已停用")
	}
	return nil
}

func (m *AgentManager) currentConversationToolAllowed(admitted AgentRecord, name string) bool {
	if m.checkConversationAuthority(admitted) != nil {
		return false
	}
	c, e := m.contactOf(admitted)
	if e != nil {
		return false
	}
	var selected []string
	if builtinConversationRole(c.Builtin) != "" {
		selected = m.builtinTools(c)
	} else if m.linkContacts != nil {
		_, sessions, err := m.liveContact(c.ID)
		if err != nil {
			return false
		}
		template, err := m.contactSessionTemplate(c, sessions)
		if err != nil {
			return false
		}
		selected = template.Spec.Tools
	} else {
		m.mu.Lock()
		j := m.jobs[admitted.ID]
		if j != nil && j.record.Generation == admitted.Generation {
			selected = slices.Clone(j.record.Spec.Tools)
		}
		m.mu.Unlock()
	}
	if name == "memory" {
		return true // intrinsic context access, scoped to this runtime only
	}
	if name == "group" && admitted.Spec.GroupID != "" {
		return true
	}
	if slices.Contains(selected, "terminal") && slices.Contains([]string{"exec_command", "write_stdin", "read_shell_output"}, name) {
		return true
	}
	return slices.Contains(selected, name)
}

func (m *AgentManager) conversationPrompt(r AgentRecord) (string, error) {
	c, err := m.contactOf(r)
	if err != nil {
		return "", err
	}
	switch c.Builtin {
	case "eyra":
		s, err := Load(m.config)
		if err != nil {
			return "", err
		}
		prompt, err := LoadPrompts(ResolvePromptDir(s.PromptDir))
		if err != nil {
			return "", err
		}
		return prompt.Text + "\n" + runtimePrompt("子代/模板/Eyra会话.txt"), nil
	case "cota":
		return runtimePrompt("Cota/提示词.txt"), nil
	case "vaya":
		return runtimePrompt("Vaya/提示词.txt"), nil
	}
	return loadConversationPrompt(m.config, conversationPromptID(r), r.Spec.Prompt)
}

func (m *AgentManager) resolveConversationSpec(r AgentRecord) (AgentSpec, error) {
	spec := r.Spec
	c, err := m.contactOf(r)
	if err != nil {
		return spec, err
	}
	if m.linkContacts != nil && builtinConversationRole(c.Builtin) == "" {
		_, sessions, err := m.liveContact(c.ID)
		if err != nil {
			return spec, err
		}
		template, err := m.contactSessionTemplate(c, sessions)
		if err != nil {
			return spec, err
		}
		spec.ModelID, spec.ModelParameters = template.Spec.ModelID, template.Spec.ModelParameters
		spec.Tools, spec.Title = slices.Clone(template.Spec.Tools), template.Spec.Title
	}
	if builtinConversationRole(c.Builtin) != "" {
		if codingRecord(r) && (c.Builtin == "cota" || c.Builtin == "vaya") {
			spec.ModelID, err = m.codingModel(c, r.ConversationModel)
		} else {
			spec.ModelID, err = m.builtinModel(c, r.ConversationModel)
		}
		if err != nil {
			return spec, err
		}
		spec.ModelParameters = nil
		spec.Title = m.builtinProfile(c).Name
		spec.Tools = m.builtinTools(c)
		if spec.GroupID != "" {
			spec.Tools = append(spec.Tools, "group")
		}
	}
	if c.Program != "" {
		if c.Defaults == nil {
			return spec, fmt.Errorf("程序智能体资料不可用")
		}
		spec.ModelID, err = m.programModel(c)
		if err != nil {
			return spec, err
		}
		spec.ModelParameters = slices.Clone(c.Defaults.ModelParameters)
		spec.Tools, spec.Title = slices.Clone(c.Defaults.Tools), c.Name
	}
	if r.ConversationModel != "" && c.Program == "" {
		spec.ModelID, spec.ModelParameters = r.ConversationModel, nil
	} else if c.Program == "" && builtinConversationRole(c.Builtin) == "" {
		if c.Defaults != nil {
			spec.ModelID, spec.ModelParameters = c.Defaults.ModelID, slices.Clone(c.Defaults.ModelParameters)
		}
		if spec.ModelID == "" {
			spec.ModelID, err = m.programModel(c)
			if err != nil {
				return spec, err
			}
		}
	}
	if codingRecord(r) {
		project, e := m.readCodingProject()
		if e != nil {
			return spec, e
		}
		if project.Root != "" {
			spec.Workdir = project.Root
		}
	}
	if !slices.Contains(spec.Tools, "memory") {
		spec.Tools = append(slices.Clone(spec.Tools), "memory")
	}
	spec.Prompt, err = m.conversationPrompt(r)
	return spec, err
}

func (m *AgentManager) newBuiltinSession(ctx context.Context, c conversationContact, request string) (map[string]any, error) {
	id, err := m.builtinModel(c)
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(m.dir, "files")
	if err = os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	r, err := m.Create(conversationPermissions(ctx), m.owner, AgentSpec{Kind: "conversation", ProfileID: c.ID, RequestID: request, ModelID: id, Title: m.builtinProfile(c).Name, Workdir: dir, Tools: m.builtinTools(c)})
	if err != nil {
		return nil, err
	}
	row := agentSummary(r)
	row["contact_id"] = c.ID
	return row, nil
}

// A group can invite a builtin before its first private conversation exists.
func (m *AgentManager) contactSessionTemplate(c conversationContact, sessions []AgentRecord) (AgentRecord, error) {
	if c.Program != "" {
		return AgentRecord{}, fmt.Errorf("内嵌智能体不能复制为群成员或独立会话，请委派到所属程序")
	}
	if builtinConversationRole(c.Builtin) != "" {
		id, err := m.builtinModel(c)
		if err != nil {
			return AgentRecord{}, err
		}
		dir := filepath.Join(m.dir, "files")
		if err = os.MkdirAll(dir, 0700); err != nil {
			return AgentRecord{}, err
		}
		return AgentRecord{Spec: AgentSpec{ModelID: id, Title: m.builtinProfile(c).Name, Workdir: dir, Tools: m.builtinTools(c)}}, nil
	}
	if c.Defaults != nil {
		spec := *c.Defaults
		spec.Title = c.Name
		return AgentRecord{Spec: spec}, nil
	}
	if len(sessions) == 0 {
		return AgentRecord{}, fmt.Errorf("联系人没有可用会话")
	}
	return sessions[len(sessions)-1], nil
}
