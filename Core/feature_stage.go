// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ReleaseStage; CurrentReleaseStage; stageToolAllowed; toolboxCapabilityEnabled
// Impact: python -B scripts/code-atlas.py show Core/feature_stage.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	tool "github.com/aieyra/aieyra-os/tool/contract"
	"strings"
)

// ReleaseStage is a reversible product boundary, separate from saved user preferences.
// Missing or invalid stage configuration keeps optional features closed.
type ReleaseStage struct {
	TeamCollaboration bool `json:"team_collaboration"`
	Toolbox           bool `json:"toolbox"`
	LinkSituation     bool `json:"link_situation"`
	CLI               bool `json:"cli"`
	OSFirstRing       bool `json:"os_first_ring"`
}

func CurrentReleaseStage() ReleaseStage {
	var config struct {
		Stage map[string]json.RawMessage `json:"release_stage"`
	}
	if ReadRuntimeConfig("运行参数.json", &config) != nil {
		return ReleaseStage{}
	}
	read := func(key string) bool { var value bool; _ = json.Unmarshal(config.Stage[key], &value); return value }
	return ReleaseStage{read("team_collaboration"), read("toolbox"), read("link_situation"), read("cli"), read("os_first_ring")}
}

func stageToolAllowed(name string) bool {
	// Agent management is a foundational capability. Its Toolbox directory
	// entry must not turn the existing executor into an optional staged tool.
	if name == "agents" || name == "project" {
		return true
	}
	stage := CurrentReleaseStage()
	if name == "team" {
		return stage.TeamCollaboration
	}
	if strings.HasPrefix(name, "custom:") || tool.ValidPackageID(name) {
		return stage.Toolbox && toolboxCapabilityEnabled("tool_factory")
	}
	if name == "toolbox" {
		return stage.Toolbox
	}
	for _, optional := range toolboxCapabilities {
		if name == optional {
			// Preserve the previous direct image entry only in the old basic stage.
			if name == "image_gen" && !stage.Toolbox {
				return true
			}
			return stage.Toolbox && toolboxCapabilityEnabled(name)
		}
	}
	return true
}

// An explicit list opens only reviewed capabilities. An omitted list retains
// the legacy full-stage contract for existing installations and isolated tests.
func toolboxCapabilityEnabled(name string) bool {
	if name == "agents" || name == "project" {
		return true
	}
	var config struct {
		Tools *[]string `json:"toolbox_capabilities"`
	}
	if ReadRuntimeConfig("运行参数.json", &config) != nil {
		return false
	}
	if config.Tools == nil {
		return true
	}
	for _, enabled := range *config.Tools {
		if enabled == name {
			return true
		}
	}
	return false
}
