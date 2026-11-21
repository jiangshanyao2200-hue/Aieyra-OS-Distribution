// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Program/contract/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: ConvertLegacy
// Impact: python -B scripts/code-atlas.py show Program/contract/legacy.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package contract

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

// ConvertLegacy is a pure format adapter. The common package manager still
// validates files, identity, compatibility, origin and the user's grants.
// Legacy archives have no publisher signature: only explicit local import is
// possible. A broad legacy network flag never becomes a wildcard grant.
func ConvertLegacy(metadata, archive []byte) (map[string][]byte, error) {
	var m struct {
		Schema         string   `json:"schema"`
		ID             string   `json:"id"`
		Kind           string   `json:"kind"`
		Name           string   `json:"name"`
		Summary        string   `json:"summary"`
		Version        string   `json:"version"`
		License        string   `json:"license"`
		Permissions    []string `json:"permissions"`
		NetworkOrigins []string `json:"network_origins"`
		Artifact       struct {
			Name   string `json:"name"`
			Size   int    `json:"size"`
			SHA256 string `json:"sha256"`
		} `json:"artifact"`
	}
	if len(metadata) > 1<<20 || len(archive) > 64<<20 || !utf8.Valid(metadata) || !utf8.Valid(archive) {
		return nil, fmt.Errorf("legacy program exceeds limits or has invalid UTF-8")
	}
	if err := json.Unmarshal(metadata, &m); err != nil {
		return nil, err
	}
	hash := func(b []byte) string { v := sha256.Sum256(b); return hex.EncodeToString(v[:]) }
	if m.Schema != "aieyra-resource/1" || m.Kind != "program" || !regexp.MustCompile(`^[a-z][a-z0-9_-]{0,47}\.[a-z][a-z0-9_-]{0,63}$`).MatchString(m.ID) || !regexp.MustCompile(`^\d+\.\d+\.\d+$`).MatchString(m.Version) {
		return nil, fmt.Errorf("invalid legacy program identity")
	}
	if !strings.HasSuffix(m.Artifact.Name, ".aieyra") || path.Base(m.Artifact.Name) != m.Artifact.Name || m.Artifact.Size != len(archive) || m.Artifact.Size == 0 || hash(archive) != m.Artifact.SHA256 {
		return nil, fmt.Errorf("legacy program artifact hash or size mismatch")
	}
	var b struct {
		Schema string            `json:"schema"`
		Kind   string            `json:"kind"`
		Entry  string            `json:"entry"`
		Files  map[string]string `json:"files"`
	}
	if err := json.Unmarshal(archive, &b); err != nil {
		return nil, err
	}
	if b.Schema != "aieyra-bundle/1" || b.Kind != "program" || len(b.Files) == 0 || len(b.Files) > 256 || !strings.HasSuffix(b.Entry, ".html") {
		return nil, fmt.Errorf("invalid legacy HTML program")
	}
	if _, ok := b.Files[b.Entry]; !ok {
		return nil, fmt.Errorf("legacy HTML entry missing")
	}
	files := map[string][]byte{}
	seen := map[string]bool{}
	total := 0
	for name, text := range b.Files {
		key := strings.ToLower(name)
		if name == "" || len(name) > 240 || strings.ContainsAny(name, "\\:<>\"|?*\x00") || path.IsAbs(name) || path.Clean(name) != name || seen[key] || key == "manifest.json" || key == ".aieyra-legacy" || strings.HasPrefix(key, ".aieyra-legacy/") {
			return nil, fmt.Errorf("invalid or reserved legacy path: %s", name)
		}
		for _, c := range name {
			if c < 32 || c == 127 {
				return nil, fmt.Errorf("invalid legacy path")
			}
		}
		for _, part := range strings.Split(name, "/") {
			if part == "." || part == ".." || strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") || regexp.MustCompile(`(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)`).MatchString(part) {
				return nil, fmt.Errorf("invalid legacy path")
			}
		}
		if !regexp.MustCompile(`\.(html|css|js|mjs|json|svg|txt)$`).MatchString(name) {
			return nil, fmt.Errorf("unsupported legacy file: %s", name)
		}
		total += len(text)
		if total > 16<<20 {
			return nil, fmt.Errorf("legacy files exceed 16 MiB")
		}
		seen[key] = true
		files[name] = []byte(text)
	}
	permissions := []map[string]string{}
	network := false
	for _, p := range m.Permissions {
		if p != "network" || network {
			return nil, fmt.Errorf("legacy permission %q needs an explicit modern Program contract", p)
		}
		network = true
	}
	if network && len(m.NetworkOrigins) == 0 || !network && len(m.NetworkOrigins) > 0 || len(m.NetworkOrigins) > 128 {
		return nil, fmt.Errorf("legacy network permission requires explicit network_origins HTTPS origins")
	}
	sort.Strings(m.NetworkOrigins)
	prior := ""
	for _, origin := range m.NetworkOrigins {
		u, err := url.Parse(origin)
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || strings.Contains(u.Host, "*") || u.User != nil || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.String() != origin || origin == prior {
			return nil, fmt.Errorf("invalid legacy HTTPS origin")
		}
		prior = origin
		permissions = append(permissions, map[string]string{"capability": "network.https", "scope": origin, "reason": "旧程序声明的 HTTPS 服务"})
	}
	definition, _ := json.Marshal(Definition{Schema: "aieyra.program/1", Mode: "human", Desktop: Desktop{Entry: b.Entry}, Operations: []Operation{}})
	files[".aieyra-legacy/program.json"] = definition
	// Canonical metadata retains the original digest and permissions as public
	// provenance, without granting any trust to the resource center's author name.
	meta, _ := json.Marshal(m)
	files[".aieyra-legacy/resource.json"] = meta
	declared := map[string]any{}
	for name, data := range files {
		declared[name] = map[string]any{"sha256": hash(data), "size": len(data)}
	}
	if m.Name == "" {
		m.Name = m.ID
	}
	if m.Summary == "" {
		m.Summary = "从旧 .aieyra 程序转换；由共同包服务管理。"
	}
	if m.License == "" {
		m.License = "LicenseRef-Legacy-Unspecified"
	}
	manifest := map[string]any{"schema": "aieyra.mod/1", "id": m.ID, "kind": "program", "name": m.Name, "summary": m.Summary, "version": m.Version, "publisher": strings.Split(m.ID, ".")[0], "license": m.License, "contracts": map[string]string{"core": "^1.0.0", "program": "^1.0.0"}, "capabilities": []string{}, "clients": []string{"desktop"}, "platforms": []string{"any"}, "dependencies": []any{}, "entrypoints": map[string]string{"program": ".aieyra-legacy/program.json"}, "permissions": permissions, "data": map[string]any{"schema": 1, "uninstall": "retain"}, "files": declared}
	files["manifest.json"], _ = json.Marshal(manifest)
	return files, nil
}
