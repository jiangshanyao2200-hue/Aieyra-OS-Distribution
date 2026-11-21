// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: packageAgentKey; validatePackageInstance; packageAgentCreation; createPackageAgent; createSupervisedPackageAgent
// Impact: python -B scripts/code-atlas.py show Core/agent_package_instance.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"unicode/utf8"

	agent "github.com/aieyra/aieyra-os/agent/contract"
)

type packageAgentKey struct{}

func validatePackageInstance(r AgentRecord) error {
	if r.Instance == nil {
		if r.Spec.AgentPackage != "" {
			return fmt.Errorf("missing Agent package instance binding")
		}
		return nil
	}
	i := r.Instance
	if err := validateWorkflowBinding(i); err != nil {
		return err
	}
	if i.Schema != 1 || i.Revision < 1 || i.Current.Package != r.Spec.AgentPackage || i.Current.Definition.Runtime == nil || i.Requests == nil || len(i.Requests) > 4096 {
		return fmt.Errorf("invalid Agent instance schema or binding")
	}
	if _, err := agent.ParseDefinition(rawJSON(i.Current.Definition)); err != nil {
		return err
	}
	prompt := i.Current.Prompt
	if i.Prompt != nil {
		prompt = *i.Prompt
	}
	if prompt != r.Spec.Prompt || len(prompt) > 32<<10 || len(r.Spec.Title) > 256 {
		return fmt.Errorf("Agent private override differs from its bound specification")
	}
	if !utf8.ValidString(prompt) || !reflect.DeepEqual(r.Spec.ContextProvider, i.Current.Definition.ContextProvider) || r.Spec.MaxTokens != i.Current.Definition.Runtime.Budget.MaxTokens || r.Spec.TimeoutSeconds != i.Current.Definition.Runtime.Budget.TimeoutSeconds {
		return fmt.Errorf("Agent execution policy differs from its pinned definition")
	}
	tools := i.Current.Tools
	if i.Tools != nil {
		tools = *i.Tools
	}
	if !slices.Equal(r.Spec.Tools, tools) {
		return fmt.Errorf("Agent tools differ from its explicit override")
	}
	seen := map[string]bool{}
	for _, cap := range tools {
		if seen[cap] || !slices.Contains(i.Current.AllowedTools, cap) {
			return fmt.Errorf("Agent capability is not declared: %s", cap)
		}
		seen[cap] = true
	}
	return nil
}

func packageAgentCreation(ctx context.Context, spec AgentSpec) (*agent.Instance, error) {
	i, _ := ctx.Value(packageAgentKey{}).(*agent.Instance)
	if spec.AgentPackage == "" {
		if i != nil {
			return nil, fmt.Errorf("missing trusted Agent package binding")
		}
		return nil, nil
	}
	if i == nil || i.Schema != 1 || i.Revision != 1 || i.Current.Package != spec.AgentPackage || spec.WorkspaceRole != "" || spec.Kind != "" || spec.WorkflowID != "" || spec.Task != "" || len(spec.Attachments) > 0 {
		return nil, fmt.Errorf("package Agent instances require trusted idle creation")
	}
	var clone agent.Instance
	data, err := json.Marshal(i)
	if err != nil {
		return nil, err
	}
	if err = json.Unmarshal(data, &clone); err != nil {
		return nil, err
	}
	return &clone, nil
}

func (m *AgentManager) createPackageAgent(ctx context.Context, identity, request, model, workdir, title string) (AgentRecord, error) {
	return m.createSupervisedPackageAgent(ctx, identity, request, model, workdir, title, "", "")
}

func (m *AgentManager) createSupervisedPackageAgent(ctx context.Context, identity, request, model, workdir, title, supervisor, role string) (AgentRecord, error) {
	if strings.TrimSpace(request) == "" || len(request) > 128 {
		return AgentRecord{}, fmt.Errorf("bounded request_id is required")
	}
	if err := ctx.Err(); err != nil {
		return AgentRecord{}, err
	}
	// Receipt identity uses the caller's original input, before public defaults
	// or mutable model/package admission. Updating a package or a private override
	// must not make an accepted creation look like a new request.
	inputHash := taskMessageHash(string(rawJSON([]string{identity, model, workdir, title})))
	if supervisor != "" {
		inputHash = taskMessageHash(string(rawJSON([]string{identity, model, workdir, title, supervisor, role})))
		request = "managed-" + workflowHash(supervisor+"\x00"+request)
	}
	binding, _ := ctx.Value(packageWorkflowBindingKey{}).(*agent.WorkflowBinding)
	if binding != nil {
		inputHash = taskMessageHash(inputHash + string(rawJSON(binding)))
	}
	m.mu.Lock()
	if m.ctx.Err() != nil {
		m.mu.Unlock()
		return AgentRecord{}, fmt.Errorf("manager closed")
	}
	for _, j := range m.jobs {
		if j.record.Parent == m.owner && j.record.Spec.RequestID == request && j.record.Instance != nil && j.record.Instance.CreationRequestHash != "" {
			r := copyRecord(j.record)
			m.mu.Unlock()
			if supervisor != "" && r.Instance.Supervisor != supervisor {
				return AgentRecord{}, fmt.Errorf("creation receipt no longer grants supervision")
			}
			if r.Instance.CreationRequestHash != inputHash {
				return AgentRecord{}, fmt.Errorf("request_id conflict")
			}
			return r, nil
		}
	}
	m.mu.Unlock()
	source, err := m.resolveAgentPackage(ctx, identity)
	if err != nil {
		return AgentRecord{}, err
	}
	if err = m.checkAgentModel(source.Definition, model); err != nil {
		return AgentRecord{}, err
	}
	if title == "" {
		title = source.Definition.Name
	}
	i := &agent.Instance{Schema: 1, Revision: 1, CreationRequestHash: inputHash, Current: source, Requests: map[string]string{}}
	if binding != nil {
		v := *binding
		i.Workflow = &v
		if err := validateWorkflowBinding(i); err != nil {
			return AgentRecord{}, err
		}
	}
	spec := AgentSpec{AgentPackage: source.Package, ContextProvider: source.Definition.ContextProvider, RequestID: request, ModelID: model, Prompt: source.Prompt, Workdir: workdir, Tools: source.Tools, Title: title, MaxTokens: source.Definition.Runtime.Budget.MaxTokens, TimeoutSeconds: source.Definition.Runtime.Budget.TimeoutSeconds}
	if supervisor != "" {
		i.Supervisor, i.TeamRole = supervisor, role
		limited := []string{}
		for _, name := range source.Tools {
			if toolAllowed(ctx, name) {
				limited = append(limited, name)
			}
		}
		i.Tools, spec.Tools = &limited, limited
	}
	ctx = context.WithValue(WithToolPermissions(ctx, spec.Tools), packageAgentKey{}, i)
	return m.Create(ctx, m.owner, spec)
}
