// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: compiledAgents; compiledAgentPackages; loadCompiledAgentPackages; admitFixedRole; fixedRolePackageError; checkAgentModel; resolveAgentPackage; admitPackageAgent; admitPackageSteering
// Impact: python -B scripts/code-atlas.py show Core/agent_package_source.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"sort"
	"sync"

	"github.com/aieyra/aieyra-os/CORE/extensionhost"
	"github.com/aieyra/aieyra-os/CORE/modules"
	agent "github.com/aieyra/aieyra-os/agent/contract"
	"github.com/aieyra/aieyra-os/agent/official"
	tool "github.com/aieyra/aieyra-os/tool/contract"
)

var compiledAgents = sync.OnceValues(loadCompiledAgentPackages)

func compiledAgentPackages() (map[string]*modules.Package, error) { return compiledAgents() }

func loadCompiledAgentPackages() (map[string]*modules.Package, error) {
	all := map[string]*modules.Package{}
	for _, id := range official.PackageIDs() {
		files, err := official.PackageFiles(id)
		if err != nil {
			return nil, err
		}
		p, err := modules.FromFiles(files)
		if err != nil {
			return nil, err
		}
		if _, err = extensionhost.Agent(p); err != nil {
			return nil, err
		}
		all[id] = p
	}
	return all, nil
}

// Fixed desktop roles keep their private prompts and sessions, but execution
// uses the same enabled package and immutable dependency admission as instances.
func (m *AgentManager) admitFixedRole(ctx context.Context, role string) error {
	if m.workspace == nil || m.workspace.Mode() != HostOS || role == "" {
		return nil
	}
	definition, ok := official.Role(role)
	if !ok {
		return fmt.Errorf("unknown official Agent role: %s", role)
	}
	installed, err := m.toolPackages().Call(ctx, modules.Request{Action: "resolve", ID: definition.ID})
	if err != nil {
		return fixedRolePackageError(definition.Name, err)
	}
	if installed.Item == nil {
		return fmt.Errorf("official Agent package is unavailable: %s", definition.ID)
	}
	// Resolve validates the compiled trust catalog. A newer bundled package
	// does not replace the user's existing enabled version or revive a disable.
	if _, err = m.resolveAgentPackage(ctx, "mod:"+definition.ID+"@"+installed.Item.Digest); err != nil {
		return fixedRolePackageError(definition.Name, err)
	}
	return nil
}

func fixedRolePackageError(name string, err error) error {
	var catalog *modules.OfficialCatalogError
	if errors.As(err, &catalog) {
		return fmt.Errorf("%s 暂不可用：官方组件 %s（%s）与当前程序的兼容目录不匹配。请检查并更新完整程序；原会话和配置仍保留。详情：%w", name, catalog.ID, catalog.Version, err)
	}
	return fmt.Errorf("%s Agent unavailable: %w", name, err)
}

// Model compatibility reports configured evidence; it does not claim that a
// catalogue's capability flag proves a real upstream tool or image roundtrip.
func (m *AgentManager) checkAgentModel(d agent.Definition, model string) error {
	if model == "" {
		return fmt.Errorf("choose a model connection before creating the Agent")
	}
	s, err := m.settings(model)
	if err != nil {
		return err
	}
	requirements := d.Runtime.Model
	p := s.activePoolProfile()
	if requirements.ToolCalls && (p == nil || !p.ToolCalls) {
		return fmt.Errorf("selected model is not configured for required tool calls")
	}
	if requirements.ImageInput && !SupportsToolImages(s) {
		return fmt.Errorf("selected model/endpoint/protocol lacks verified image input")
	}
	if requirements.MinContextTokens > 0 && (p == nil || profileContextLimit(p) < requirements.MinContextTokens) {
		return fmt.Errorf("selected model has no confirmed context capacity meeting the Agent requirement")
	}
	provider, err := resolveContextProvider(*d.ContextProvider, m.config)
	if err != nil {
		return err
	}
	if provider.Describe().Storage == "memory" && !s.MemoryEnabled {
		return fmt.Errorf("this Agent context provider requires Memory to be enabled")
	}
	return nil
}

func (m *AgentManager) resolveAgentPackage(ctx context.Context, identity string) (agent.InstanceDefinition, error) {
	var out agent.InstanceDefinition
	name, digest, ok := tool.ParsePackageID(identity)
	if !ok {
		return out, fmt.Errorf("complete Agent package identity is required")
	}
	resolved, err := m.toolPackages().Call(ctx, modules.Request{Action: "resolve", ID: name})
	if err != nil {
		return out, err
	}
	if resolved.Item == nil || resolved.Item.Digest != digest {
		return out, fmt.Errorf("Agent package version changed; the existing instance is retained")
	}
	revision := resolved.Revision
	p, err := modules.Load(ctx, resolved.Directory)
	if err != nil {
		return out, err
	}
	if p.Digest != digest {
		return out, fmt.Errorf("Agent package content changed")
	}
	deps := map[string]*modules.Package{}
	for _, dep := range resolved.Dependencies {
		other, e := modules.Load(ctx, dep.Directory)
		if e != nil {
			return out, e
		}
		if other.Digest != dep.Digest {
			return out, fmt.Errorf("Agent dependency content changed")
		}
		deps[dep.Manifest.ID] = other
	}
	pkg, err := extensionhost.Agent(p)
	if err != nil {
		return out, err
	}
	if ref := pkg.Definition.ContextProvider; ref.ID != "aieyra.context.pac" && ref.ID != "aieyra.context.structured" {
		dep := deps[ref.ID]
		if dep == nil || dep.Manifest.Kind != "context" || dep.Manifest.Version != ref.Version || dep.Manifest.Data.Schema != ref.StateSchema || ref.Digest != "" && ref.Digest != dep.Digest {
			return out, fmt.Errorf("Agent Context dependency does not match its provider reference")
		}
		ref.Digest = dep.Digest
	}
	if _, err = resolveContextProvider(*pkg.Definition.ContextProvider, m.config); err != nil {
		return out, err
	}
	tools := append([]string(nil), pkg.Definition.DefaultTools...)
	for _, capability := range pkg.Definition.ToolChoices {
		if !knownAgentCapability(capability) {
			return out, fmt.Errorf("unknown Agent capability: %s", capability)
		}
	}
	for _, id := range pkg.Definition.Runtime.ToolPackages {
		dep := deps[id]
		if dep == nil || !slices.Contains([]string{"tool", "toolbox", "workbox"}, dep.Manifest.Kind) {
			return out, fmt.Errorf("Agent tool dependency has the wrong kind: %s", id)
		}
		ref := "mod:" + id + "@" + dep.Digest
		v, e := m.versionedTool(ctx, ref)
		if e != nil {
			return out, e
		}
		tools = append(tools, ref, "wait")
		tools = append(tools, v.Capabilities...)
	}
	for _, id := range pkg.Definition.Runtime.Programs {
		if deps[id] == nil || deps[id].Manifest.Kind != "program" || !slices.Contains(tools, "software_api") {
			return out, fmt.Errorf("Agent Program dependency needs a Program and software_api capability: %s", id)
		}
	}
	if pkg.Team != nil {
		for _, member := range pkg.Team.Members {
			if deps[member.Agent] == nil || deps[member.Agent].Manifest.Kind != "agent" {
				return out, fmt.Errorf("Agent team dependency has the wrong kind: %s", member.Agent)
			}
		}
	}
	last, err := m.toolPackages().Call(ctx, modules.Request{Action: "resolve", ID: name})
	if err != nil {
		return out, err
	}
	if last.Revision != revision {
		return out, fmt.Errorf("Agent package registry changed during admission")
	}
	allowed := append(append([]string{}, tools...), pkg.Definition.ToolChoices...)
	sort.Strings(allowed)
	sort.Strings(tools)
	out = agent.InstanceDefinition{Package: identity, Definition: pkg.Definition, Team: pkg.Team, Prompt: pkg.Prompt, Dependencies: map[string]string{}, Tools: slices.Compact(tools), AllowedTools: slices.Compact(allowed)}
	for id, dep := range deps {
		out.Dependencies[id] = dep.Digest
	}
	return out, nil
}

// A definition import never mutates an existing instance. Admission either
// uses its exact saved version or asks for an explicit idle-boundary switch.
func (m *AgentManager) admitPackageAgent(ctx context.Context, r AgentRecord) error {
	if r.Instance == nil {
		return nil
	}
	i := r.Instance
	if i.Disabled {
		return fmt.Errorf("Agent instance is disabled; explicitly enable it before sending")
	}
	if i.Schema != 1 || i.Revision < 1 || i.Current.Package != r.Spec.AgentPackage {
		return fmt.Errorf("invalid Agent instance binding")
	}
	p, err := m.resolveAgentPackage(ctx, i.Current.Package)
	if err != nil {
		return err
	}
	if !reflect.DeepEqual(p, i.Current) {
		return fmt.Errorf("Agent dependency or definition changed; inspect before switching")
	}
	if err = m.checkAgentModel(p.Definition, r.Spec.ModelID); err != nil {
		return err
	}
	for _, capability := range r.Spec.Tools {
		if !slices.Contains(p.AllowedTools, capability) {
			return fmt.Errorf("instance capability is outside its pinned definition: %s", capability)
		}
	}
	return nil
}

// Steering stays inside an already admitted turn and retains its immutable
// definition after an update. Disable/remove still stops accepting new input;
// the next idle turn performs full version and dependency admission above.
func (m *AgentManager) admitPackageSteering(ctx context.Context, r AgentRecord) error {
	if r.Instance == nil || r.Instance.Disabled {
		return fmt.Errorf("Agent instance is disabled or its binding is missing")
	}
	id, _, ok := tool.ParsePackageID(r.Spec.AgentPackage)
	if !ok {
		return fmt.Errorf("invalid Agent package identity")
	}
	list, err := m.toolPackages().Call(ctx, modules.Request{Action: "list"})
	if err != nil {
		return err
	}
	enabled := map[string]bool{}
	for _, item := range list.Items {
		enabled[item.Manifest.ID] = item.Enabled
	}
	if !enabled[id] {
		return fmt.Errorf("Agent package is not enabled")
	}
	for dependency := range r.Instance.Current.Dependencies {
		if !enabled[dependency] {
			return fmt.Errorf("Agent dependency is not enabled: %s", dependency)
		}
	}
	return nil
}
