// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: promptLocationCache; runtimePromptIndex; promptResourcePath
// Impact: python -B scripts/code-atlas.py show Core/prompt_locations.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/aieyra/aieyra-os/contracts/resources"
	"github.com/aieyra/aieyra-os/contracts/storage"
)

var promptLocationCache struct {
	sync.Mutex
	data  []byte
	index *resources.PromptIndex
}

func runtimePromptIndex() (*resources.PromptIndex, error) {
	data, err := configResource("提示词索引.json")
	if err != nil {
		// Legacy standalone callers can supply only a Prompt directory. The
		// normal app startup still requires the index in validateRuntimeResources.
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	promptLocationCache.Lock()
	defer promptLocationCache.Unlock()
	if promptLocationCache.index != nil && bytes.Equal(promptLocationCache.data, data) {
		return promptLocationCache.index, nil
	}
	idx, err := resources.ParsePromptIndex(data)
	if err != nil {
		return nil, err
	}
	promptLocationCache.data, promptLocationCache.index = data, idx
	return idx, nil
}

func promptResourcePath(name string) (string, error) {
	index, err := runtimePromptIndex()
	if err != nil {
		return "", err
	}
	loc, err := index.Lookup(name)
	if err != nil {
		return "", err
	}
	root := ResourceRoot()
	privateRoot := filepath.Join(root, "Data", "Overrides")
	if p, ok := storage.Active(); ok {
		privateRoot = filepath.Join(p.Root, "Overrides")
	}
	if !loc.ReadOnly {
		override := filepath.Join(privateRoot, filepath.FromSlash(loc.Path))
		if _, err := os.Stat(override); err == nil {
			return override, nil
		} else if !os.IsNotExist(err) {
			return "", err
		}
	}
	if p, ok := storage.Active(); ok && p.Unified {
		if !loc.ReadOnly {
			for _, name := range []string{loc.Path, loc.Legacy} {
				override := filepath.Join(p.Overrides, filepath.FromSlash(name))
				if _, err := os.Stat(override); err == nil {
					return override, nil
				} else if !os.IsNotExist(err) {
					return "", err
				}
			}
		}
		return filepath.Join(root, filepath.FromSlash(loc.Path)), nil
	}
	if loc.LegacySHA256 != "" {
		legacy := filepath.Join(root, filepath.FromSlash(loc.Legacy))
		st, err := os.Stat(legacy)
		if err != nil && !os.IsNotExist(err) {
			return "", err
		}
		if err == nil {
			if !st.Mode().IsRegular() || st.Size() > 256<<10 {
				return "", fmt.Errorf("legacy prompt override must be a regular file below 256 KiB")
			}
			data, err := os.ReadFile(legacy)
			if err != nil || len(data) > 256<<10 {
				return "", fmt.Errorf("legacy prompt override cannot be read")
			}
			if fmt.Sprintf("%x", sha256.Sum256(data)) != loc.LegacySHA256 {
				// A prior update may have retained locally edited public text.
				// Empty overrides count too; never silently replace them.
				return legacy, nil
			}
		}
	}
	return filepath.Join(root, filepath.FromSlash(loc.Path)), nil
}
