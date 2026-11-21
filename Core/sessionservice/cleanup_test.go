// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/sessionservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestCleanupResumesCompletedStepsAndPreservesUnownedFiles; TestCleanupRejectsInconsistentCompletedReceipt
// Impact: python -B scripts/code-atlas.py show Core/sessionservice/cleanup_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package sessionservice

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestCleanupResumesCompletedStepsAndPreservesUnownedFiles(t *testing.T) {
	dir := t.TempDir()
	id := "11111111111111111111111111111111"
	put := func(name string) {
		t.Helper()
		p := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("private fixture"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	put("archive")
	put("blocked/child")
	put("owner")
	put("other-session")
	targets := []Target{{ID: "archive", Path: "archive"}, {ID: "blocked", Path: "blocked"}, {ID: "owner", Path: "owner"}}
	r, err := Cleanup(context.Background(), dir, id, targets, nil)
	if err == nil || r.State != "failed" || r.Steps[0].State != "completed" || r.Steps[1].State != "failed" || r.Steps[2].State != "pending" {
		t.Fatal("partial cleanup lost", r, err)
	}
	if _, err = os.Stat(filepath.Join(dir, "owner")); err != nil {
		t.Fatal("owner removed before sidecars", err)
	}
	restored, err := ReadCleanup(dir, id)
	if err != nil || restored.Steps[0].State != "completed" {
		t.Fatal("durable partial receipt lost", restored, err)
	}
	if err = os.RemoveAll(filepath.Join(dir, "blocked")); err != nil {
		t.Fatal(err)
	}
	r, err = Cleanup(context.Background(), dir, id, targets, nil)
	if err != nil || r.State != "completed" {
		t.Fatal("retry failed", r, err)
	}
	if _, err = os.Stat(filepath.Join(dir, "other-session")); err != nil {
		t.Fatal("unowned file removed", err)
	}
	// Simulate removal of the final owner succeeding just before the receipt write.
	r.State = "pending"
	r.Steps[len(r.Steps)-1].State = "pending"
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err = saveCleanup(root, r); err != nil {
		t.Fatal(err)
	}
	root.Close()
	r, err = Cleanup(context.Background(), dir, id, targets, nil)
	if err != nil || r.State != "completed" {
		t.Fatal("missing owner prevents final receipt recovery", r, err)
	}
	if _, err = Cleanup(context.Background(), dir, id, []Target{{ID: "different", Path: "other-session"}}, nil); err == nil {
		t.Fatal("changed cleanup plan accepted")
	}
	if _, err = Cleanup(context.Background(), dir, id, []Target{{ID: "escape", Path: "../outside"}}, nil); err == nil {
		t.Fatal("escaping target accepted")
	}
}
func TestCleanupRejectsInconsistentCompletedReceipt(t *testing.T) {
	dir := t.TempDir()
	id := "22222222222222222222222222222222"
	targets := []Target{{ID: "one", Path: "one"}}
	r, err := Cleanup(context.Background(), dir, id, targets, nil)
	if err != nil {
		t.Fatal(err)
	}
	r.Steps[0].State = "pending"
	data, _ := json.Marshal(r)
	if err = os.WriteFile(filepath.Join(dir, cleanupDir, id+".json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = Cleanup(context.Background(), dir, id, targets, nil); err == nil {
		t.Fatal("inconsistent success receipt accepted")
	}
}
