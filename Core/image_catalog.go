// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: readGeneratedIndex
// Impact: python -B scripts/code-atlas.py show Core/image_catalog.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Compatibility reader used by migration/tests; production writes one entry
// at a time and the Desktop reads immutable entries through its metadata cache.
func readGeneratedIndex(dir string) (generatedIndex, error) {
	index, err := readLegacyGeneratedIndex(dir)
	if err != nil {
		return index, err
	}
	files, err := os.ReadDir(filepath.Join(dir, "entries"))
	if errors.Is(err, os.ErrNotExist) {
		return index, nil
	}
	if err != nil {
		return index, err
	}
	seen := map[string]bool{}
	for _, im := range index.Images {
		seen[im.ID] = true
	}
	for _, entry := range files {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		p := filepath.Join(dir, "entries", entry.Name())
		info, e := entry.Info()
		if e != nil {
			return index, e
		}
		if !info.Mode().IsRegular() || info.Size() > 256<<10 {
			return index, fmt.Errorf("图片元数据异常：%s", entry.Name())
		}
		data, e := os.ReadFile(p)
		if e != nil {
			return index, e
		}
		var item generatedImage
		if json.Unmarshal(data, &item) != nil || entry.Name() != item.ID+".json" {
			return index, fmt.Errorf("图片元数据损坏：%s", entry.Name())
		}
		if !seen[item.ID] {
			seen[item.ID] = true
			index.Images = append(index.Images, item)
		}
	}
	return index, nil
}
