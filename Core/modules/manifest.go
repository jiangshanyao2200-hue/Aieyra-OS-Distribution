// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/modules/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Schema; MaxFiles; MaxBytes; MaxManifest; idPattern; digestPattern; reservedName; File; Dependency; Permission; View; DataContract; Signature; Manifest; FileName; DecodeManifest; Validate; contains; sum; signingBytes; PublisherKey; Host; Issue; Report; Check
// Impact: python -B scripts/code-atlas.py show Core/modules/manifest.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package modules

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

const Schema = "aieyra.mod/1"
const MaxFiles = 2048
const MaxBytes int64 = 64 << 20
const MaxManifest int64 = 1 << 20

var idPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,47}(?:\.[a-z][a-z0-9_-]{0,63})+$`)
var digestPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var reservedName = regexp.MustCompile(`(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)`)

type File struct {
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}
type Dependency struct {
	ID       string `json:"id"`
	Version  string `json:"version"`
	Optional bool   `json:"optional,omitempty"`
}
type Permission struct {
	Capability string `json:"capability"`
	Scope      string `json:"scope"`
	Reason     string `json:"reason"`
}
type View struct {
	Contract string `json:"contract"`
	Renderer string `json:"renderer"`
	Entry    string `json:"entry,omitempty"`
}
type DataContract struct {
	Schema    int    `json:"schema"`
	Uninstall string `json:"uninstall"`
}
type Signature struct {
	PublicKey string `json:"public_key"`
	Value     string `json:"value"`
}
type Manifest struct {
	Schema       string            `json:"schema"`
	ID           string            `json:"id"`
	Kind         string            `json:"kind"`
	Name         string            `json:"name"`
	Summary      string            `json:"summary"`
	Version      string            `json:"version"`
	Publisher    string            `json:"publisher"`
	License      string            `json:"license"`
	Contracts    map[string]string `json:"contracts"`
	Capabilities []string          `json:"capabilities"`
	Clients      []string          `json:"clients"`
	Platforms    []string          `json:"platforms"`
	Dependencies []Dependency      `json:"dependencies"`
	Entrypoints  map[string]string `json:"entrypoints"`
	Permissions  []Permission      `json:"permissions"`
	Presentation map[string]View   `json:"presentation,omitempty"`
	Data         DataContract      `json:"data"`
	Files        map[string]File   `json:"files"`
	Signature    *Signature        `json:"signature,omitempty"`
}

func FileName(s string) error {
	if s == "" || len(s) > 240 || !utf8.ValidString(s) || strings.ContainsAny(s, "\\:<>\"|?*\x00") || path.IsAbs(s) || path.Clean(s) != s {
		return fmt.Errorf("invalid package path: %q", s)
	}
	for _, c := range s {
		if c < 32 || c == 127 {
			return fmt.Errorf("control character in package path")
		}
	}
	for _, p := range strings.Split(s, "/") {
		if p == "" || p == "." || p == ".." || strings.HasSuffix(p, ".") || strings.HasSuffix(p, " ") || reservedName.MatchString(p) {
			return fmt.Errorf("invalid package path: %q", s)
		}
	}
	return nil
}

func DecodeManifest(raw []byte) (Manifest, error) {
	var m Manifest
	if int64(len(raw)) > MaxManifest {
		return m, fmt.Errorf("manifest exceeds 1 MiB")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&m); err != nil {
		return m, err
	}
	if d.Decode(new(any)) != io.EOF {
		return m, fmt.Errorf("manifest contains trailing content")
	}
	return m, m.Validate()
}

func (m Manifest) Validate() error {
	if len(m.Permissions) > 128 || len(m.Capabilities) > 128 || len(m.Dependencies) > 256 || len(m.Contracts) > 64 {
		return fmt.Errorf("package declaration count exceeds limits")
	}
	if m.Schema != Schema || !idPattern.MatchString(m.ID) || !strings.HasPrefix(m.ID, m.Publisher+".") || !regexp.MustCompile(`^[a-z][a-z0-9_-]{0,47}$`).MatchString(m.Publisher) {
		return fmt.Errorf("invalid package schema, identity or publisher namespace")
	}
	if _, err := parseVersion(m.Version); err != nil {
		return err
	}
	if m.Name == "" || len(m.Name) > 160 || m.Summary == "" || len(m.Summary) > 4096 || m.License == "" || len(m.License) > 128 {
		return fmt.Errorf("package name, summary and license are required")
	}
	entry := map[string]string{"halo": "halo", "theme": "theme", "tool": "tool", "toolbox": "tool", "workbox": "workflow", "program": "program", "agent": "agent", "api": "adapter", "context": "context"}[m.Kind]
	if entry == "" || m.Entrypoints[entry] == "" || m.Contracts["core"] == "" {
		return fmt.Errorf("unsupported package kind or missing primary entry/core contract")
	}
	for name, constraint := range m.Contracts {
		if name == "" {
			return fmt.Errorf("empty contract")
		}
		if _, err := Satisfies("1.0.0", constraint); err != nil {
			return err
		}
	}
	if len(m.Clients) == 0 || len(m.Platforms) == 0 {
		return fmt.Errorf("clients and platforms must be explicit")
	}
	seen := map[string]bool{}
	for _, c := range m.Clients {
		if !contains([]string{"desktop", "cli", "mobile"}, c) || seen[c] {
			return fmt.Errorf("invalid or duplicate client: %s", c)
		}
		seen[c] = true
	}
	for _, c := range m.Platforms {
		if c != "any" && !regexp.MustCompile(`^(windows|linux|darwin|android|ios)/(amd64|arm64)$`).MatchString(c) {
			return fmt.Errorf("invalid platform: %s", c)
		}
	}
	if m.Data.Schema < 1 || m.Data.Uninstall != "retain" {
		return fmt.Errorf("data schema and explicit retain-on-uninstall policy are required")
	}
	seen = map[string]bool{}
	for _, dep := range m.Dependencies {
		if !idPattern.MatchString(dep.ID) || dep.ID == m.ID || seen[dep.ID] {
			return fmt.Errorf("invalid, self or duplicate dependency: %s", dep.ID)
		}
		seen[dep.ID] = true
		if _, err := Satisfies("1.0.0", dep.Version); err != nil {
			return err
		}
	}
	seen = map[string]bool{}
	for _, p := range m.Permissions {
		key := p.Capability + "\x00" + p.Scope
		if p.Capability == "" || p.Scope == "" || p.Reason == "" || seen[key] {
			return fmt.Errorf("permissions require capability, scope and reason; duplicates are forbidden")
		}
		seen[key] = true
	}
	if len(m.Files) == 0 || len(m.Files) > MaxFiles {
		return fmt.Errorf("invalid file count")
	}
	seen = map[string]bool{}
	var total int64
	for name, f := range m.Files {
		if err := FileName(name); err != nil {
			return err
		}
		key := strings.ToLower(name)
		if key == "manifest.json" || seen[key] || !digestPattern.MatchString(f.SHA256) || f.Size < 0 || f.Size > MaxBytes {
			return fmt.Errorf("invalid file or case collision: %s", name)
		}
		seen[key] = true
		total += f.Size
		if total > MaxBytes {
			return fmt.Errorf("package exceeds 64 MiB")
		}
	}
	for _, name := range m.Entrypoints {
		if _, ok := m.Files[name]; !ok {
			return fmt.Errorf("entry file not in manifest: %s", name)
		}
	}
	if contains([]string{"tool", "toolbox", "workbox"}, m.Kind) {
		for _, client := range []string{"desktop", "cli"} {
			if _, ok := m.Presentation[client]; !ok {
				return fmt.Errorf("tool package must include %s presentation", client)
			}
		}
		if m.Entrypoints["manual"] == "" {
			return fmt.Errorf("tool package must include manual entry")
		}
	}
	for client, v := range m.Presentation {
		if !contains([]string{"desktop", "cli", "mobile"}, client) || v.Renderer == "" {
			return fmt.Errorf("invalid presentation")
		}
		if _, err := parseVersion(v.Contract); err != nil {
			return err
		}
		if v.Entry != "" {
			if _, ok := m.Files[v.Entry]; !ok {
				return fmt.Errorf("presentation file missing: %s", v.Entry)
			}
		}
	}
	return nil
}

func contains(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}
func sum(raw []byte) string { h := sha256.Sum256(raw); return hex.EncodeToString(h[:]) }
func (m Manifest) signingBytes() []byte {
	m.Signature = nil
	raw, _ := json.Marshal(m)
	var value any
	_ = json.Unmarshal(raw, &value)
	b, _ := json.Marshal(value)
	return b
}

// PublisherKey identifies a signing key, not an externally verified person.
func (m Manifest) PublisherKey() (string, error) {
	if m.Signature == nil {
		return "unsigned", nil
	}
	key, e := base64.StdEncoding.DecodeString(m.Signature.PublicKey)
	if e != nil || len(key) != ed25519.PublicKeySize {
		return "", fmt.Errorf("invalid publisher signing key")
	}
	sig, e := base64.StdEncoding.DecodeString(m.Signature.Value)
	if e != nil || !ed25519.Verify(key, m.signingBytes(), sig) {
		return "", fmt.Errorf("invalid package signature")
	}
	return "ed25519:" + sum(key), nil
}

type Host struct {
	Client       string            `json:"client"`
	Platform     string            `json:"platform"`
	Contracts    map[string]string `json:"contracts"`
	Capabilities []string          `json:"capabilities"`
	Kinds        []string          `json:"kinds"`
}
type Issue struct {
	Code    string `json:"code"`
	Subject string `json:"subject"`
	Detail  string `json:"detail"`
}
type Report struct {
	Compatible   bool              `json:"compatible"`
	Issues       []Issue           `json:"issues"`
	Resolved     map[string]string `json:"resolved"`
	PublisherKey string            `json:"publisher_key"`
}

func Check(m Manifest, host Host, installed map[string]Manifest) Report {
	r := Report{Compatible: true, Issues: []Issue{}, Resolved: map[string]string{}}
	add := func(code, subject, detail string) {
		r.Compatible = false
		r.Issues = append(r.Issues, Issue{code, subject, detail})
	}
	if err := m.Validate(); err != nil {
		add("manifest", m.ID, err.Error())
		return r
	}
	var err error
	r.PublisherKey, err = m.PublisherKey()
	if err != nil {
		add("signature", m.ID, err.Error())
	}
	if !contains(m.Clients, host.Client) {
		add("client", host.Client, "package has no entry for this client")
	}
	if !contains(m.Platforms, "any") && !contains(m.Platforms, host.Platform) {
		add("platform", host.Platform, "platform is unsupported")
	}
	if !contains(host.Kinds, m.Kind) {
		add("runtime", m.Kind, "this host has no runtime for this package kind")
	}
	keys := make([]string, 0, len(m.Contracts))
	for k := range m.Contracts {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, name := range keys {
		v, ok := host.Contracts[name]
		if !ok {
			add("contract", name, "host contract unavailable")
			continue
		}
		matches, e := Satisfies(v, m.Contracts[name])
		if e != nil || !matches {
			add("contract", name, "host version "+v+" does not satisfy "+m.Contracts[name])
		}
	}
	for _, cap := range m.Capabilities {
		if !contains(host.Capabilities, cap) {
			add("capability", cap, "host capability unavailable")
		}
	}
	for _, p := range m.Permissions {
		if !contains(host.Capabilities, p.Capability) || !validScope(p) {
			add("permission_capability", p.Capability, "host cannot grant this capability")
		}
	}
	for _, d := range m.Dependencies {
		other, ok := installed[d.ID]
		if !ok {
			if !d.Optional {
				add("dependency", d.ID, "required package not installed")
			}
			continue
		}
		match, e := Satisfies(other.Version, d.Version)
		if e != nil || !match {
			add("dependency", d.ID, "installed version "+other.Version+" does not satisfy "+d.Version)
		} else {
			r.Resolved[d.ID] = other.Version
		}
	}
	return r
}
