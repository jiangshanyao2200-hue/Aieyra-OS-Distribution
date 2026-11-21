// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: browser-instance, program
// Regions: programAgentCreateKey; programAgentContextKey; programAgentContext; programContactID; embeddedProgram; ensureProgramContacts; programModel; programToolList; programPermissions; programContact; withProgramAgent; valid; programAgentCall; syncInstalledProgramContacts; installedProgramAvailable
// Impact: python -B scripts/code-atlas.py show Core/program_agents.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/CORE/extensionhost"
	"github.com/aieyra/aieyra-os/CORE/modules"
	"github.com/aieyra/aieyra-os/CORE/platform"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"

	programagent "github.com/aieyra/aieyra-os/agent/program"
	"github.com/aieyra/aieyra-os/contracts/storage"
	toolboxowner "github.com/aieyra/aieyra-os/tool/toolbox"
)

type programAgentCreateKey struct{}
type programAgentContextKey struct{}
type programAgentContext struct {
	manager *AgentManager
	record  AgentRecord
	program string
}

func programContactID(program string) string {
	sum := sha256.Sum256([]byte("aieyra.program.contact/" + program))
	return hex.EncodeToString(sum[:16])
}

func embeddedProgram(program string) bool {
	if program == "" {
		return false
	}
	definition, _ := programagent.Find(program)
	return !definition.Standalone
}

// Registration creates only a profile. Opening a page never chooses a model,
// sends a greeting or starts a request. User overrides are never reinitialized.
func (m *AgentManager) ensureProgramContacts(extra ...programagent.Definition) error {
	for _, def := range append(programagent.Catalog(), extra...) {
		id := programContactID(def.ID)
		c, err := m.readContact(id)
		if err != nil {
			return err
		}
		if c.Program != "" {
			if c.Program != def.ID {
				return fmt.Errorf("程序智能体身份冲突：%s", def.ID)
			}
			changed := false
			if c.CreatedBy == "system" && c.Defaults != nil && filepath.IsAbs(c.Defaults.Workdir) {
				dir := filepath.Clean(c.Defaults.Workdir)
				owner := filepath.Dir(filepath.Dir(filepath.Dir(dir)))
				managed := filepath.Join(owner, "files", "programs", def.ID)
				if strings.EqualFold(dir, managed) && (strings.EqualFold(owner, m.dir) ||
					strings.EqualFold(filepath.Base(owner), "conversations") && strings.EqualFold(filepath.Base(filepath.Dir(owner)), "sessions")) {
					if _, e := os.Stat(storage.Relocate(m.config, dir)); os.IsNotExist(e) {
						current := filepath.Join(m.dir, "files", "programs", def.ID)
						if e = os.MkdirAll(current, 0700); e != nil {
							return e
						}
						if dir != current {
							c.Defaults.Workdir, changed = current, true
						}
					}
				}
			}
			// One-time upgrade of untouched official defaults. An edited list
			// remains authoritative; later user removal is never re-added.
			if slices.Contains([]string{"browser", "settings", "contacts"}, def.ID) && c.ProgramToolsVersion < 1 {
				previous := slices.DeleteFunc(slices.Clone(def.Tools), func(name string) bool { return name == "human" })
				if c.Defaults != nil && slices.Equal(c.Defaults.Tools, previous) {
					c.Defaults.Tools = slices.Clone(def.Tools)
				}
				c.ProgramToolsVersion = 1
				changed = true
			}

			if def.PreviousName != "" && c.Name == def.PreviousName && c.Name != def.Name {
				c.Name, changed = def.Name, true
			}
			if def.PreviousDescription != "" && c.Description == def.PreviousDescription && c.Description != def.Description {
				c.Description, changed = def.Description, true
			}
			initialized, e := m.initializeContactAvatar(&c)
			if e != nil {
				return e
			}
			changed = changed || initialized
			if changed {
				if err = m.writeContact(c); err != nil {
					return err
				}
			}
			continue
		}
		if c.CreatedBy != "" || c.Defaults != nil || c.Builtin != "" {
			return fmt.Errorf("程序智能体标识已被占用：%s", def.ID)
		}
		dir := filepath.Join(m.dir, "files", "programs", def.ID)
		if err = os.MkdirAll(dir, 0700); err != nil {
			return err
		}
		prompt := runtimePrompt(def.Prompt)
		file, err := childPromptFile(m.config, id)
		if err != nil {
			return err
		}
		if err = os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			return err
		}
		f, err := os.OpenFile(file, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err == nil {
			_, err = f.WriteString(prompt)
			closeErr := f.Close()
			if err != nil {
				return err
			}
			if closeErr != nil {
				return closeErr
			}
		} else if !os.IsExist(err) {
			return err
		}
		c = conversationContact{ID: id, Program: def.ID, ProgramToolsVersion: 1, Name: def.Name, Description: def.Description, CreatedBy: "system", Defaults: &AgentSpec{Tools: slices.Clone(def.Tools), Workdir: dir}}
		if _, err = m.initializeContactAvatar(&c); err != nil {
			return err
		}
		if err = m.writeContact(c); err != nil {
			return err
		}
	}
	return nil
}

// An empty program binding follows Eyra without copying its model ID into the
// contact. Explicit choices remain authoritative, including disabled models.
func (m *AgentManager) programModel(c conversationContact) (string, error) {
	s, err := Load(m.config)
	if err != nil {
		return "", err
	}
	id := s.defaultMotherModel()
	if c.Defaults != nil && c.Defaults.ModelID != "" {
		id = c.Defaults.ModelID
	}
	if s.rolePoolProfile(id) == nil {
		return "", fmt.Errorf("请从模型池选择可用模型")
	}
	return id, nil
}

func programToolList(requested []string) ([]string, error) {
	allowed := append([]string{"view_image", "web_search", "agents", "memory", "toolbox"}, conversationWorkTools...)
	allowed = append(allowed, toolboxowner.Names()...)
	out := []string{"view_image", "web_search", "agents", "memory"}
	for _, name := range requested {
		if !slices.Contains(allowed, name) {
			return nil, fmt.Errorf("未知程序工具：%s", name)
		}
		if !slices.Contains(out, name) {
			out = append(out, name)
		}
	}
	sort.Strings(out)
	return out, nil
}

func programPermissions(ctx context.Context, tools []string) context.Context {
	return WithToolPermissions(ctx, append(slices.Clone(tools), "memory"))
}

func (m *AgentManager) programContact(r AgentRecord) (conversationContact, bool) {
	c, err := m.contactOf(r)
	return c, err == nil && c.Program != "" && r.Link == nil && r.Spec.GroupID == "" && c.ID == programContactID(c.Program)
}

func (m *AgentManager) withProgramAgent(ctx context.Context, r AgentRecord) context.Context {
	if c, ok := m.programContact(r); ok {
		return context.WithValue(ctx, programAgentContextKey{}, programAgentContext{manager: m, record: r, program: c.Program})
	}
	return ctx
}

func (p programAgentContext) valid(ctx context.Context) error {
	if p.manager == nil || ctx.Err() != nil {
		return fmt.Errorf("程序智能体已停止")
	}
	if err := p.manager.checkConversationAuthority(p.record); err != nil {
		return err
	}
	r, err := p.manager.Status(p.manager.owner, p.record.ID)
	if err != nil || r.Generation != p.record.Generation || !activeAgent(r.State) {
		return fmt.Errorf("程序任务代次已结束")
	}
	c, ok := p.manager.programContact(r)
	if !ok || c.Program != p.program || c.Deleted {
		return fmt.Errorf("程序绑定已失效")
	}
	return nil
}

func (h *WorkspaceHost) programAgentCall(ctx context.Context, m *AgentManager, raw json.RawMessage) (any, error) {
	var p struct {
		Action, Program string
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if p.Program == "coding" {
		return h.codingProgram(ctx, m, p.Action == "program_open")
	}
	conversationContactsMu.Lock()
	defer conversationContactsMu.Unlock()
	if p.Action == "programs" {
		rows, err := m.listContacts()
		if err != nil {
			return nil, err
		}
		out := []map[string]any{}
		for _, row := range rows {
			if id, _ := row["program"].(string); id != "" {
				out = append(out, row)
			}
		}
		return out, nil
	}
	if _, ok := programagent.Find(p.Program); !ok {
		if err := m.installedProgramAvailable(ctx, p.Program); err != nil {
			return nil, err
		}
	}
	c, sessions, err := m.liveContact(programContactID(p.Program))
	if err != nil {
		return nil, err
	}
	model, modelErr := m.programModel(c)
	// The program keeps its own durable chat. OS conversations using the same
	// specialist are separate records and never become this binding by recency.
	var bound *AgentRecord
	for i := range sessions {
		if sessions[i].Spec.RequestID == "program/"+p.Program {
			bound = &sessions[i]
			break
		}
	}
	if p.Action == "program_open" && bound == nil {
		if c.Defaults == nil || modelErr != nil {
			return map[string]any{"ok": true, "configured": false, "contact": m.contactView(c, sessions)}, nil
		}
		spec := *c.Defaults
		spec.ModelID = model
		spec.Kind, spec.ProfileID, spec.Title = "conversation", c.ID, c.Name
		spec.RequestID = "program/" + p.Program
		trusted := context.WithValue(programPermissions(ctx, spec.Tools), programAgentCreateKey{}, c.Program)
		r, err := m.Create(trusted, m.owner, spec)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, r)
		bound = &r
	}
	result := map[string]any{"ok": true, "configured": modelErr == nil, "contact": m.contactView(c, sessions)}
	if bound != nil {
		result["session"] = agentSummary(*bound)
	}
	return result, nil
}

// Each installed package carries a profile even before a model is configured.
// Its package ID is the persistent binding; names are never used as identity.
func (m *AgentManager) syncInstalledProgramContacts(ctx context.Context) error {
	layout := platform.ResolveLayout(platform.AppRoot(), m.config, "")
	if _, err := os.Stat(filepath.Join(layout.Packages, "installed.json")); os.IsNotExist(err) {
		return nil
	}
	result, err := extensionhost.New(layout.Packages, extensionhost.Desktop()).Call(ctx, modules.Request{Action: "list"})
	if err != nil {
		return err
	}
	definitions := []programagent.Definition{}
	for _, item := range result.Items {
		if item.Manifest.Kind != "program" {
			continue
		}
		if item.Manifest.ID == "aieyra.coding" {
			continue // Coding reuses Cota and Vaya, never a tenth program contact.
		}
		if _, builtin := programagent.Find(strings.TrimPrefix(item.Manifest.ID, "aieyra.")); builtin {
			continue
		}
		definitions = append(definitions, programagent.Definition{ID: item.Manifest.ID, Name: item.Manifest.Name + " Agent", Description: item.Manifest.Summary, Prompt: "Program/generic.txt", Tools: []string{"view_image", "web_search", "agents", "toolbox", "software_api"}})
	}
	conversationContactsMu.Lock()
	defer conversationContactsMu.Unlock()
	return m.ensureProgramContacts(definitions...)
}
func (m *AgentManager) installedProgramAvailable(ctx context.Context, id string) error {
	if _, fixed := programagent.Find(id); fixed {
		return nil
	}
	layout := platform.ResolveLayout(platform.AppRoot(), m.config, "")
	result, err := extensionhost.New(layout.Packages, extensionhost.Desktop()).Call(ctx, modules.Request{Action: "resolve", ID: id})
	if err != nil {
		return err
	}
	if result.Item == nil || result.Item.Manifest.Kind != "program" {
		return fmt.Errorf("程序未登记：%s", id)
	}
	return nil
}
