// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/contract/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Definition; TeamMember; Team; identifier; version; decode; validNames; validPrompt; ParseDefinition; ParseTeam; Clone; Clone
// Impact: python -B scripts/code-atlas.py show Agent/contract/definition.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package contract owns declarative Agent data. Loading a definition grants no
// tools, starts no process and does not read a user's model or memory.
package contract

import (
	"bytes"
	"encoding/json"
	"fmt"
	contextport "github.com/aieyra/aieyra-os/contracts/context"
	"io"
	"maps"
	"path"
	"regexp"
	"slices"
	"strings"
)

type Definition struct {
	Runtime         *PackageRuntime        `json:"runtime,omitempty"`
	ContextProvider *contextport.Reference `json:"context_provider,omitempty"`
	Schema          int                    `json:"schema"`
	ID              string                 `json:"id"`
	Version         string                 `json:"version"`
	Name            string                 `json:"name"`
	ToolChoices     []string               `json:"tool_choices"`
	DefaultTools    []string               `json:"default_tools"`
	Prompts         map[string]string      `json:"prompts"`
}

type TeamMember struct {
	Role         string `json:"role"`
	Agent        string `json:"agent"`
	ToolsSetting string `json:"tools_setting"`
}

type Team struct {
	Schema           int          `json:"schema"`
	Controller       string       `json:"controller"`
	ControllerRole   string       `json:"controller_role"`
	Members          []TeamMember `json:"members"`
	GrantableToolbox []string     `json:"grantable_toolbox"`
}

var identifier = regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,95}$`)
var version = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)

func decode(data []byte, out any) error {
	if len(data) > 64<<10 {
		return fmt.Errorf("agent definition exceeds 64 KiB")
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("agent definition must contain one JSON value")
	}
	return nil
}

func validNames(names []string) bool {
	seen := map[string]bool{}
	for _, name := range names {
		if !identifier.MatchString(name) || seen[name] {
			return false
		}
		seen[name] = true
	}
	return len(names) <= 128
}

// Prompt references retain the existing indexed public-resource namespace.
// Actual files, fragments and private overrides are resolved by the host.
func validPrompt(ref string) bool {
	parts := strings.Split(ref, "#")
	if len(parts) > 2 || len(parts) == 2 && strings.TrimSpace(parts[1]) == "" || len(ref) > 500 || strings.ContainsAny(ref, "\\:\x00\r\n") {
		return false
	}
	p := parts[0]
	return p != "" && !strings.HasPrefix(p, "/") && path.Clean(p) == p && p != ".." && !strings.HasPrefix(p, "../") && strings.HasSuffix(p, ".txt")
}

func ParseDefinition(data []byte) (Definition, error) {
	var d Definition
	if err := decode(data, &d); err != nil {
		return d, err
	}
	if d.Schema != 1 || !identifier.MatchString(d.ID) || !version.MatchString(d.Version) || strings.TrimSpace(d.Name) == "" || len(d.Name) > 128 {
		return Definition{}, fmt.Errorf("invalid agent identity or schema")
	}
	if d.ContextProvider != nil {
		if err := d.ContextProvider.Validate(); err != nil {
			return Definition{}, err
		}
	}
	if !validNames(d.ToolChoices) || !validNames(d.DefaultTools) {
		return Definition{}, fmt.Errorf("invalid or repeated agent tools")
	}
	for _, name := range d.DefaultTools {
		if !slices.Contains(d.ToolChoices, name) {
			return Definition{}, fmt.Errorf("default tool %s is not a choice", name)
		}
	}
	if len(d.Prompts) == 0 || len(d.Prompts) > 64 {
		return Definition{}, fmt.Errorf("agent needs indexed prompt references")
	}
	for key, ref := range d.Prompts {
		if !identifier.MatchString(key) || !validPrompt(ref) {
			return Definition{}, fmt.Errorf("invalid prompt reference %s", key)
		}
	}
	if d.Runtime != nil {
		if err := d.Runtime.Validate(d); err != nil {
			return Definition{}, err
		}
	}
	return d, nil
}

// ParseTeam resolves declared members against definitions, never against a
// display name. Enabling members and granting effective tools remain host work.
func ParseTeam(data []byte, definitions map[string]Definition) (Team, error) {
	var t Team
	if err := decode(data, &t); err != nil {
		return t, err
	}
	if t.Schema != 1 || definitions[t.Controller].ID != t.Controller || t.Controller == "" || !identifier.MatchString(t.ControllerRole) || !validNames(t.GrantableToolbox) || len(t.Members) > 32 {
		return Team{}, fmt.Errorf("invalid team controller, schema or toolbox")
	}
	roles := map[string]bool{t.ControllerRole: true}
	settings := map[string]bool{}
	for _, member := range t.Members {
		if !identifier.MatchString(member.Role) || roles[member.Role] || member.Agent == "" || definitions[member.Agent].ID != member.Agent || member.Agent == t.Controller || !identifier.MatchString(member.ToolsSetting) || settings[member.ToolsSetting] {
			return Team{}, fmt.Errorf("invalid, duplicate or unresolved team member")
		}
		roles[member.Role], settings[member.ToolsSetting] = true, true
	}
	return t, nil
}

func (d Definition) Clone() Definition {
	if d.Runtime != nil {
		data, _ := json.Marshal(d.Runtime)
		var runtime PackageRuntime
		_ = json.Unmarshal(data, &runtime)
		d.Runtime = &runtime
	}
	if d.ContextProvider != nil {
		cp := *d.ContextProvider
		d.ContextProvider = &cp
	}
	d.ToolChoices = slices.Clone(d.ToolChoices)
	d.DefaultTools = slices.Clone(d.DefaultTools)
	d.Prompts = maps.Clone(d.Prompts)
	return d
}

func (t Team) Clone() Team {
	t.Members = slices.Clone(t.Members)
	t.GrantableToolbox = slices.Clone(t.GrantableToolbox)
	return t
}
