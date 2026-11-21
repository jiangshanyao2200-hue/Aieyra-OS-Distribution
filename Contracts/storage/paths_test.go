// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/storage/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestPrivateAreasResolveWithoutCreatingOrMovingData
// Impact: python -B scripts/code-atlas.py show Contracts/storage/paths_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package storage

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPrivateAreasResolveWithoutCreatingOrMovingData(t *testing.T) {
	base := filepath.Join(t.TempDir(), "absent-private-root")
	r := Resolve(base)
	if r.Sessions != filepath.Join(base, "sessions") || r.Memory != filepath.Join(base, "memory") || r.Attachments != filepath.Join(base, "runtime", "attachments") || r.Packages != filepath.Join(base, "Packages") {
		t.Fatal("existing data roots changed", r)
	}
	if _, err := os.Stat(base); !os.IsNotExist(err) {
		t.Fatal("path resolution created private data", err)
	}
	if _, err := Root(base, "../outside"); err == nil {
		t.Fatal("unowned area accepted")
	}
	owners := map[string]Mount{}
	for _, m := range Describe(base) {
		owners[m.ID] = m
	}
	if owners["memory"].Cleanup != "explicit-forget" || owners["attachments"].Cleanup != "shared-reference" || owners["runtime"].Cleanup != "owner-release" {
		t.Fatal("shared resources treated as session-owned")
	}
	rows := Describe(base)
	rows[0].Owner = "changed"
	if Describe(base)[0].Owner == "changed" {
		t.Fatal("caller modified global ownership")
	}
}
