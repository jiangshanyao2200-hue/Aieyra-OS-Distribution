// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkboxSessionSnapshotBindsRecordToDirectory; TestSessionDirectoryRejectsInvalidTreeBeforeRecoveryWrites
// Impact: python -B scripts/code-atlas.py show Core/session_records_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorkboxSessionSnapshotBindsRecordToDirectory(t *testing.T) {
	m, dir := matrixTestManager(t, nil)
	t.Setenv("AIEYRA_ROOT", mustProjectRoot(t))
	identity := installWorkflowSample(t, m, "workbox-images")
	i := workflowTestCall(t, m, context.Background(), identity, map[string]any{"action": "create", "request_id": "bound-directory", "workdir": dir, "input": map[string]any{"prompt": "fixture", "edit_prompt": "edit", "profile_id": "", "size": "1536x1024"}})
	source, err := m.workflowStore(m.owner, i.ID)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := source.read()
	if err != nil {
		t.Fatal(err)
	}
	for _, target := range []struct{ owner, id string }{{m.owner, "w-" + strings.Repeat("f", 32)}, {"other-owner", i.ID}} {
		store, err := m.workflowStore(target.owner, target.id)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.MkdirAll(store.dir, 0700); err != nil {
			t.Fatal(err)
		}
		file := filepath.Join(store.dir, "state.json")
		original := rawJSON(doc)
		if err = os.WriteFile(file, original, 0600); err != nil {
			t.Fatal(err)
		}
		if _, err = store.read(); err == nil {
			t.Fatal("foreign workflow read")
		}
		if _, err = store.summary(); err == nil {
			t.Fatal("foreign workflow listed")
		}
		if err = store.write(doc); err == nil {
			t.Fatal("foreign workflow written")
		}
		if got, _ := os.ReadFile(file); !bytes.Equal(got, original) {
			t.Fatal("foreign record changed")
		}
	}
}

func TestSessionDirectoryRejectsInvalidTreeBeforeRecoveryWrites(t *testing.T) {
	for _, broken := range []string{"parent", "json"} {
		t.Run(broken, func(t *testing.T) {
			m, _ := matrixTestManager(t, nil)
			config, owner, dir := m.config, m.owner, m.dir
			m.Close()
			first, last := strings.Repeat("1", 32), strings.Repeat("f", 32)
			original := rawJSON(AgentRecord{ID: first, Parent: owner, Depth: 1, State: "running", Generation: 1})
			other := rawJSON(AgentRecord{ID: last, Parent: strings.Repeat("e", 32), Depth: 2, State: "waiting_user"})
			if broken == "json" {
				other = []byte(`{"id":`)
			}
			for id, data := range map[string][]byte{first: original, last: other} {
				if err := os.WriteFile(filepath.Join(dir, id+".json"), data, 0600); err != nil {
					t.Fatal(err)
				}
			}
			next, err := newAgentManager(config, owner, nil, dir)
			if err == nil {
				next.Close()
				t.Fatal("invalid directory was recovered")
			}
			for id, want := range map[string][]byte{first: original, last: other} {
				got, err := os.ReadFile(filepath.Join(dir, id+".json"))
				if err != nil || !bytes.Equal(got, want) {
					t.Errorf("failed recovery rewrote %s: %v", id, err)
				}
			}
		})
	}
}
