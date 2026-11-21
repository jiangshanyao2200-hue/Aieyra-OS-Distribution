// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: localSearchPython; localSearchAvailable; localWebSearch
// Impact: python -B scripts/code-atlas.py show Core/web_search_local.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	searchtool "github.com/aieyra/aieyra-os/tool/base/official/web_search"
	"os"
	"path/filepath"
	"runtime"
)

func localSearchPython() string {
	name := "python"
	if runtime.GOOS == "windows" {
		name = "python.exe"
	}
	return filepath.Join(ResourceRoot(), "runtime", "search", name)
}
func localSearchAvailable() bool {
	info, err := os.Stat(localSearchPython())
	return err == nil && info.Mode().IsRegular()
}
func localWebSearch(ctx context.Context, q string) (WebSearchResult, error) {
	return searchtool.Local(ctx, q, searchtool.LocalOptions{Python: localSearchPython(), Configure: configureExecutionProcess})
}
