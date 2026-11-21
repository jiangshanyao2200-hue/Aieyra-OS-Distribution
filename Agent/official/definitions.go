// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/official/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: resources; definitions; load; PackageFiles; PackageIDs; Team; Role; Name; Names; Prompt
// Impact: python -B scripts/code-atlas.py show Agent/official/definitions.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package official

import (
	"embed"
	"fmt"
	"io/fs"
	"strings"

	"github.com/aieyra/aieyra-os/agent/contract"
)

// The compiled official definitions and Desktop settings use these same files.
// This is not a third-party installer or a runtime authority for permissions.
//
//go:embed Eyra Vaya Cota
var resources embed.FS

var definitions, team = load()

func load() (map[string]contract.Definition, contract.Team) {
	ds := map[string]contract.Definition{}
	for _, file := range []string{"Eyra/definition.json", "Vaya/definition.json", "Cota/definition.json"} {
		data, err := resources.ReadFile(file)
		if err != nil {
			panic(err)
		}
		d, err := contract.ParseDefinition(data)
		if err != nil {
			panic(err)
		}
		if _, exists := ds[d.ID]; exists {
			panic("duplicate official agent definition")
		}
		// The actual role consumer uses the same complete package decoder as
		// imported Agents. Legacy indexed prompt aliases still preserve overrides.
		files, err := PackageFiles(d.ID)
		if err != nil {
			panic(err)
		}
		p, err := contract.DecodePackage(files, "definition.json", "manual.md", "desktop.json", "cli.json")
		if err != nil {
			panic(err)
		}
		d = p.Definition
		ds[d.ID] = d
	}
	data, err := resources.ReadFile("Eyra/team/definition.json")
	if err != nil {
		panic(err)
	}
	t, err := contract.ParseTeam(data, ds)
	if err != nil {
		panic(err)
	}
	return ds, t
}

// PackageFiles exposes only compiled public resources. It is never populated
// by an imported package claiming an official name, nor by a private override.
// The host also validates the manifest and all declared hashes with FromFiles.
func PackageFiles(id string) (map[string][]byte, error) {
	folder := map[string]string{"aieyra.eyra": "Eyra", "aieyra.vaya": "Vaya", "aieyra.cota": "Cota"}[id]
	if folder == "" {
		return nil, fmt.Errorf("unknown compiled Agent")
	}
	files := map[string][]byte{}
	err := fs.WalkDir(resources, folder, func(name string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		data, err := resources.ReadFile(name)
		if err == nil {
			files[strings.TrimPrefix(name, folder+"/")] = data
		}
		return err
	})
	return files, err
}

func PackageIDs() []string { return []string{"aieyra.eyra", "aieyra.vaya", "aieyra.cota"} }

func Team() contract.Team { return team.Clone() }

func Role(role string) (contract.Definition, bool) {
	if role == team.ControllerRole {
		return definitions[team.Controller].Clone(), true
	}
	for _, member := range team.Members {
		if member.Role == role {
			return definitions[member.Agent].Clone(), true
		}
	}
	return contract.Definition{}, false
}

func Name(role string) string {
	d, _ := Role(role)
	return d.Name
}

func Names() map[string]string {
	names := map[string]string{team.ControllerRole: definitions[team.Controller].Name}
	for _, member := range team.Members {
		names[member.Role] = definitions[member.Agent].Name
	}
	return names
}

func Prompt(role, key string) string {
	d, _ := Role(role)
	return d.Prompts[key]
}
