// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/userdata/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: transferFile; inventory; legacyInventory; mapTarget
// Impact: python -B scripts/code-atlas.py show Core/userdata/inventory.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package userdata

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/aieyra/aieyra-os/contracts/storage"
)

type transferFile struct {
	Source    string `json:"source"`
	Target    string `json:"target"`
	Bytes     int64  `json:"bytes"`
	Modified  int64  `json:"modified"`
	Mode      uint32 `json:"mode"`
	Directory bool   `json:"directory,omitempty"`
	SHA256    string `json:"sha256,omitempty"`
}

type inventory struct {
	Files   []transferFile         `json:"files"`
	Origins storage.OriginDocument `json:"origins"`
	Bytes   int64                  `json:"bytes"`
}

func legacyInventory(source storage.Profile, destinationID string) (inventory, error) {
	var result inventory

	data, configDir := source.Root, filepath.Dir(source.Config)
	canonical := strings.EqualFold(filepath.Base(configDir), "Config")
	windows := runtime.GOOS == "windows"
	result.Origins = storage.OriginDocument{Schema: 1, ProfileID: destinationID, IdentityConfig: source.IdentityConfig()}
	add := func(from, to string, directory bool) {
		result.Origins.Mappings = append(result.Origins.Mappings, storage.Origin{From: from, To: to, Directory: directory, Windows: windows})
	}
	if source.Unified {
		result.Origins.Mappings = source.Origins()
		add(source.Root, ".", true)
		add(source.Config, "Config/config.json", false)
	} else {
		add(source.Config, "Config/config.json", false)
		add(filepath.Join(data, filepath.Base(source.Config)+".catalog-cache"), "Config/catalog-cache", true)
		for _, a := range storage.Describe(data) {
			add(a.Path, a.ProfileRelative, a.ID != "desk_mode" && a.ID != "module_order")
		}
		add(filepath.Join(source.Overrides, "Prompt"), "Overrides/Prompt", true)
		add(filepath.Join(data, "Overrides"), "Overrides", true)
		if canonical {
			legacyMemory := filepath.Join(configDir, "memory")
			oldEntries, e := os.ReadDir(legacyMemory)
			if e != nil && !os.IsNotExist(e) {
				return result, e
			}
			newEntries, e := os.ReadDir(filepath.Join(data, "memory"))
			if e != nil && !os.IsNotExist(e) {
				return result, e
			}
			if len(oldEntries) > 0 && len(newEntries) > 0 {
				return result, fmt.Errorf("both legacy and current memory stores contain files; choose their ownership before migrating, neither was opened")
			}
			if len(oldEntries) > 0 {
				add(legacyMemory, "Memory", true)
			}
			add(configDir, "Config", true)
			add(data, "Legacy/Data", true)
		} else {
			// Adjacent flat profiles may also contain work products. Keep every
			// unknown file, but do not reclassify it as an active private service.
			add(data, "Legacy/Adjacent", true)
			entries, err := os.ReadDir(data)
			if err != nil {
				return result, err
			}
			for _, e := range entries {
				if !e.IsDir() && strings.HasSuffix(strings.ToLower(e.Name()), ".json") && !samePath(filepath.Join(data, e.Name()), source.Config) && e.Name() != "desk-mode.json" && e.Name() != "module-order.json" {
					add(filepath.Join(data, e.Name()), "Config/"+e.Name(), false)
				}
			}
		}
	}
	if err := storage.ValidateOrigins(result.Origins, destinationID); err != nil {
		return result, err
	}
	sort.SliceStable(result.Origins.Mappings, func(i, j int) bool {
		return len(result.Origins.Mappings[i].From) > len(result.Origins.Mappings[j].From)
	})
	roots := []string{data}
	if canonical && !source.Unified {
		roots = append(roots, configDir, filepath.Join(source.Overrides, "Prompt"))
	}
	targets := map[string]string{}
	targetDirs := map[string]bool{}
	sources := map[string]bool{}
	for _, root := range roots {
		if err := ordinary(root); err != nil {
			return result, err
		}
		if _, err := os.Lstat(root); os.IsNotExist(err) {
			continue
		} else if err != nil {
			return result, err
		}
		err := filepath.WalkDir(root, func(file string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if file == filepath.Join(data, storage.OwnerDirectory) || file == filepath.Join(data, transferWork) {
				return filepath.SkipDir
			}
			if filepath.Dir(file) == data && (d.Name() == storage.MigrationBarrier || d.Name() == migrationLock || d.Name() == storage.ProfileMarker || d.Name() == storage.MigrationReceiptFile || d.Name() == storage.OriginsFile || d.Name() == lockName || d.Name() == journalName) {
				return nil
			}
			if d.Type()&os.ModeSymlink != 0 {
				return fmt.Errorf("migration source contains a redirected path: %s", file)
			}

			st, err := d.Info()
			if err != nil {
				return err
			}
			if !st.Mode().IsRegular() && !st.IsDir() {
				return fmt.Errorf("migration source contains a special file: %s", file)
			}
			if strings.HasSuffix(d.Name(), ".write-lock") {
				return fmt.Errorf("configuration writer has not released its lock")
			}
			if len(result.Files) >= 100000 {
				return fmt.Errorf("migration inventory exceeds 100000 files; original retained")
			}
			target, err := mapTarget(file, result.Origins.Mappings)
			if err != nil {
				return err
			}
			sourceKey := filepath.Clean(file)
			if windows {
				sourceKey = strings.ToLower(sourceKey)
			}
			if sources[sourceKey] {
				return nil
			}
			sources[sourceKey] = true
			key := strings.ToLower(target)
			if other, ok := targets[key]; ok {
				if targetDirs[key] && st.IsDir() {
					return nil
				}
				return fmt.Errorf("migration destination collision: %s and %s", other, file)
			}
			targets[key] = file
			targetDirs[key] = st.IsDir()
			result.Files = append(result.Files, transferFile{Source: file, Target: target, Bytes: st.Size(), Modified: st.ModTime().UnixNano(), Mode: uint32(st.Mode().Perm()), Directory: st.IsDir()})
			if !st.IsDir() {
				result.Bytes += st.Size()
			}
			return nil
		})
		if err != nil {
			return result, err
		}
	}
	sort.Slice(result.Files, func(i, j int) bool { return result.Files[i].Target < result.Files[j].Target })
	return result, nil
}

func mapTarget(file string, mappings []storage.Origin) (string, error) {
	for _, m := range mappings {
		match := file == m.From
		if m.Windows {
			match = strings.EqualFold(file, m.From)
		}
		if match {
			return m.To, nil
		}
		if m.Directory {
			rel, err := filepath.Rel(m.From, file)
			if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel) {
				return filepath.ToSlash(filepath.Join(m.To, rel)), nil
			}
		}
	}
	return "", fmt.Errorf("migration source has no ownership mapping: %s", file)
}
