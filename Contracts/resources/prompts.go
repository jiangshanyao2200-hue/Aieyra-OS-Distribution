// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/resources/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: PromptLocation; PromptIndex; sha256; Relative; logical; AgentPrompt; toolManualPattern; ToolManual; ParsePromptIndex; Lookup; Files
// Impact: python -B scripts/code-atlas.py show Contracts/resources/prompts.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package resources defines logical public prompt names and their package paths.
// It performs no file reads. Hosts choose the resource root and preserve overrides.
package resources

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

type PromptLocation struct {
	Path         string
	Legacy       string
	LegacySHA256 string
	ReadOnly     bool
}

type PromptIndex struct{ locations map[string]PromptLocation }

var sha256 = regexp.MustCompile(`^[a-f0-9]{64}$`)

func Relative(name string) bool {
	if name == "" || len(name) > 500 || strings.ContainsAny(name, "\\:\x00\r\n") {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if part == "" || part == "." || part == ".." || strings.TrimRight(part, ". ") != part {
			return false
		}
	}
	return true
}

func logical(name string) (string, error) {
	parts := strings.Split(name, "#")
	if len(parts) > 2 || !Relative(parts[0]) || !strings.HasSuffix(parts[0], ".txt") || len(parts) == 2 && strings.TrimSpace(parts[1]) == "" {
		return "", fmt.Errorf("invalid prompt resource: %s", name)
	}
	return parts[0], nil
}

func AgentPrompt(name string) bool {
	if !Relative(name) || !strings.HasSuffix(name, ".txt") {
		return false
	}
	for _, prefix := range []string{"Agent/program/prompts/", "Agent/official/Eyra/prompts/", "Agent/official/Eyra/context/prompts/", "Agent/official/Vaya/prompts/", "Agent/official/Cota/prompts/"} {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}

var toolManualPattern = regexp.MustCompile(`^Tool/(base|toolbox|workbox)/official/[a-z][a-z0-9_-]{0,63}/(manual\.txt|(manual|prompts)/[a-z][a-z0-9_-]{0,63}\.txt)$`)

func ToolManual(name string) bool { return Relative(name) && toolManualPattern.MatchString(name) }

func ParsePromptIndex(data []byte) (*PromptIndex, error) {
	var raw struct {
		Resources []struct {
			File         string `json:"file"`
			Path         string `json:"path"`
			LegacySHA256 string `json:"legacy_sha256"`
			ReadOnly     bool   `json:"read_only"`
		} `json:"resources"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	if raw.Resources == nil {
		return nil, fmt.Errorf("invalid prompt resource index")
	}
	idx := &PromptIndex{locations: map[string]PromptLocation{}}
	for _, row := range raw.Resources {
		key, err := logical(row.File)
		if err != nil {
			return nil, err
		}
		loc := PromptLocation{Path: "Prompt/" + key, Legacy: "Prompt/" + key, ReadOnly: row.ReadOnly || strings.HasPrefix(key, "Matrix/默认/")}
		if row.Path != "" {
			if !(AgentPrompt(row.Path) || ToolManual(row.Path)) || !sha256.MatchString(row.LegacySHA256) {
				return nil, fmt.Errorf("invalid mapped prompt resource: %s", key)
			}
			loc.Path, loc.LegacySHA256 = row.Path, row.LegacySHA256
		} else if row.LegacySHA256 != "" {
			return nil, fmt.Errorf("prompt legacy digest needs a mapped path")
		}
		if old, ok := idx.locations[key]; ok && old != loc {
			return nil, fmt.Errorf("conflicting prompt resource paths: %s", key)
		}
		idx.locations[key] = loc
	}
	return idx, nil
}

// Unindexed legacy names retain the existing resource API. Startup validation
// and editors separately require their complete indexed catalogue.
func (idx *PromptIndex) Lookup(name string) (PromptLocation, error) {
	key, err := logical(name)
	if err != nil {
		return PromptLocation{}, err
	}
	if idx != nil {
		if loc, ok := idx.locations[key]; ok {
			return loc, nil
		}
	}
	return PromptLocation{Path: "Prompt/" + key, Legacy: "Prompt/" + key, ReadOnly: strings.HasPrefix(key, "Matrix/默认/")}, nil
}

func (idx *PromptIndex) Files() []string {
	set := map[string]bool{}
	for _, loc := range idx.locations {
		set[loc.Path] = true
	}
	files := make([]string, 0, len(set))
	for file := range set {
		files = append(files, file)
	}
	sort.Strings(files)
	return files
}
