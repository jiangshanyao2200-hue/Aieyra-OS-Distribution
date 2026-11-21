// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/modules/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Release; Installed; receipt; registry; Snapshot; Request; Result; Manager; New; read; write; directory; installedManifests; check; Inspect; OfficialCatalogError; Error; officialIdentity; Call; granted; healthyEnabled
// Impact: python -B scripts/code-atlas.py show Core/modules/manager.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package modules

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/aieyra/aieyra-os/CORE/internal/privatefile"
)

type Release struct {
	Manifest  Manifest          `json:"manifest"`
	Digest    string            `json:"digest"`
	Directory string            `json:"directory"`
	Resolved  map[string]string `json:"resolved"`
}
type Installed struct {
	Release
	Origin       string       `json:"origin"`
	PublisherKey string       `json:"publisher_key"`
	Enabled      bool         `json:"enabled"`
	Grants       []Permission `json:"grants"`
	Previous     *Release     `json:"previous,omitempty"`
	InstalledAt  string       `json:"installed_at"`
}
type receipt struct {
	Input    string  `json:"input"`
	Revision uint64  `json:"revision"`
	ID       string  `json:"id"`
	Digest   string  `json:"digest"`
	Action   string  `json:"action"`
	Result   *Result `json:"result,omitempty"`
}
type registry struct {
	Schema   int                  `json:"schema"`
	Revision uint64               `json:"revision"`
	Items    map[string]Installed `json:"items"`
	Receipts map[string]receipt   `json:"receipts"`
	Defaults map[string]bool      `json:"defaults,omitempty"`
}
type Snapshot struct {
	Revision uint64      `json:"revision"`
	Items    []Installed `json:"items"`
}
type Request struct {
	Action           string       `json:"action"`
	ID               string       `json:"id,omitempty"`
	Source           string       `json:"source,omitempty"`
	Origin           string       `json:"origin,omitempty"`
	RequestID        string       `json:"request_id,omitempty"`
	ExpectedRevision *uint64      `json:"expected_revision,omitempty"`
	ExpectedDigest   string       `json:"expected_digest,omitempty"`
	Grants           []Permission `json:"grants,omitempty"`
}
type Result struct {
	OK            bool        `json:"ok"`
	Origin        string      `json:"origin,omitempty"`
	Replayed      bool        `json:"replayed,omitempty"`
	Revision      uint64      `json:"revision"`
	Item          *Installed  `json:"item,omitempty"`
	Manifest      *Manifest   `json:"manifest,omitempty"`
	Digest        string      `json:"digest,omitempty"`
	Compatibility *Report     `json:"compatibility,omitempty"`
	Items         []Installed `json:"items"`
	Directory     string      `json:"directory,omitempty"`
	Dependencies  []Release   `json:"dependencies,omitempty"`
}
type Manager struct {
	Root            string
	Host            Host
	ValidatePackage func(*Package) error
	// Source conversion is supplied by the host. Stored objects always use Load.
	LoadSource func(context.Context, string) (*Package, error)
	// Host-owned, compiled trust catalog. No request or manifest can populate it.
	OfficialDigests map[string][]string
	// Compiled product defaults, never populated from an import or request.
	DefaultPackages func() ([]*Package, error)
	// Only host-coupled native programs follow the bundled implementation.
	// This is host configuration, never an importer-controlled manifest field.
	HostManagedDefaults map[string]bool
	// Product withdrawals hide execution and discovery without deleting user data.
	RetiredPackages map[string]bool
}

func New(root string, host Host) *Manager { return &Manager{Root: filepath.Clean(root), Host: host} }

func (m *Manager) read() (registry, error) {
	s := registry{Schema: 1, Items: map[string]Installed{}, Receipts: map[string]receipt{}}
	name := filepath.Join(m.Root, "installed.json")
	if err := ordinaryPath(name); err != nil {
		return s, err
	}
	f, err := privatefile.OpenSnapshot(name)
	if os.IsNotExist(err) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	defer f.Close()
	b, err := boundedRead(f, 16<<20)
	if err != nil {
		return s, err
	}
	if err = json.Unmarshal(b, &s); err != nil {
		return s, fmt.Errorf("package registry is corrupt: %w", err)
	}
	if (s.Schema != 1 && s.Schema != 2) || s.Items == nil || s.Receipts == nil || s.Schema == 2 && s.Defaults == nil {
		return s, fmt.Errorf("package registry schema is unsupported")
	}
	for id, registered := range s.Defaults {
		if !idPattern.MatchString(id) || !registered || s.Schema != 2 {
			return s, fmt.Errorf("package default registration is corrupt")
		}
	}
	for id, item := range s.Items {
		if id != item.Manifest.ID || !digestPattern.MatchString(item.Digest) {
			return s, fmt.Errorf("package registry identity is corrupt")
		}
		if err := validateRelease(item.Release); err != nil {
			return s, err
		}
		key, e := item.Manifest.PublisherKey()
		if e != nil || key != item.PublisherKey {
			return s, fmt.Errorf("registry publisher identity is corrupt")
		}
		item.Directory = m.directory(item.Digest)
		if item.Previous != nil {
			if err := validateRelease(*item.Previous); err != nil {
				return s, err
			}
			key, e := item.Previous.Manifest.PublisherKey()
			if e != nil || key != item.PublisherKey || item.Previous.Manifest.ID != id || item.Previous.Manifest.Kind != item.Manifest.Kind {
				return s, fmt.Errorf("previous package identity is corrupt")
			}
			item.Previous.Directory = m.directory(item.Previous.Digest)
		}
		s.Items[id] = item
	}
	return s, nil
}

func (m *Manager) write(s registry) error {
	if s.Defaults != nil {
		// Older writers must reject this schema rather than drop the markers and
		// silently reinstall a default the user deliberately removed.
		s.Schema = 2
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	if len(b) > 16<<20 {
		return fmt.Errorf("package registry exceeds 16 MiB; no change committed")
	}
	return privatefile.WriteSnapshot(filepath.Join(m.Root, "installed.json"), b)
}
func (m *Manager) directory(digest string) string { return filepath.Join(m.Root, "objects", digest) }
func installedManifests(s registry) map[string]Manifest {
	out := map[string]Manifest{}
	for id, item := range s.Items {
		out[id] = item.Manifest
	}
	return out
}

func (m *Manager) check(pkg *Package, s registry) Report {
	available := installedManifests(s)
	for _, dep := range pkg.Manifest.Dependencies {
		if dep.Optional && !s.Items[dep.ID].Enabled {
			delete(available, dep.ID)
		}
	}
	r := Check(pkg.Manifest, m.Host, available)
	if m.RetiredPackages[pkg.Manifest.ID] {
		r.Compatible = false
		r.Issues = append(r.Issues, Issue{"retired", pkg.Manifest.ID, "this program has been withdrawn from the product"})
	}
	if err := m.officialIdentity(pkg); err != nil {
		r.Compatible = false
		r.Issues = append(r.Issues, Issue{"official_identity", pkg.Manifest.ID, err.Error()})
	}
	if m.ValidatePackage != nil {
		if err := m.ValidatePackage(pkg); err != nil {
			r.Compatible = false
			r.Issues = append(r.Issues, Issue{"runtime_contract", pkg.Manifest.Kind, err.Error()})
		}
	}
	// Resolve the entire graph with the candidate substituted, and detect cycles.
	all := installedManifests(s)
	all[pkg.Manifest.ID] = pkg.Manifest
	visiting, done := map[string]bool{}, map[string]bool{}
	var walk func(string) bool
	walk = func(id string) bool {
		if visiting[id] {
			return false
		}
		if done[id] {
			return true
		}
		visiting[id] = true
		for _, d := range all[id].Dependencies {
			if d.Optional && !s.Items[d.ID].Enabled {
				continue
			}
			if _, ok := all[d.ID]; ok && !walk(d.ID) {
				return false
			}
		}
		visiting[id] = false
		done[id] = true
		return true
	}
	if !walk(pkg.Manifest.ID) {
		r.Compatible = false
		r.Issues = append(r.Issues, Issue{"dependency_cycle", pkg.Manifest.ID, "dependency graph contains a cycle"})
	}
	return r
}

func (m *Manager) Inspect(ctx context.Context, source string) (Result, error) {
	p, err := m.loadSource(ctx, source)
	if err != nil {
		return Result{}, err
	}
	if err = m.ensureDefaults(ctx); err != nil {
		return Result{}, err
	}
	s, err := m.read()
	if err != nil {
		return Result{}, err
	}
	r := m.check(p, s)
	origin := ""
	if strings.HasPrefix(p.Manifest.ID, "aieyra.") && m.officialIdentity(p) == nil {
		origin = "official"
	}
	return Result{OK: true, Origin: origin, Revision: s.Revision, Manifest: &p.Manifest, Digest: p.Digest, Compatibility: &r}, nil
}

type OfficialCatalogError struct{ ID, Version, Digest string }

func (e *OfficialCatalogError) Error() string {
	return fmt.Sprintf("official package is not in this host's trusted catalog: %s@%s (%s)", e.ID, e.Version, e.Digest)
}

func (m *Manager) officialIdentity(pkg *Package) error {
	if strings.HasPrefix(pkg.Manifest.ID, "aieyra.") && !contains(m.OfficialDigests[pkg.Manifest.ID], pkg.Digest) {
		return &OfficialCatalogError{pkg.Manifest.ID, pkg.Manifest.Version, pkg.Digest}
	}
	return nil
}

func (m *Manager) Call(ctx context.Context, p Request) (Result, error) {
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	if p.Action == "inspect" {
		return m.Inspect(ctx, p.Source)
	}
	if contains([]string{"list", "resolve", "install", "enable", "disable", "rollback", "remove"}, p.Action) {
		if err := m.ensureDefaults(ctx); err != nil {
			return Result{}, err
		}
	}
	if p.Action == "list" || p.Action == "resolve" {
		s, err := m.read()
		if err != nil {
			return Result{}, err
		}
		if p.Action == "resolve" {
			if m.RetiredPackages[p.ID] {
				return Result{}, fmt.Errorf("program has been withdrawn: %s", p.ID)
			}
			return m.resolve(ctx, s, p.ID)
		}
		items := make([]Installed, 0, len(s.Items))
		for _, v := range s.Items {
			if m.RetiredPackages[v.Manifest.ID] {
				continue
			}
			v.Directory = m.directory(v.Digest)
			items = append(items, v)
		}
		sort.Slice(items, func(i, j int) bool { return items[i].Manifest.ID < items[j].Manifest.ID })
		return Result{OK: true, Revision: s.Revision, Items: items}, nil
	}
	if !contains([]string{"install", "enable", "disable", "rollback", "remove"}, p.Action) {
		return Result{}, fmt.Errorf("unknown package action")
	}
	if len(p.RequestID) < 8 || len(p.RequestID) > 128 || p.ExpectedRevision == nil {
		return Result{}, fmt.Errorf("mutation needs stable request_id and expected_revision")
	}
	lock, err := m.lockRegistry()
	if err != nil {
		return Result{}, err
	}
	defer lock.Close()
	s, err := m.read()
	if err != nil {
		return Result{}, err
	}
	input, _ := json.Marshal(p)
	inputDigest := sum(input)
	if old, ok := s.Receipts[p.RequestID]; ok {
		if old.Input != inputDigest {
			return Result{}, fmt.Errorf("request_id belongs to another operation")
		}
		if old.Result == nil {
			return Result{}, fmt.Errorf("operation receipt is corrupt")
		}
		result := *old.Result
		result.Replayed = true
		return result, nil
	}
	if *p.ExpectedRevision != s.Revision {
		return Result{}, fmt.Errorf("package registry changed; inspect current revision before retrying")
	}
	if len(s.Receipts) >= 10000 {
		return Result{}, fmt.Errorf("package operation ledger is full; export and maintain it before new mutations")
	}
	item, exists := s.Items[p.ID]
	if p.Action == "install" {
		pkg, e := m.loadSource(ctx, p.Source)
		if e != nil {
			return Result{}, e
		}
		if p.ID != "" && p.ID != pkg.Manifest.ID {
			return Result{}, fmt.Errorf("package identity changed")
		}
		p.ID = pkg.Manifest.ID
		item, exists = s.Items[p.ID]
		if p.ExpectedDigest != pkg.Digest {
			return Result{}, fmt.Errorf("package changed since inspection")
		}
		if p.Origin != "local" && p.Origin != "third-party" {
			return Result{}, fmt.Errorf("import origin must be local or third-party; official origin cannot be self-declared")
		}
		if strings.HasPrefix(pkg.Manifest.ID, "aieyra.") {
			if err := m.officialIdentity(pkg); err != nil {
				return Result{}, err
			}
			p.Origin = "official"
		}
		key, e := pkg.Manifest.PublisherKey()
		if e != nil {
			return Result{}, e
		}
		if p.Origin == "third-party" && key == "unsigned" {
			return Result{}, fmt.Errorf("third-party packages require a publisher signature; local author mode is explicit")
		}
		if exists && (item.PublisherKey != key || item.Manifest.Publisher != pkg.Manifest.Publisher || item.Origin != p.Origin || item.Manifest.Kind != pkg.Manifest.Kind) {
			return Result{}, fmt.Errorf("package identity, kind, origin or publisher key changed")
		}
		if exists && item.Manifest.Version == pkg.Manifest.Version && item.Digest != pkg.Digest {
			return Result{}, fmt.Errorf("same version contains different bytes; publish a new version")
		}
		if exists && item.Manifest.Data.Schema != pkg.Manifest.Data.Schema {
			return Result{}, fmt.Errorf("data schema migration required before this update")
		}
		report := m.check(pkg, s)
		if !report.Compatible {
			return Result{OK: false, Revision: s.Revision, Manifest: &pkg.Manifest, Digest: pkg.Digest, Compatibility: &report}, nil
		}
		if exists && item.Enabled {
			kept := []Permission{}
			for _, want := range pkg.Manifest.Permissions {
				for _, prior := range item.Grants {
					if want.Capability == prior.Capability && want.Scope == prior.Scope {
						kept = append(kept, want)
						break
					}
				}
			}
			item.Grants = kept
			if err = granted(pkg.Manifest, item.Grants); err != nil {
				return Result{}, fmt.Errorf("update requests new permissions: disable, inspect and explicitly grant first: %w", err)
			}
		}
		next := Installed{Release: Release{Manifest: pkg.Manifest, Digest: pkg.Digest, Directory: m.directory(pkg.Digest), Resolved: map[string]string{}}, Origin: p.Origin, PublisherKey: key, Enabled: item.Enabled, Grants: item.Grants, InstalledAt: time.Now().UTC().Format(time.RFC3339Nano)}
		if exists {
			if item.Digest != pkg.Digest {
				old := item.Release
				next.Previous = &old
			} else {
				next.Previous = item.Previous
			}
		}
		s.Items[p.ID] = next
		if err = relock(s); err != nil {
			return Result{}, err
		}
		if e = m.storeObject(ctx, pkg); e != nil {
			return Result{}, e
		}
		item = next
	} else {
		if !exists || p.ExpectedDigest != item.Digest {
			return Result{}, fmt.Errorf("package missing or changed since inspection")
		}
		switch p.Action {
		case "enable":
			pkg, e := Load(ctx, m.directory(item.Digest))
			if e != nil {
				return Result{}, e
			}
			if pkg.Digest != item.Digest {
				return Result{}, fmt.Errorf("installed package changed")
			}
			report := m.check(pkg, s)
			if !report.Compatible {
				return Result{OK: false, Compatibility: &report}, nil
			}
			if err = granted(item.Manifest, p.Grants); err != nil {
				return Result{}, err
			}
			item.Grants = append([]Permission(nil), p.Grants...)
			item.Enabled = true
		case "disable":
			item.Enabled = false
		case "remove":
			if item.Enabled {
				return Result{}, fmt.Errorf("disable the package before removing it")
			}
			delete(s.Items, p.ID)
		case "rollback":
			if item.Previous == nil {
				return Result{}, fmt.Errorf("no previous version retained")
			}
			old := item.Release
			item.Release = *item.Previous
			item.Previous = &old
			pkg, e := Load(ctx, m.directory(item.Digest))
			if e != nil {
				return Result{}, e
			}
			if pkg.Digest != item.Digest {
				return Result{}, fmt.Errorf("previous version is corrupt")
			}
			report := m.check(pkg, s)
			if !report.Compatible {
				return Result{OK: false, Compatibility: &report}, nil
			}
			if item.Enabled {
				if err = granted(item.Manifest, item.Grants); err != nil {
					return Result{}, err
				}
			}
		}
		if p.Action != "remove" {
			s.Items[p.ID] = item
		}
		if err = relock(s); err != nil {
			return Result{}, err
		}
	}
	if err = ctx.Err(); err != nil {
		return Result{}, err
	}
	s.Revision++
	result := Result{OK: true, Revision: s.Revision, Digest: item.Digest}
	if p.Action != "remove" {
		item = s.Items[p.ID]
		result.Item = &item
	}
	s.Receipts[p.RequestID] = receipt{Input: inputDigest, Revision: s.Revision, ID: p.ID, Digest: item.Digest, Action: p.Action, Result: &result}
	if err = m.write(s); err != nil {
		return Result{}, err
	}
	return result, nil
}

func granted(m Manifest, grants []Permission) error {
	for _, want := range m.Permissions {
		found := false
		for _, got := range grants {
			if got.Capability == want.Capability && got.Scope == want.Scope {
				found = true
			}
		}
		if !found {
			return fmt.Errorf("permission not granted: %s (%s)", want.Capability, want.Scope)
		}
	}
	for _, got := range grants {
		found := false
		for _, want := range m.Permissions {
			if got.Capability == want.Capability && got.Scope == want.Scope {
				found = true
			}
		}
		if !found {
			return fmt.Errorf("grant was not requested by this package")
		}
	}
	return nil
}

func healthyEnabled(s registry) error {
	for _, item := range s.Items {
		if !item.Enabled {
			continue
		}
		for _, d := range item.Manifest.Dependencies {
			other, ok := s.Items[d.ID]
			if (!ok || !other.Enabled) && d.Optional {
				continue
			}
			if !ok || !other.Enabled {
				return fmt.Errorf("enabled %s requires enabled %s", item.Manifest.ID, d.ID)
			}
			match, e := Satisfies(other.Manifest.Version, d.Version)
			if e != nil || !match {
				return fmt.Errorf("update would break dependency %s -> %s", item.Manifest.ID, d.ID)
			}
		}
	}
	return nil
}
