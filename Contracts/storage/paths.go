// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/storage/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: definition; Area; Mount; areas; byID; init; Root; RootInLayout; Describe; Paths; Resolve
// Impact: python -B scripts/code-atlas.py show Contracts/storage/paths.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package storage declares private data ownership without opening or migrating it.
package storage

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"path"
	"path/filepath"
	"strings"
)

//go:embed areas.json
var definition []byte

type Area struct {
	ID              string `json:"id"`
	Relative        string `json:"relative"`
	ProfileRelative string `json:"profile_relative"`
	Owner           string `json:"owner"`
	Cleanup         string `json:"cleanup"`
	Description     string `json:"description"`
}
type Mount struct {
	Area
	Path string `json:"path"`
}

var areas []Area
var byID map[string]Area

func init() {
	var d struct {
		Schema int    `json:"schema"`
		Areas  []Area `json:"areas"`
	}
	if json.Unmarshal(definition, &d) != nil || d.Schema != 1 {
		panic("invalid storage contract")
	}
	byID = map[string]Area{}
	for _, a := range d.Areas {
		if a.ID == "" || byID[a.ID].ID != "" || a.Owner == "" || a.Cleanup == "" || a.Relative == "" || a.Relative == "." || path.Clean(a.Relative) != a.Relative || strings.HasPrefix(a.Relative, "/") || strings.ContainsAny(a.Relative, "\\:") {
			panic("invalid storage area")
		}
		for _, value := range []string{a.Relative, a.ProfileRelative} {
			if value == "" || value == "." || path.Clean(value) != value || strings.HasPrefix(value, "/") || strings.ContainsAny(value, "\\:") {
				panic("invalid storage layout")
			}
			for _, p := range strings.Split(value, "/") {
				if p == ".." {
					panic("storage path escapes its data root")
				}
			}
		}
		byID[a.ID] = a
	}
	areas = d.Areas
}

// Root returns an existing mapping, not a filesystem permission or a deletion grant.
func Root(data, area string) (string, error) {
	return RootInLayout(data, area, profileRootBound(data))
}

// RootInLayout also serves the initializer before a profile is ready to bind.
func RootInLayout(data, area string, unified bool) (string, error) {
	a, ok := byID[area]
	if !ok {
		return "", fmt.Errorf("unknown private storage area: %s", area)
	}
	relative := a.Relative
	if unified {
		relative = a.ProfileRelative
	}
	return filepath.Join(data, filepath.FromSlash(relative)), nil
}
func Describe(data string) []Mount {
	out := make([]Mount, 0, len(areas))
	for _, a := range areas {
		p, _ := Root(data, a.ID)
		out = append(out, Mount{Area: a, Path: p})
	}
	return out
}

type Paths struct {
	Sessions, Conversations, Context, Memory, Attachments, Gallery, GeneratedImages, Reports, Logs, Runtime, Tasks, Programs, Packages, Modules, Workflows, Agents                                                                           string
	Workspaces, CLIWorkspaces, ImageBatches, VideoTasks, ProjectMaps, Stations, MatrixAPI, Browser, Preview, DesktopProfile, MatrixProfile, Captures, SettingsRevisions, Apps, Resources, Forum, Updates, Link, Notes, DeskMode, ModuleOrder string
}

func Resolve(data string) Paths {
	get := func(id string) string {
		p, e := Root(data, id)
		if e != nil {
			panic(e)
		}
		return p
	}
	return Paths{Sessions: get("sessions"), Conversations: get("conversations"), Context: get("context"), Memory: get("memory"), Attachments: get("attachments"), Gallery: get("gallery"), GeneratedImages: get("generated_images"), Reports: get("reports"), Logs: get("logs"), Runtime: get("runtime"), Tasks: get("tasks"), Programs: get("programs"), Packages: get("packages"), Modules: get("modules"), Workflows: get("workflows"), Agents: get("agents"), Workspaces: get("workspaces"), CLIWorkspaces: get("cli_workspaces"), ImageBatches: get("image_batches"), VideoTasks: get("video_tasks"), ProjectMaps: get("project_maps"), Stations: get("stations"), MatrixAPI: get("matrix_api"), Browser: get("browser"), Preview: get("preview"), DesktopProfile: get("desktop_profile"), MatrixProfile: get("matrix_profile"), Captures: get("captures"), SettingsRevisions: get("settings_revisions"), Apps: get("apps"), Resources: get("resources"), Forum: get("forum"), Updates: get("updates"), Link: get("link"), Notes: get("notes"), DeskMode: get("desk_mode"), ModuleOrder: get("module_order")}
}
