// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/modules/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: LoadObject
// Impact: python -B scripts/code-atlas.py show Core/modules/object.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package modules

import (
	"context"
	"fmt"
)

// LoadObject reads one immutable installed release, including disabled and old
// pinned releases. It grants no execution capability and never uses a caller's
// directory or the registry's current version as a substitute.
func (m *Manager) LoadObject(ctx context.Context, id, digest string) (*Package, error) {
	if !idPattern.MatchString(id) || !digestPattern.MatchString(digest) {
		return nil, fmt.Errorf("complete package identity is required")
	}
	p, err := Load(ctx, m.directory(digest))
	if err != nil {
		return nil, fmt.Errorf("original package source unavailable: %w", err)
	}
	if p.Digest != digest || p.Manifest.ID != id {
		return nil, fmt.Errorf("original package identity mismatch")
	}
	return p, nil
}
