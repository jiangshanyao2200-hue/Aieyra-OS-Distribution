// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: agentPackageCommand; agentPackageSources; packageAgentsCall; packageAgentCommand; changePackageAgent; changePackageAgentFor
// Impact: python -B scripts/code-atlas.py show Core/agent_package_service.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"slices"
	"sort"
	"strings"

	"github.com/aieyra/aieyra-os/CORE/modules"
	tool "github.com/aieyra/aieyra-os/tool/contract"
)

type agentPackageCommand struct {
	Action           string    `json:"action"`
	Package          string    `json:"package,omitempty"`
	ID               string    `json:"id,omitempty"`
	RequestID        string    `json:"request_id,omitempty"`
	ExpectedRevision *int      `json:"expected_revision,omitempty"`
	ModelID          string    `json:"model_id,omitempty"`
	Workdir          string    `json:"workdir,omitempty"`
	Title            string    `json:"title,omitempty"`
	Prompt           *string   `json:"prompt,omitempty"`
	Tools            *[]string `json:"tools,omitempty"`
	RestoreTools     bool      `json:"restore_tools,omitempty"`
	Enabled          *bool     `json:"enabled,omitempty"`
	TeamRole         string    `json:"team_role,omitempty"`
	RestorePrompt    bool      `json:"restore_prompt,omitempty"`
	Supervisor       string    `json:"supervisor,omitempty"`
	Message          string    `json:"message,omitempty"`
	Reason           string    `json:"reason,omitempty"`
	Generation       int       `json:"generation,omitempty"`
}

func (m *AgentManager) agentPackageSources(ctx context.Context) (any, error) {
	rows := []map[string]any{}
	installed, err := m.toolPackages().Call(ctx, modules.Request{Action: "list"})
	if err != nil {
		return nil, err
	}
	rank := func(id string) int {
		switch id {
		case "aieyra.eyra":
			return 0
		case "aieyra.vaya":
			return 1
		case "aieyra.cota":
			return 2
		default:
			return 3
		}
	}
	sort.SliceStable(installed.Items, func(i, j int) bool {
		return rank(installed.Items[i].Manifest.ID) < rank(installed.Items[j].Manifest.ID)
	})
	for _, item := range installed.Items {
		if item.Manifest.Kind == "agent" {
			rows = append(rows, map[string]any{"identity": "mod:" + item.Manifest.ID + "@" + item.Digest, "manifest": item.Manifest, "origin": item.Origin, "enabled": item.Enabled})
		}
	}
	return map[string]any{"sources": rows, "model_evidence": "saved_configuration; image requirements use verified endpoint/model/protocol combinations"}, nil
}

func (w *Workspace) packageAgentsCall(ctx context.Context, raw json.RawMessage) (any, error) {
	if w.host == nil || w.split != nil || w.manager == nil {
		return nil, fmt.Errorf("Agent management requires the primary client")
	}
	if len(raw) > 128<<10 {
		return nil, fmt.Errorf("Agent request exceeds128KiB")
	}
	var p agentPackageCommand
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&p); err != nil {
		return nil, err
	}
	if d.Decode(new(any)) != io.EOF {
		return nil, fmt.Errorf("one Agent command is required")
	}
	if p.Action == "sources" {
		out, err := w.manager.agentPackageSources(ctx)
		if err == nil {
			w.mu.Lock()
			out.(map[string]any)["workdir"] = w.state.Workdir
			w.mu.Unlock()
		}
		return out, err
	}
	if p.Action == "models" {
		return w.manager.Call(ctx, w.manager.owner, rawJSON(map[string]any{"action": "models"}))
	}
	m, err := w.manager.ensurePackageAgentHost(true)
	if err != nil {
		return nil, err
	}
	if m == nil {
		return nil, fmt.Errorf("Agent service unavailable")
	}
	return m.packageAgentCommand(ctx, m.owner, p)
}

func (m *AgentManager) packageAgentCommand(ctx context.Context, actor string, p agentPackageCommand) (any, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if p.ID != "" {
		if _, err := m.Status(actor, p.ID); err != nil {
			return nil, err
		}
	}
	switch p.Action {
	case "export":
		return m.exportAgentTemplate(ctx, actor, p)
	case "list":
		rows := []map[string]any{}
		for _, r := range m.List(actor) {
			if r.Instance != nil {
				row := agentSummary(r)
				row["package"], row["instance_revision"], row["supervisor"] = r.Spec.AgentPackage, r.Instance.Revision, r.Instance.Supervisor
				rows = append(rows, row)
			}
		}
		return map[string]any{"instances": rows}, nil
	case "describe":
		return m.resolveAgentPackage(ctx, p.Package)
	case "create":
		if actor != m.owner {
			if err := m.packageManagementPermission(ctx, actor); err != nil {
				return nil, err
			}
			if p.Supervisor != "" && p.Supervisor != actor {
				return nil, fmt.Errorf("new instance must belong to the calling supervisor")
			}
			if strings.TrimSpace(p.TeamRole) == "" {
				return nil, fmt.Errorf("managed creation requires an explicit team_role")
			}
			if err := m.packageFixedRoleEnabled(p.Package); err != nil {
				return nil, err
			}
			return m.createSupervisedPackageAgent(ctx, p.Package, p.RequestID, p.ModelID, p.Workdir, p.Title, actor, p.TeamRole)
		}
		return m.createPackageAgent(ctx, p.Package, p.RequestID, p.ModelID, p.Workdir, p.Title)
	case "status":
		return m.Status(actor, p.ID)
	case "send":
		return m.sendGenerationScoped(ctx, actor, p.ID, p.RequestID, p.Message, taskMessageHash(p.Message), p.Generation, nil)
	case "cancel":
		return map[string]any{"ok": true}, m.CancelGeneration(actor, p.ID, p.Generation)
	case "configure", "switch", "restore_version", "team":
		if actor != m.owner {
			if err := m.packageManagementPermission(ctx, actor); err != nil {
				return nil, err
			}
		}
		return m.changePackageAgentFor(ctx, actor, p)
	default:
		return nil, fmt.Errorf("unknown Agent service action")
	}
}

func (m *AgentManager) changePackageAgent(ctx context.Context, p agentPackageCommand) (AgentRecord, error) {
	return m.changePackageAgentFor(ctx, m.owner, p)
}

func (m *AgentManager) changePackageAgentFor(ctx context.Context, actor string, p agentPackageCommand) (AgentRecord, error) {
	if strings.TrimSpace(p.RequestID) == "" || len(p.RequestID) > 128 || p.ExpectedRevision == nil {
		return AgentRecord{}, fmt.Errorf("request_id and expected_revision are required")
	}
	if err := ctx.Err(); err != nil {
		return AgentRecord{}, err
	}
	signature := workflowHash(string(rawJSON(p)))
	m.mu.Lock()
	defer m.mu.Unlock()
	j := m.jobs[p.ID]
	if j == nil || j.record.Instance == nil || !m.ownsLocked(m.owner, p.ID) {
		return AgentRecord{}, fmt.Errorf("Agent instance is not owned by this service")
	}
	i := j.record.Instance
	if actor != m.owner {
		if err := m.packageManagementActorLocked(actor); err != nil {
			return AgentRecord{}, err
		}
		if i.Supervisor != actor {
			return AgentRecord{}, fmt.Errorf("definition changes require direct supervision")
		}
	}
	if old, ok := i.Requests[p.RequestID]; ok {
		if old != signature {
			return AgentRecord{}, fmt.Errorf("request_id conflict")
		}
		return copyRecord(j.record), nil
	}
	if actor != m.owner {
		if i.Disabled || p.Enabled != nil && *p.Enabled {
			return AgentRecord{}, fmt.Errorf("only the user can enable an instance; disabled instances retain their definition")
		}
		if p.Action == "team" && p.Supervisor != "" && p.Supervisor != actor {
			return AgentRecord{}, fmt.Errorf("a supervisor may only retain or detach its own member")
		}
	}
	if i.Revision != *p.ExpectedRevision {
		return AgentRecord{}, fmt.Errorf("Agent instance revision changed")
	}
	if activeAgent(j.record.State) {
		return AgentRecord{}, fmt.Errorf("Agent is active; inspect and stop or wait before changing its definition")
	}
	select {
	case <-j.done:
	default:
		return AgentRecord{}, errAgentFinishing
	}
	if len(i.Requests) >= 4096 {
		return AgentRecord{}, fmt.Errorf("Agent change receipt limit reached; original instance retained")
	}
	previous := copyRecord(j.record)
	rollback := func(err error) (AgentRecord, error) { j.record = previous; return AgentRecord{}, err }
	switch p.Action {
	case "configure":
		if p.Prompt != nil && p.RestorePrompt {
			return rollback(fmt.Errorf("choose an override or restore, not both"))
		}
		if p.ModelID != "" {
			j.record.Spec.ModelID = p.ModelID
		}
		if p.Title != "" {
			j.record.Spec.Title = p.Title
		}
		if p.Prompt != nil {
			i.Prompt = p.Prompt
			j.record.Spec.Prompt = *p.Prompt
		}
		if p.RestorePrompt {
			i.Prompt = nil
			j.record.Spec.Prompt = i.Current.Prompt
		}
		if p.Tools != nil && p.RestoreTools {
			return rollback(fmt.Errorf("choose tools override or restore"))
		}
		if p.Tools != nil {
			v := append([]string{}, (*p.Tools)...)
			slices.Sort(v)
			i.Tools = &v
			j.record.Spec.Tools = v
		}
		if p.RestoreTools {
			i.Tools = nil
			j.record.Spec.Tools = append([]string(nil), i.Current.Tools...)
		}
		if p.Enabled != nil {
			i.Disabled = !*p.Enabled
			if i.Disabled {
				j.record.WorkflowNotified = j.record.Generation
				j.record.WorkflowNotice = nil
			}
		}
	case "switch", "restore_version":
		identity := p.Package
		if p.Action == "restore_version" {
			if i.Previous == nil {
				return rollback(fmt.Errorf("no prior Agent definition"))
			}
			identity = i.Previous.Package
		}
		name, _, _ := tool.ParsePackageID(identity)
		current, _, _ := tool.ParsePackageID(i.Current.Package)
		if name != current {
			return rollback(fmt.Errorf("instance version switching cannot change Agent identity"))
		}
		next, err := m.resolveAgentPackage(ctx, identity)
		if err != nil {
			return rollback(err)
		}
		if next.Definition.Runtime.DataSchema != i.Current.Definition.Runtime.DataSchema || *next.Definition.ContextProvider != *i.Current.Definition.ContextProvider {
			return rollback(fmt.Errorf("data or context migration must be completed separately; original instance retained"))
		}
		old := i.Current
		i.Previous = &old
		i.Current = next
		j.record.Spec.AgentPackage = next.Package
		j.record.Spec.Tools = append([]string(nil), next.Tools...)
		if i.Tools != nil {
			j.record.Spec.Tools = append([]string{}, (*i.Tools)...)
		}
		j.record.Spec.ContextProvider = next.Definition.ContextProvider
		j.record.Spec.MaxTokens = next.Definition.Runtime.Budget.MaxTokens
		j.record.Spec.TimeoutSeconds = next.Definition.Runtime.Budget.TimeoutSeconds
		if i.Prompt == nil {
			j.record.Spec.Prompt = next.Prompt
		}
	case "team":
		if p.Supervisor != "" && p.Supervisor != "primary" {
			parent := m.jobs[p.Supervisor]
			if parent == nil || parent.record.Instance == nil || !slices.Contains(parent.record.Spec.Tools, "agents") {
				return rollback(fmt.Errorf("supervisor needs an existing Agent instance and agents capability"))
			}
			seen := map[string]bool{p.ID: true}
			for id := p.Supervisor; id != "" && id != "primary"; {
				if seen[id] {
					return rollback(fmt.Errorf("Agent supervision cycle"))
				}
				seen[id] = true
				next := m.jobs[id]
				if next == nil || next.record.Instance == nil {
					return rollback(fmt.Errorf("supervisor identity unavailable"))
				}
				id = next.record.Instance.Supervisor
			}
		}
		if err := m.validatePackageTeamLocked(p.ID, p.Supervisor, p.TeamRole); err != nil {
			return rollback(err)
		}
		if i.Supervisor != p.Supervisor {
			j.record.WorkflowNotified = j.record.Generation
			j.record.WorkflowNotice = nil
		}
		i.Supervisor, i.TeamRole = p.Supervisor, p.TeamRole
	}
	if err := validatePackageInstance(j.record); err != nil {
		return rollback(err)
	}
	if err := m.validatePackageTeamLocked(p.ID, i.Supervisor, i.TeamRole); err != nil {
		return rollback(err)
	}
	mother, _ := ctx.Value(motherPackageManagementKey{}).(bool)
	if (actor != m.owner || mother) && (p.Tools != nil || p.RestoreTools || p.Action == "switch" || p.Action == "restore_version") {
		for _, name := range j.record.Spec.Tools {
			if !toolAllowed(ctx, name) {
				return rollback(fmt.Errorf("managed instance cannot expand supervisor capabilities: %s", name))
			}
			if parent := m.jobs[actor]; parent != nil && !slices.Contains(parent.record.Spec.Tools, name) {
				return rollback(fmt.Errorf("supervisor no longer has capability: %s", name))
			}
		}
	}
	if p.Action != "team" && (p.Enabled == nil || *p.Enabled) {
		if err := m.checkAgentModel(i.Current.Definition, j.record.Spec.ModelID); err != nil {
			return rollback(err)
		}
	}
	if err := ctx.Err(); err != nil {
		return rollback(err)
	}
	i.Revision++
	i.Requests[p.RequestID] = signature
	if err := m.saveLocked(j); err != nil {
		return rollback(err)
	}
	return copyRecord(j.record), nil
}
