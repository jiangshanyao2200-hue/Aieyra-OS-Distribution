// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/modules/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: errRegistryBusy; lockRegistry; lockDefaultRegistry; storeObject; ensureDefaults; defaultUpdate
// Impact: python -B scripts/code-atlas.py show Core/modules/defaults.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package modules

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"
)

var errRegistryBusy = errors.New("package registry busy")

func (m *Manager) lockRegistry() (*os.File, error) {
	if !filepath.IsAbs(m.Root) {
		return nil, fmt.Errorf("package store must be absolute")
	}
	if err := ordinaryPath(m.Root); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(m.Root, 0700); err != nil {
		return nil, err
	}
	name := filepath.Join(m.Root, "registry.lock")
	if err := ordinaryPath(name); err != nil {
		return nil, err
	}
	lock, err := os.OpenFile(name, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = lockFile(lock); err != nil {
		lock.Close()
		return nil, fmt.Errorf("%w: %w", errRegistryBusy, err)
	}
	return lock, nil
}

// Independent startup readers may discover missing defaults together. Only
// this idempotent initialization waits briefly; user mutations still return
// contention immediately and retain their original request/revision semantics.
func (m *Manager) lockDefaultRegistry(ctx context.Context) (*os.File, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		lock, err := m.lockRegistry()
		if !errors.Is(err, errRegistryBusy) {
			return lock, err
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-tick.C:
		}
	}
}

// Both explicit imports and bundled defaults publish immutable objects through
// the same path, under the same registry lock. An interrupted publication can
// leave an unreferenced object; it cannot partially enable the default graph.
func (m *Manager) storeObject(ctx context.Context, pkg *Package) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := ordinaryPath(m.directory(pkg.Digest)); err != nil {
		return err
	}
	if _, err := os.Stat(m.directory(pkg.Digest)); err == nil {
		existing, err := Load(ctx, m.directory(pkg.Digest))
		if err != nil || existing.Digest != pkg.Digest {
			return fmt.Errorf("existing package object is corrupt")
		}
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	stage, err := os.MkdirTemp(m.Root, ".import-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	if err = pkg.write(stage); err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Join(m.Root, "objects"), 0700); err != nil {
		return err
	}
	return os.Rename(stage, m.directory(pkg.Digest))
}

// Register each compiled default at most once. Existing revisions, explicit
// disables/removals and grants are authoritative on every later launch. This
// provisions software only: no Agent instance, task or Program is started.
func (m *Manager) ensureDefaults(ctx context.Context) error {
	if m.DefaultPackages == nil {
		return nil
	}
	packages, err := m.DefaultPackages()
	if err != nil {
		return err
	}
	if len(packages) == 0 {
		return nil
	}
	seen := map[string]bool{}
	eligible := map[string]bool{}
	for _, pkg := range packages {
		if pkg == nil || seen[pkg.Manifest.ID] || !strings.HasPrefix(pkg.Manifest.ID, "aieyra.") || !contains(m.OfficialDigests[pkg.Manifest.ID], pkg.Digest) {
			return fmt.Errorf("default package must have a unique compiled trusted identity")
		}
		seen[pkg.Manifest.ID] = true
		eligible[pkg.Manifest.ID] = true
		// An unsupported client must not consume the one-time default marker.
		// A later capable client can still provision it; explicit imports retain
		// their existing state. Dependency readiness is checked on the full graph.
		for _, issue := range Check(pkg.Manifest, m.Host, nil).Issues {
			if issue.Code != "dependency" {
				eligible[pkg.Manifest.ID] = false
			}
		}
	}
	complete := func(s registry) bool {
		for id, supported := range eligible {
			if supported && !s.Defaults[id] {
				return false
			}
		}
		for _, pkg := range packages {
			if eligible[pkg.Manifest.ID] && m.defaultUpdate(s.Items[pkg.Manifest.ID], pkg) {
				return false
			}
		}
		return true
	}
	s, err := m.read()
	if err != nil || complete(s) {
		return err
	}
	lock, err := m.lockDefaultRegistry(ctx)
	if err != nil {
		return err
	}
	defer lock.Close()
	s, err = m.read()
	if err != nil || complete(s) {
		return err
	}
	// Defer a new default whose required bundled dependency needs another host.
	// A dependency explicitly disabled/removed by the user is handled below.
	// This decision depends on registry state and must use the locked snapshot.
	for changed := true; changed; {
		changed = false
		for _, pkg := range packages {
			if !eligible[pkg.Manifest.ID] {
				continue
			}
			for _, dep := range pkg.Manifest.Dependencies {
				_, exists := s.Items[dep.ID]
				if !dep.Optional && seen[dep.ID] && !eligible[dep.ID] && !s.Defaults[dep.ID] && !exists {
					eligible[pkg.Manifest.ID] = false
					changed = true
				}
			}
		}
	}
	if complete(s) {
		return nil
	}
	if s.Defaults == nil {
		s.Defaults = map[string]bool{}
	}
	added := map[string]*Package{}
	for _, source := range packages {
		id := source.Manifest.ID
		item := s.Items[id]
		if !eligible[id] || !m.defaultUpdate(item, source) {
			continue
		}
		// Verify the old immutable object without granting it execution trust in
		// this host. Only the newly compiled, fully checked payload will execute.
		old, err := Load(ctx, m.directory(item.Digest))
		if err != nil || old.Digest != item.Digest || !reflect.DeepEqual(old.Manifest, item.Manifest) {
			return fmt.Errorf("installed bundled program object is corrupt: %s", id)
		}
		pkg, err := FromFiles(source.Files)
		if err != nil || pkg.Digest != source.Digest || pkg.Manifest.ID != id {
			return fmt.Errorf("compiled default package bytes changed: %s", id)
		}
		key, err := pkg.Manifest.PublisherKey()
		if err != nil || key != item.PublisherKey || pkg.Manifest.Publisher != item.Manifest.Publisher ||
			pkg.Manifest.Data != item.Manifest.Data || !reflect.DeepEqual(pkg.Manifest.Dependencies, item.Manifest.Dependencies) ||
			!reflect.DeepEqual(pkg.Manifest.Capabilities, item.Manifest.Capabilities) || !m.check(pkg, s).Compatible {
			return fmt.Errorf("bundled program update requires explicit migration: %s", id)
		}
		if err := granted(pkg.Manifest, item.Grants); err != nil {
			return fmt.Errorf("bundled program update requires explicit grants: %s: %w", id, err)
		}
		if err := m.storeObject(ctx, pkg); err != nil {
			return err
		}
		previous := item.Release
		item.Release = Release{Manifest: pkg.Manifest, Digest: pkg.Digest, Directory: m.directory(pkg.Digest), Resolved: map[string]string{}}
		item.Previous = &previous
		item.InstalledAt = time.Now().UTC().Format(time.RFC3339Nano)
		s.Items[id] = item
	}
	for _, source := range packages {
		id := source.Manifest.ID
		if s.Defaults[id] || !eligible[id] {
			continue
		}
		s.Defaults[id] = true
		if _, exists := s.Items[id]; exists {
			continue
		}
		// Revalidate bytes instead of accepting mutable cached manifest fields.
		pkg, err := FromFiles(source.Files)
		if err != nil || pkg.Digest != source.Digest || pkg.Manifest.ID != id {
			return fmt.Errorf("compiled default package bytes changed: %s", id)
		}
		if m.ValidatePackage != nil {
			if err = m.ValidatePackage(pkg); err != nil {
				return err
			}
		}
		key, err := pkg.Manifest.PublisherKey()
		if err != nil {
			return err
		}
		if err = m.storeObject(ctx, pkg); err != nil {
			return err
		}
		s.Items[id] = Installed{Release: Release{Manifest: pkg.Manifest, Digest: pkg.Digest,
			Directory: m.directory(pkg.Digest), Resolved: map[string]string{}},
			Origin: "official", PublisherKey: key, Grants: append([]Permission(nil), pkg.Manifest.Permissions...),
			InstalledAt: time.Now().UTC().Format(time.RFC3339Nano)}
		added[id] = pkg
	}
	// Check the whole potential activation graph, including optional edges
	// between new defaults, before any activation is committed.
	probe := registry{Items: map[string]Installed{}}
	for id, item := range s.Items {
		if added[id] != nil {
			item.Enabled = true
		}
		probe.Items[id] = item
	}
	for _, pkg := range added {
		for _, issue := range m.check(pkg, probe).Issues {
			if issue.Code == "dependency_cycle" {
				return fmt.Errorf("default package dependency graph contains a cycle")
			}
		}
	}
	// Enable in dependency order. A previously disabled or removed dependency
	// leaves a new dependent disabled; it never restores the user's old choice.
	for changed := true; changed; {
		changed = false
		for id, pkg := range added {
			item := s.Items[id]
			if item.Enabled {
				continue
			}
			ready := true
			for _, dep := range item.Manifest.Dependencies {
				other, exists := s.Items[dep.ID]
				if dep.Optional && (!exists || !other.Enabled) {
					continue
				}
				match, err := Satisfies(other.Manifest.Version, dep.Version)
				if !exists || !other.Enabled || err != nil || !match {
					ready = false
				}
			}
			if ready && m.check(pkg, s).Compatible {
				item.Enabled = true
				s.Items[id] = item
				changed = true
			}
		}
	}
	if err = relock(s); err != nil {
		return err
	}
	for id, pkg := range added {
		if s.Items[id].Enabled && !m.check(pkg, s).Compatible {
			return fmt.Errorf("default package compatibility changed during activation: %s", id)
		}
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	s.Revision++
	return m.write(s)
}

func (m *Manager) defaultUpdate(item Installed, pkg *Package) bool {
	if !m.HostManagedDefaults[pkg.Manifest.ID] || item.Origin != "official" || item.Manifest.Kind != pkg.Manifest.Kind ||
		!contains([]string{"program", "tool", "toolbox"}, pkg.Manifest.Kind) || item.Digest == pkg.Digest || item.Digest == "" ||
		(item.Previous != nil && item.Previous.Digest == pkg.Digest) {
		return false
	}
	old, e1 := parseVersion(item.Manifest.Version)
	next, e2 := parseVersion(pkg.Manifest.Version)
	return e1 == nil && e2 == nil && compare(old, next) < 0
}
