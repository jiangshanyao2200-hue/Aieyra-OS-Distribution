// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/contract/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: PackageRuntime; ModelRequirements; AgentBudget; AgentPolicy; AgentView; Package; Validate; validPackageFile; packagePrompt; DecodePackage
// Impact: python -B scripts/code-atlas.py show Agent/contract/package.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

import (
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"
)

// PackageRuntime is independent of model connections and private instance
// state. The host resolves permissions and exact dependency versions later.
type PackageRuntime struct {
	WorkflowPort string            `json:"workflow_port,omitempty"`
	Model        ModelRequirements `json:"model"`
	Budget       AgentBudget       `json:"budget"`
	Policy       AgentPolicy       `json:"policy"`
	PromptOrder  []string          `json:"prompt_order"`
	PromptFiles  map[string]string `json:"prompt_files,omitempty"`
	ToolPackages []string          `json:"tool_packages"`
	Programs     []string          `json:"programs"`
	Team         string            `json:"team,omitempty"`
	DataSchema   int               `json:"data_schema"`
}

type ModelRequirements struct {
	ToolCalls        bool `json:"tool_calls"`
	ImageInput       bool `json:"image_input"`
	MinContextTokens int  `json:"min_context_tokens"`
}

type AgentBudget struct {
	MaxTokens      int `json:"max_tokens"`
	TimeoutSeconds int `json:"timeout_seconds"`
}

type AgentPolicy struct {
	WorkMode string `json:"work_mode"`
	Lifetime string `json:"lifetime"`
}

type AgentView struct {
	Schema string `json:"schema"`
	View   string `json:"view"`
	Title  string `json:"title"`
}

type Package struct {
	Definition Definition `json:"definition"`
	Prompt     string     `json:"prompt"`
	Manual     string     `json:"manual"`
	Desktop    AgentView  `json:"desktop"`
	CLI        AgentView  `json:"cli"`
	Team       *Team      `json:"team,omitempty"`
}

func (r PackageRuntime) Validate(d Definition) error {
	if r.WorkflowPort != "" && (r.WorkflowPort != "aieyra.workbox/1" || !slices.Contains(d.DefaultTools, "software_api")) {
		return fmt.Errorf("workflow port requires a supported contract and default software_api capability")
	}
	if d.ContextProvider == nil || r.DataSchema != 1 || r.Budget.MaxTokens < 1 || r.Budget.MaxTokens > 10000000 || r.Budget.TimeoutSeconds < 10 || r.Budget.TimeoutSeconds > 3600 {
		return fmt.Errorf("agent package needs an exact context provider, supported data schema and bounded budget")
	}
	if r.Model.MinContextTokens < 0 || r.Model.MinContextTokens > 10000000 || (!r.Model.ToolCalls && (len(d.ToolChoices) > 0 || len(r.ToolPackages) > 0 || len(r.Programs) > 0)) {
		return fmt.Errorf("agent model requirements do not cover its execution capabilities")
	}
	if r.Policy.WorkMode != "direct-or-delegate" || !slices.Contains([]string{"task", "retained"}, r.Policy.Lifetime) {
		return fmt.Errorf("unsupported agent work policy or lifetime")
	}
	if len(r.PromptOrder) == 0 || !validNames(r.PromptOrder) || !validNames(r.ToolPackages) || !validNames(r.Programs) {
		return fmt.Errorf("invalid agent prompt order or dependency references")
	}
	for _, key := range r.PromptOrder {
		if _, ok := d.Prompts[key]; !ok {
			return fmt.Errorf("agent prompt order references missing key: %s", key)
		}
	}
	if r.PromptFiles != nil {
		if len(r.PromptFiles) != len(d.Prompts) {
			return fmt.Errorf("public prompt file mapping must cover every prompt key")
		}
		for key, ref := range r.PromptFiles {
			if _, ok := d.Prompts[key]; !ok || !validPrompt(ref) {
				return fmt.Errorf("invalid package-local prompt reference: %s", key)
			}
		}
	}
	if r.Team != "" && !validPackageFile(r.Team, ".json") {
		return fmt.Errorf("invalid agent team entry")
	}
	return nil
}

func validPackageFile(name, suffix string) bool {
	return strings.HasSuffix(name, suffix) && validPrompt(strings.TrimSuffix(name, suffix)+".txt") && !strings.Contains(name, "#")
}

// The only prompt reader is this package's file map. Even a familiar legacy
// resource name cannot make an imported Agent read the host's prompt index.
func packagePrompt(files map[string][]byte, ref string) (string, error) {
	parts := strings.Split(ref, "#")
	data, exists := files[parts[0]]
	if !exists || !utf8.Valid(data) || len(data) > 32<<10 {
		return "", fmt.Errorf("missing, invalid or oversized public prompt: %s", parts[0])
	}
	text := strings.TrimPrefix(string(data), "\ufeff")
	if len(parts) == 1 {
		return text, nil // An empty public boundary is a valid, explicit default.
	}
	heading, found := "## "+parts[1], false
	var lines []string
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		if strings.HasPrefix(line, "## ") {
			if found {
				break
			}
			found = line == heading
			continue
		}
		if found {
			lines = append(lines, line)
		}
	}
	if !found {
		return "", fmt.Errorf("public prompt section does not exist: %s", ref)
	}
	return strings.Join(lines, "\n"), nil
}

func DecodePackage(files map[string][]byte, definition, manual, desktop, cli string) (Package, error) {
	var p Package
	for _, item := range []struct{ name, suffix string }{{definition, ".json"}, {manual, ".md"}, {desktop, ".json"}, {cli, ".json"}} {
		if !validPackageFile(item.name, item.suffix) {
			return p, fmt.Errorf("invalid or missing agent package entry: %s", item.name)
		}
	}
	d, err := ParseDefinition(files[definition])
	if err != nil {
		return p, err
	}
	if d.Runtime == nil {
		return p, fmt.Errorf("source-only agent definition has no package runtime contract")
	}
	p.Definition = d
	refs := d.Prompts
	if d.Runtime.PromptFiles != nil {
		refs = d.Runtime.PromptFiles
	}
	texts := map[string]string{}
	for key, ref := range refs {
		text, err := packagePrompt(files, ref)
		if err != nil {
			return Package{}, err
		}
		texts[key] = text
	}
	var prompt []string
	for _, key := range d.Runtime.PromptOrder {
		prompt = append(prompt, texts[key])
	}
	p.Prompt = strings.Join(prompt, "\n\n")
	if len(p.Prompt) > 32<<10 || strings.TrimSpace(p.Prompt) == "" {
		return Package{}, fmt.Errorf("assembled public agent prompt must be nonempty and at most 32 KiB")
	}
	data := files[manual]
	if len(data) > 64<<10 || !utf8.Valid(data) || strings.TrimSpace(string(data)) == "" {
		return Package{}, fmt.Errorf("agent package requires a bounded UTF-8 manual")
	}
	p.Manual = string(data)
	for _, entry := range []struct {
		file, view string
		out        *AgentView
	}{{desktop, "task", &p.Desktop}, {cli, "json", &p.CLI}} {
		if err := decode(files[entry.file], entry.out); err != nil {
			return Package{}, err
		}
		if entry.out.Schema != "aieyra.agent-view/1" || entry.out.View != entry.view || strings.TrimSpace(entry.out.Title) == "" || len(entry.out.Title) > 160 {
			return Package{}, fmt.Errorf("unsupported agent presentation: %s", entry.file)
		}
	}
	if d.Runtime.Team != "" {
		var team Team
		if err := decode(files[d.Runtime.Team], &team); err != nil {
			return Package{}, err
		}
		definitions := map[string]Definition{d.ID: d}
		for _, member := range team.Members {
			if !identifier.MatchString(member.Agent) {
				return Package{}, fmt.Errorf("invalid agent team reference")
			}
			definitions[member.Agent] = Definition{ID: member.Agent}
		}
		team, err = ParseTeam(files[d.Runtime.Team], definitions)
		if err != nil || team.Controller != d.ID {
			return Package{}, fmt.Errorf("invalid package team controller or members: %v", err)
		}
		p.Team = &team
	}
	return p, nil
}
