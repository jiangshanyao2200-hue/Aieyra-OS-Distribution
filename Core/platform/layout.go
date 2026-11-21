// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/platform/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Layout; LegacyDataDir; ResolveLayout; ModuleRoot
// Impact: python -B scripts/code-atlas.py show Core/platform/layout.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package platform

import (
	"fmt"
	"github.com/aieyra/aieyra-os/contracts/storage"
	"path/filepath"
	"strings"
)

// Layout separates installed modules, private state and user work products.
// Existing configurations keep their original storage roots; introducing a new
// module must not implicitly move a user's SQLite files or prompt overrides.
type Layout struct {
	Profile       storage.Profile `json:"profile"`
	Storage       []storage.Mount `json:"storage"`
	Application   string          `json:"application"`
	Configuration string          `json:"configuration"`
	Data          string          `json:"data"`
	Packages      string          `json:"packages"`
	Modules       string          `json:"modules"`
	Logs          string          `json:"logs"`
	Workdir       string          `json:"workdir"`
}

func LegacyDataDir(config string) string {
	dir := filepath.Dir(config)
	if strings.EqualFold(filepath.Base(dir), "Config") {
		return filepath.Join(filepath.Dir(dir), "Data")
	}
	return dir
}

func ResolveLayout(app, config, workdir string) Layout {
	profile := storage.Bound(config)
	data := profile.Root
	roots := storage.Resolve(data)
	return Layout{Profile: profile, Application: filepath.Clean(app), Configuration: filepath.Dir(config), Data: data, Packages: roots.Packages, Modules: roots.Modules, Logs: roots.Logs, Workdir: workdir, Storage: storage.Describe(data)}
}

// ModuleRoot is an ownership path, independent of a package's display name.
// Imported package objects and active-version receipts live under Packages;
// these roots hold official source packages or explicitly authored local ones.
func (l Layout) ModuleRoot(kind, origin string) (string, error) {
	var parts []string
	switch kind {
	case "halo":
		parts = []string{"Halo"}
	case "theme":
		parts = []string{"Theme"}
	case "tool":
		parts = []string{"Tool", "base"}
	case "toolbox", "workbox":
		parts = []string{"Tool", kind}
	case "program":
		parts = []string{"Program"}
	case "agent":
		parts = []string{"Agent"}
	case "api":
		parts = []string{"API", "providers"}
	case "context":
		parts = []string{"Agent", "context"}
	default:
		return "", fmt.Errorf("unknown module kind: %s", kind)
	}
	if origin != "official" && origin != "third-party" && origin != "local" {
		return "", fmt.Errorf("unknown module origin: %s", origin)
	}
	root := l.Modules
	if origin == "official" {
		root = l.Application
	}
	return filepath.Join(append([]string{root}, append(parts, origin)...)...), nil
}
