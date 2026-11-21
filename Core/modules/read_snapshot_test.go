// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/modules/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestRegistryReaderDoesNotBlockAtomicActivation
// Impact: python -B scripts/code-atlas.py show Core/modules/read_snapshot_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package modules

import (
	"encoding/json"
	"io"
	"path/filepath"
	"testing"

	"github.com/aieyra/aieyra-os/CORE/internal/privatefile"
)

func TestRegistryReaderDoesNotBlockAtomicActivation(t *testing.T) {
	m := New(t.TempDir(), testHost())
	installed := install(t, m, fixture(t, "test.snapshot", "1.0.0", nil))
	reader, err := privatefile.OpenSnapshot(filepath.Join(m.Root, "installed.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	// Hold exactly the handle used by list/resolve while a second request
	// commits. Readers must see their original complete snapshot, and cannot
	// prevent a writer from replacing the directory entry on Windows.
	enabled := mutate(t, m, "enable", *installed.Item)
	if !enabled.Item.Enabled || enabled.Revision != installed.Revision+1 {
		t.Fatal("activation did not commit", enabled)
	}
	raw, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	var previous registry
	if err = json.Unmarshal(raw, &previous); err != nil {
		t.Fatal(err)
	}
	if previous.Revision != installed.Revision || previous.Items["test.snapshot"].Enabled {
		t.Fatal("reader snapshot changed underneath it", previous)
	}
	current := checked(t, m, Request{Action: "list"})
	if current.Revision != enabled.Revision || !current.Items[0].Enabled {
		t.Fatal("new readers did not see the committed activation", current)
	}
}
