// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/userdata/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: PreparePortable; preparePortable; writablePortable
// Impact: python -B scripts/code-atlas.py show Core/userdata/portable.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package userdata

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/aieyra/aieyra-os/contracts/storage"
)

// PreparePortable selects one installation's private profile. Existing local
// layouts are retained; an unrelated AppData profile is never adopted. The
// per-installation fallback is only for a fresh, unwritable installation.
func PreparePortable(installation string) (storage.Profile, error) {
	return preparePortable(installation, os.UserConfigDir, writablePortable)
}

func preparePortable(installation string, userDir func() (string, error), probe func(string) error) (storage.Profile, error) {
	root, err := filepath.Abs(installation)
	if err != nil || strings.TrimSpace(installation) == "" {
		return storage.Profile{}, fmt.Errorf("installation directory is required")
	}
	if err = ordinary(root); err != nil {
		return storage.Profile{}, err
	}
	if profile, found, err := installedProfile(root); found || err != nil {
		return profile, err
	}
	data := filepath.Join(root, "Data")
	marker, err := storage.ReadMarker(data)
	if err != nil {
		return storage.Profile{}, err
	}
	if marker != nil {
		// Init resumes only its own interrupted initialization. A damaged,
		// migrated or missing configuration must not become a fresh profile.
		if marker.State == "ready" {
			config, e := storage.ResolveConfig(filepath.Join(data, marker.Config))
			if e != nil {
				return storage.Profile{}, e
			}
			if e = validateConfig(config); e != nil {
				return storage.Profile{}, e
			}
			return storage.Bind(config)
		}
		return Init(data)
	}
	for _, file := range []string{filepath.Join(root, "Config", "config.json"), filepath.Join(root, "config.json")} {
		if st, e := os.Lstat(file); e == nil {
			if !st.Mode().IsRegular() {
				return storage.Profile{}, fmt.Errorf("local configuration is not a regular file")
			}
			resolved, e := storage.ResolveConfig(file)
			if e != nil {
				return storage.Profile{}, e
			}
			return storage.Bind(resolved)
		} else if !os.IsNotExist(e) {
			return storage.Profile{}, e
		}
	}
	// Unknown local data is evidence of an earlier user, not an empty install.
	if entries, e := os.ReadDir(data); e == nil && len(entries) != 0 {
		return storage.Profile{}, fmt.Errorf("已有 Data 资料但缺少配置声明，请指定原配置或恢复备份；原资料已保留")
	} else if e != nil && !os.IsNotExist(e) {
		return storage.Profile{}, e
	}
	base, baseErr := userDir()
	key := filepath.Clean(root)
	if runtime.GOOS == "windows" {
		key = strings.ToLower(key)
	}
	fallback := filepath.Join(base, "AieyraOS", "Installations", fmt.Sprintf("%x", sha256.Sum256([]byte(key))), "Data")
	if baseErr == nil {
		// Once used, the fallback remains authoritative even if the program
		// directory later becomes writable. Switching requires explicit migration.
		if _, e := os.Lstat(fallback); e == nil {
			p, e := Init(fallback)
			if e == nil {
				e = validateConfig(p.Config)
			}
			return p, e
		} else if !os.IsNotExist(e) {
			return storage.Profile{}, e
		}
	}
	if err = probe(data); err == nil {
		return Init(data)
	}
	if !os.IsPermission(err) {
		return storage.Profile{}, fmt.Errorf("资料目录不可用，未切换资料: %w", err)
	}
	if baseErr != nil {
		return storage.Profile{}, fmt.Errorf("安装目录不可写，且无法定位用户资料目录: %w", baseErr)
	}
	return Init(fallback)
}

func writablePortable(dir string) error {
	if err := ordinary(dir); err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".aieyra-write-")
	if err != nil {
		return err
	}
	closeErr := f.Close()
	removeErr := os.Remove(f.Name())
	if closeErr != nil {
		return closeErr
	}
	return removeErr
}
