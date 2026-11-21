// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/modules/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: Resolution; ResolveSnapshot; validateRelease; relock; resolve
// Impact: python -B scripts/code-atlas.py show Core/modules/snapshot.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package modules

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
)

// ResolveSnapshot admits a bounded group against one registry revision. Each
// object still uses the normal file, trust, grant and dependency checks. A
// disabled or corrupt object has an explicit error rather than an enabled
// metadata-only fallback; a bad registry rejects the entire snapshot.
type Resolution struct {
	Result Result
	Error  error
}

func (m *Manager) ResolveSnapshot(ctx context.Context, ids []string) (map[string]Resolution, error) {
	if len(ids) > 64 {
		return nil, fmt.Errorf("too many package identities")
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if !idPattern.MatchString(id) || seen[id] {
			return nil, fmt.Errorf("invalid or duplicate package identity")
		}
		seen[id] = true
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := m.ensureDefaults(ctx); err != nil {
		return nil, err
	}
	s, err := m.read()
	if err != nil {
		return nil, err
	}
	out := make(map[string]Resolution, len(ids))
	for _, id := range ids {
		result, err := m.resolve(ctx, s, id)
		out[id] = Resolution{result, err}
	}
	return out, nil
}

func validateRelease(r Release) error {
	if !digestPattern.MatchString(r.Digest) {
		return fmt.Errorf("invalid package identity")
	}
	if err := r.Manifest.Validate(); err != nil {
		return err
	}
	raw, err := json.Marshal(r.Manifest)
	if err != nil || sum(raw) != r.Digest {
		return fmt.Errorf("registry manifest differs from its content identity")
	}
	for id, digest := range r.Resolved {
		if !idPattern.MatchString(id) || !digestPattern.MatchString(digest) {
			return fmt.Errorf("invalid dependency lock")
		}
	}
	return nil
}

// Every committed mutation recalculates the active dependency graph in the same
// registry transaction. A running consumer retains its previously resolved
// immutable payloads; newly opened consumers receive this new graph.
func relock(s registry) error {
	if err := healthyEnabled(s); err != nil {
		return err
	}
	for id, item := range s.Items {
		item.Resolved = map[string]string{}
		for _, dep := range item.Manifest.Dependencies {
			other, ok := s.Items[dep.ID]
			if !ok || !other.Enabled {
				continue
			}
			match, err := Satisfies(other.Manifest.Version, dep.Version)
			if err == nil && match {
				item.Resolved[dep.ID] = other.Digest
			}
		}
		s.Items[id] = item
	}
	return nil
}

func (m *Manager) resolve(ctx context.Context, s registry, id string) (Result, error) {
	item, ok := s.Items[id]
	if !ok || !item.Enabled {
		return Result{}, fmt.Errorf("package is not enabled")
	}
	if err := healthyEnabled(s); err != nil {
		return Result{}, err
	}
	visiting, seen := map[string]bool{}, map[string]bool{}
	dependencies := []Release{}
	var walk func(string) error
	walk = func(current string) error {
		if visiting[current] {
			return fmt.Errorf("dependency cycle")
		}
		if seen[current] {
			return nil
		}
		visiting[current] = true
		i, ok := s.Items[current]
		if !ok || !i.Enabled {
			return fmt.Errorf("dependency is not enabled: %s", current)
		}
		p, err := Load(ctx, m.directory(i.Digest))
		if err != nil {
			return err
		}
		if err := m.officialIdentity(p); err != nil {
			return err
		}
		if m.ValidatePackage != nil {
			if err := m.ValidatePackage(p); err != nil {
				return err
			}
		}
		if p.Digest != i.Digest {
			return fmt.Errorf("installed package changed: %s", current)
		}
		if err = granted(p.Manifest, i.Grants); err != nil {
			return err
		}
		// Optional disabled packages do not participate in this activation.
		active := map[string]Manifest{}
		for key, value := range s.Items {
			if value.Enabled {
				active[key] = value.Manifest
			}
		}
		report := Check(p.Manifest, m.Host, active)
		if !report.Compatible {
			return fmt.Errorf("package compatibility changed: %s: %v", current, report.Issues)
		}
		if len(report.Resolved) != len(i.Resolved) {
			return fmt.Errorf("dependency lock changed: %s", current)
		}
		for dependency := range report.Resolved {
			if i.Resolved[dependency] != s.Items[dependency].Digest {
				return fmt.Errorf("dependency lock changed: %s", dependency)
			}
			if err := walk(dependency); err != nil {
				return err
			}
		}
		visiting[current], seen[current] = false, true
		if current != id {
			dependencies = append(dependencies, i.Release)
		}
		return nil
	}
	if err := walk(id); err != nil {
		return Result{}, err
	}
	sort.Slice(dependencies, func(i, j int) bool { return dependencies[i].Manifest.ID < dependencies[j].Manifest.ID })
	return Result{OK: true, Revision: s.Revision, Item: &item, Directory: item.Directory, Dependencies: dependencies}, nil
}
