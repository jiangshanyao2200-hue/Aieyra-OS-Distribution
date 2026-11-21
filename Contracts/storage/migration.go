// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/storage/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: MigrationReceiptFile; Migration; ReadMigration; ResolveConfig
// Impact: python -B scripts/code-atlas.py show Contracts/storage/migration.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package storage

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const MigrationReceiptFile = ".aieyra-migration-receipt.json"

// Migration records contain identities and a manifest digest, never payloads.
// The source barrier persists after completion to prevent accidental reuse.
type Migration struct {
	Schema       int    `json:"schema"`
	ID           string `json:"id"`
	State        string `json:"state"`
	SourceConfig string `json:"source_config"`
	SourceRoot   string `json:"source_root"`
	Destination  string `json:"destination"`
	ProfileID    string `json:"profile_id"`
	InventorySHA string `json:"inventory_sha,omitempty"`
}

func ReadMigration(root, name string) (*Migration, error) {
	if name != MigrationBarrier && name != MigrationReceiptFile {
		return nil, fmt.Errorf("invalid migration metadata name")
	}
	file := filepath.Join(root, name)
	st, err := os.Lstat(file)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	real, e := filepath.EvalSymlinks(root)
	if e != nil || pathKey(real) != pathKey(root) || !st.Mode().IsRegular() || st.Size() > 8192 {
		return nil, fmt.Errorf("invalid migration metadata")
	}
	f, err := os.Open(file)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(st, opened) {
		return nil, fmt.Errorf("migration metadata changed")
	}
	b, err := io.ReadAll(io.LimitReader(f, 8193))
	if err != nil {
		return nil, err
	}
	var m Migration
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if len(b) > 8192 || d.Decode(&m) != nil || d.Decode(new(any)) != io.EOF || m.Schema != 1 || !profileID.MatchString(m.ID) || !profileID.MatchString(m.ProfileID) || (m.State != "copying" && m.State != "complete") || !filepath.IsAbs(m.SourceConfig) || !filepath.IsAbs(m.SourceRoot) || !filepath.IsAbs(m.Destination) || pathKey(m.SourceRoot) == pathKey(m.Destination) || (m.State == "complete" && len(m.InventorySHA) != 64) {
		return nil, fmt.Errorf("damaged migration metadata; originals retained")
	}
	return &m, nil
}

// ResolveConfig follows only a completed move whose destination independently
// confirms the transaction and profile. It never redirects an admitted service.
func ResolveConfig(config string) (string, error) {
	current, err := filepath.Abs(config)
	if err != nil {
		return "", err
	}
	seen := map[string]bool{}
	for n := 0; n < 16; n++ {
		if seen[pathKey(current)] {
			return "", fmt.Errorf("migration redirect cycle")
		}
		seen[pathKey(current)] = true
		p, err := Inspect(current)
		if err != nil {
			return "", err
		}
		m, err := ReadMigration(p.Root, MigrationBarrier)
		if err != nil {
			return "", err
		}
		if m == nil {
			return current, nil
		}
		if m.State != "complete" || pathKey(m.SourceConfig) != pathKey(current) || pathKey(m.SourceRoot) != pathKey(p.Root) {
			return "", fmt.Errorf("profile migration is incomplete; resume profile migrate")
		}
		receipt, err := ReadMigration(m.Destination, MigrationReceiptFile)
		if err != nil {
			return "", err
		}
		marker, err := ReadMarker(m.Destination)
		if err != nil {
			return "", err
		}
		if receipt == nil || *receipt != *m || marker == nil || marker.State != "ready" || marker.ID != m.ProfileID {
			return "", fmt.Errorf("migration destination does not confirm the completed transfer")
		}
		current = filepath.Join(m.Destination, filepath.FromSlash(marker.Config))
	}
	return "", fmt.Errorf("too many migration redirects")
}
