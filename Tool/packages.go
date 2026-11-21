// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Tool/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: resources; Official; Officials; Find; PackageFiles
// Impact: python -B scripts/code-atlas.py show Tool/packages.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Package tool owns the bundled tool catalogue and its exact public payloads.
package tool

import (
	"embed"
	"encoding/json"
	"fmt"
	"strings"
)

//go:embed catalog.json base/official toolbox/official
var resources embed.FS

type Official struct {
	Folder  string   `json:"folder"`
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Aliases []string `json:"aliases"`
}

func Officials() []Official {
	var result []Official
	raw, _ := resources.ReadFile("catalog.json")
	if err := json.Unmarshal(raw, &result); err != nil {
		panic(err)
	}
	return result
}

func Find(name string) (Official, bool) {
	for _, row := range Officials() {
		if row.ID == name {
			return row, true
		}
		for _, alias := range row.Aliases {
			if alias == name {
				return row, true
			}
		}
	}
	return Official{}, false
}

// Read only the declared payload. Tests and local developer notes are never
// assigned execution authority; all actual implementation and view bytes are.
func PackageFiles(id string) (map[string][]byte, error) {
	row, ok := Find(id)
	if !ok {
		return nil, fmt.Errorf("unknown compiled tool")
	}
	manifest, err := resources.ReadFile(row.Folder + "/manifest.json")
	if err != nil {
		return nil, err
	}
	var declared struct {
		Files map[string]json.RawMessage `json:"files"`
	}
	if err = json.Unmarshal(manifest, &declared); err != nil {
		return nil, err
	}
	files := map[string][]byte{"manifest.json": manifest}
	for name := range declared.Files {
		if strings.Contains(name, "..") || strings.HasPrefix(name, "/") {
			return nil, fmt.Errorf("invalid compiled tool path")
		}
		files[name], err = resources.ReadFile(row.Folder + "/" + name)
		if err != nil {
			return nil, err
		}
	}
	return files, nil
}
