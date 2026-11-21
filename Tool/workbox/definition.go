// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/workbox/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: Schema; StateSchema; MaxSteps; identifier; Tool; Condition; Step; AgentTemplate; Definition; Package; strict; Decode; Validate
// Impact: python -B scripts/code-atlas.py show Tool/workbox/definition.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package workbox owns declarative workflows and their deterministic state.
// Execution, permissions, credentials, storage and Agent creation are host ports.
package workbox

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"unicode/utf8"

	tool "github.com/aieyra/aieyra-os/tool/contract"
)

const Schema = "aieyra.workbox/1"
const StateSchema = "aieyra.workbox-state/1"
const MaxSteps = 32

var identifier = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,47}$`)

type Tool struct {
	Builtin string `json:"builtin,omitempty"`
	Package string `json:"package,omitempty"`
}

type Condition struct {
	Step   string `json:"step"`
	Path   string `json:"path"`
	Equals any    `json:"equals"`
}

type Step struct {
	ID        string         `json:"id"`
	Title     string         `json:"title"`
	Kind      string         `json:"kind"` // call or checkpoint
	Needs     []string       `json:"needs"`
	Tool      string         `json:"tool,omitempty"`
	Arguments map[string]any `json:"arguments,omitempty"`
	Effect    string         `json:"effect,omitempty"` // read, idempotent, external
	When      *Condition     `json:"when,omitempty"`
}

type AgentTemplate struct {
	Package        string `json:"package,omitempty"` // Required Agent dependency; legacy inline fields must be empty.
	Title          string `json:"title"`
	Prompt         string `json:"prompt"`
	MaxTokens      int    `json:"max_tokens"`
	TimeoutSeconds int    `json:"timeout_seconds"`
	Retention      string `json:"retention"` // task or retained
}

type Definition struct {
	Schema        string          `json:"schema"`
	Name          string          `json:"name"`
	Description   string          `json:"description"`
	Input         map[string]any  `json:"input"`
	Tools         map[string]Tool `json:"tools"`
	Steps         []Step          `json:"steps"`
	Outputs       map[string]any  `json:"outputs"`
	AgentTemplate *AgentTemplate  `json:"agentTemplate,omitempty"`
}

type Package struct {
	Definition
	Manual string
	Title  string
}

func strict(raw []byte, out any) error {
	if len(raw) == 0 || len(raw) > 128<<10 || !utf8.Valid(raw) {
		return fmt.Errorf("invalid or oversized workbox definition")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return fmt.Errorf("trailing workbox definition")
	}
	return nil
}

func Decode(files map[string][]byte, entry, manual, desktop, cli string) (Package, error) {
	var p Package
	if err := strict(files[entry], &p.Definition); err != nil {
		return p, err
	}
	if err := p.Definition.Validate(); err != nil {
		return p, err
	}
	b := files[manual]
	if !utf8.Valid(b) || len(b) > 32<<10 || strings.TrimSpace(string(b)) == "" {
		return p, fmt.Errorf("a nonempty bounded workbox manual is required")
	}
	p.Manual = string(b)
	var view struct {
		Schema string `json:"schema"`
		Result string `json:"result"`
		Title  string `json:"title"`
	}
	if err := strict(files[desktop], &view); err != nil {
		return p, err
	}
	if view.Schema != "aieyra.workbox-view/1" || view.Result != "workflow" || strings.TrimSpace(view.Title) == "" || len(view.Title) > 160 {
		return p, fmt.Errorf("unsupported desktop workflow binding")
	}
	p.Title = view.Title
	var text struct {
		Schema string `json:"schema"`
		Result string `json:"result"`
		Format string `json:"format"`
	}
	if err := strict(files[cli], &text); err != nil {
		return p, err
	}
	if text.Schema != "aieyra.workbox-text/1" || text.Result != "workflow" || text.Format != "json" {
		return p, fmt.Errorf("unsupported CLI workflow binding")
	}
	return p, nil
}

func (d Definition) Validate() error {
	if d.Schema != Schema || !identifier.MatchString(d.Name) || strings.TrimSpace(d.Description) == "" || len(d.Description) > 2000 {
		return fmt.Errorf("invalid workbox identity or description")
	}
	if err := tool.ValidateSchema(d.Input); err != nil {
		return err
	}
	if d.Input["type"] != "object" || len(d.Tools) < 1 || len(d.Tools) > 16 || len(d.Steps) < 1 || len(d.Steps) > MaxSteps || len(d.Outputs) > 32 {
		return fmt.Errorf("workbox input/tools/steps/output count is invalid")
	}
	for alias, ref := range d.Tools {
		if !identifier.MatchString(alias) || (ref.Builtin == "") == (ref.Package == "") {
			return fmt.Errorf("invalid tool alias or reference: %s", alias)
		}
		if ref.Builtin != "" && ref.Builtin != "image_gen" {
			return fmt.Errorf("unsupported builtin workbox tool: %s", ref.Builtin)
		}
		if ref.Package != "" && !tool.ValidPackageID("mod:"+ref.Package+"@"+strings.Repeat("0", 64)) {
			return fmt.Errorf("invalid tool package dependency: %s", ref.Package)
		}
	}
	seen, used := map[string]bool{}, map[string]bool{}
	for _, step := range d.Steps {
		if !identifier.MatchString(step.ID) || seen[step.ID] || strings.TrimSpace(step.Title) == "" || len(step.Title) > 160 {
			return fmt.Errorf("invalid or duplicate workflow step: %s", step.ID)
		}
		needs := map[string]bool{}
		for _, dep := range step.Needs {
			if !seen[dep] || needs[dep] {
				return fmt.Errorf("step %s needs a prior, unique step: %s", step.ID, dep)
			}
			needs[dep] = true
		}
		if step.When != nil {
			if !needs[step.When.Step] {
				return fmt.Errorf("step condition needs an explicit dependency")
			}
			if _, err := pointerParts(step.When.Path); err != nil {
				return err
			}
		}
		switch step.Kind {
		case "call":
			ref, ok := d.Tools[step.Tool]
			if !ok || step.Arguments == nil || step.Effect != "read" && step.Effect != "idempotent" && step.Effect != "external" {
				return fmt.Errorf("step %s requires a declared tool, arguments and effect", step.ID)
			}
			if ref.Builtin == "image_gen" && step.Effect != "external" {
				return fmt.Errorf("image generation must declare its external effect")
			}
			if err := validateBindings(step.Arguments, d.Input, needs, 0); err != nil {
				return fmt.Errorf("step %s: %w", step.ID, err)
			}
			used[step.Tool] = true
		case "checkpoint":
			if step.Tool != "" || len(step.Arguments) != 0 || step.Effect != "" {
				return fmt.Errorf("checkpoint cannot invoke a tool")
			}
		default:
			return fmt.Errorf("unknown step kind: %s", step.Kind)
		}
		seen[step.ID] = true
	}
	if len(used) != len(d.Tools) {
		return fmt.Errorf("workbox declares tools unused by its steps")
	}
	for key, output := range d.Outputs {
		if !identifier.MatchString(key) {
			return fmt.Errorf("invalid workflow output name")
		}
		if err := validateBindings(output, d.Input, seen, 0); err != nil {
			return err
		}
	}
	if a := d.AgentTemplate; a != nil {
		if a.Package != "" {
			if !tool.ValidPackageID("mod:"+a.Package+"@"+strings.Repeat("0", 64)) || a.Title != "" || a.Prompt != "" || a.MaxTokens != 0 || a.TimeoutSeconds != 0 || a.Retention != "task" && a.Retention != "retained" {
				return fmt.Errorf("package specialist requires an Agent dependency and retention, without inline overrides")
			}
			return nil
		}
		if strings.TrimSpace(a.Title) == "" || len(a.Title) > 160 || strings.TrimSpace(a.Prompt) == "" || len(a.Prompt)+len(CommandManual)+1 > 32<<10 || a.MaxTokens < 1 || a.MaxTokens > 10000000 || a.TimeoutSeconds < 10 || a.TimeoutSeconds > 3600 || a.Retention != "task" && a.Retention != "retained" {
			return fmt.Errorf("invalid specialist Agent template or budget")
		}
	}
	return nil
}
