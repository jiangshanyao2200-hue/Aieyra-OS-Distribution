// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/storage/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: OriginsFile; Origin; OriginDocument; originSet; originKey; ValidateOrigins; readOrigins; Relocate; Relocate; Origins; PreviousPaths; IdentityConfig
// Impact: python -B scripts/code-atlas.py show Contracts/storage/origins.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

const OriginsFile = ".aieyra-origins.json"

// Origin maps old private paths at the moment they are used, without rewriting
// message text, historical tool arguments, request IDs or original transcripts.
type Origin struct {
	From      string `json:"from"`
	To        string `json:"to"`
	Directory bool   `json:"directory"`
	Windows   bool   `json:"windows"`
}
type OriginDocument struct {
	IdentityConfig string   `json:"identity_config,omitempty"`
	Schema         int      `json:"schema"`
	ProfileID      string   `json:"profile_id"`
	Mappings       []Origin `json:"mappings"`
}
type originSet struct {
	mappings       []Origin
	identityConfig string
}

func originKey(value string, windows bool) string {
	if windows {
		value = strings.ReplaceAll(value, "\\", "/")
		value = strings.ToLower(value)
	}
	return path.Clean(value)
}

func ValidateOrigins(d OriginDocument, id string) error {
	if d.Schema != 1 || d.ProfileID != id || len(d.Mappings) > 10000 {
		return fmt.Errorf("invalid migration path mapping")
	}
	seen := map[string]bool{}
	for _, m := range d.Mappings {
		from := originKey(m.From, m.Windows)
		absolute := strings.HasPrefix(from, "/") || len(from) > 3 && from[1:3] == ":/"
		if !absolute || from == "/" || len(from) == 3 && from[1:] == ":/" || strings.ContainsAny(from, "\x00\r\n") || m.To == "" || m.To == "." && !m.Directory || path.Clean(m.To) != m.To || strings.HasPrefix(m.To, "/") || strings.ContainsAny(m.To, "\\:\x00\r\n") || strings.HasPrefix(m.To, "../") || m.To == ".." || seen[from] {
			return fmt.Errorf("invalid migration path mapping")
		}
		seen[from] = true
	}
	if d.IdentityConfig != "" {
		found := false
		for _, m := range d.Mappings {
			if !m.Directory && m.To == "Config/config.json" && originKey(m.From, m.Windows) == originKey(d.IdentityConfig, m.Windows) {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("migration config identity has no matching origin")
		}
	}
	return nil
}

func readOrigins(root, id string) (*originSet, error) {
	file := filepath.Join(root, OriginsFile)
	st, err := os.Lstat(file)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !st.Mode().IsRegular() || st.Size() > 8<<20 {
		return nil, fmt.Errorf("invalid migration path mapping file")
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return nil, err
	}
	var d OriginDocument
	if len(data) > 8<<20 || json.Unmarshal(data, &d) != nil {
		return nil, fmt.Errorf("invalid migration path mapping file")
	}
	if err = ValidateOrigins(d, id); err != nil {
		return nil, err
	}
	sort.SliceStable(d.Mappings, func(i, j int) bool { return len(d.Mappings[i].From) > len(d.Mappings[j].From) })
	return &originSet{mappings: d.Mappings, identityConfig: d.IdentityConfig}, nil
}

func Relocate(config, value string) string { return Bound(config).Relocate(value) }

func (p Profile) Relocate(value string) string {
	if !p.Unified || p.origins == nil {
		return value
	}
	for _, m := range p.origins.mappings {
		from, v := originKey(m.From, m.Windows), originKey(value, m.Windows)
		if v == from {
			return filepath.Join(p.Root, filepath.FromSlash(m.To))
		}
		if m.Directory && strings.HasPrefix(v, from+"/") {
			// Keep original suffix case even when comparing Windows identities.
			raw := value
			if m.Windows {
				raw = strings.ReplaceAll(raw, "\\", "/")
			}
			raw = path.Clean(raw)
			suffix := strings.Join(strings.Split(raw, "/")[len(strings.Split(from, "/")):], "/")
			return filepath.Join(p.Root, filepath.FromSlash(m.To), filepath.FromSlash(suffix))
		}
	}
	return value
}

// Origins returns an independent copy for subsequent offline moves.
func (p Profile) Origins() []Origin {
	if p.origins == nil {
		return nil
	}
	return append([]Origin(nil), p.origins.mappings...)
}

// PreviousPaths returns recorded former names of this exact current path.
// They are identities only: callers must never use them to read the old root.
// Multiple moves can yield multiple names, so the owner must resolve ambiguity
// against its durable records instead of choosing an arbitrary migration order.
func (p Profile) PreviousPaths(value string) []string {
	if !p.Unified || p.origins == nil {
		return nil
	}
	windows := runtime.GOOS == "windows"
	current := originKey(value, windows)
	raw := value
	if windows {
		raw = strings.ReplaceAll(raw, "\\", "/")
	}
	raw = path.Clean(raw)
	seen := map[string]bool{}
	var result []string
	for _, m := range p.origins.mappings {
		target := originKey(filepath.Join(p.Root, filepath.FromSlash(m.To)), windows)
		suffix := ""
		if current != target {
			if !m.Directory || !strings.HasPrefix(current, target+"/") {
				continue
			}
			suffix = strings.Join(strings.Split(raw, "/")[len(strings.Split(target, "/")):], "/")
		}
		former := m.From
		if m.Windows {
			former = strings.ReplaceAll(former, "\\", "/")
		}
		former = path.Join(former, suffix)
		if m.Windows {
			former = strings.ReplaceAll(former, "/", "\\")
		}
		// A more specific forward mapping may override this parent mapping.
		if originKey(p.Relocate(former), windows) != current || seen[former] {
			continue
		}
		seen[former] = true
		result = append(result, former)
	}
	sort.Strings(result)
	return result
}

// IdentityConfig keeps path-derived draft identities stable through moves.
// It is an identity only; file IO must still use the current Config path.
func (p Profile) IdentityConfig() string {
	if p.origins != nil && p.origins.identityConfig != "" {
		return p.origins.identityConfig
	}
	return p.Config
}
