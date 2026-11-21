// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Program/official/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: resources; Folders; PackageFiles; CompatibleDigests
// Impact: python -B scripts/code-atlas.py show Program/official/packages.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package official

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"strings"
)

// The exact public business code, pages and definitions belong to Program.
// Importing a package never changes this compiled host trust catalogue.
//
//go:embed catalog.json compatibility.json browser center coding servers link together/manifest.json together/program.json together/service.cjs all:together/product workspace/manifest.json workspace/program.json workspace/operations.json workspace/AGENTS.md workspace/LICENSE workspace/*.cjs workspace/desktop workspace/shared workspace/src workspace/dist workspace/public workspace/package.json workspace/package-lock.json workspace/index.html workspace/tsconfig.json workspace/vite.config.ts
var resources embed.FS

func Folders() []string {
	var folders []string
	data, _ := resources.ReadFile("catalog.json")
	if err := json.Unmarshal(data, &folders); err != nil {
		panic(err)
	}
	return folders
}

func PackageFiles(folder string) (map[string][]byte, error) {
	known := false
	for _, name := range Folders() {
		known = known || name == folder
	}
	if !known {
		return nil, fmt.Errorf("unknown compiled Program")
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

// Compatibility is a compiled, exact allowlist of previously shipped packages.
// Adapter verification also checks that only the recorded documentation differs.
func CompatibleDigests() map[string][]string {
	var rows map[string][]struct {
		Digest string `json:"digest"`
	}
	data, _ := resources.ReadFile("compatibility.json")
	if err := json.Unmarshal(data, &rows); err != nil {
		panic(err)
	}
	result := make(map[string][]string, len(rows))
	for id, versions := range rows {
		for _, version := range versions {
			result[id] = append(result[id], version.Digest)
		}
	}
	return result
}
