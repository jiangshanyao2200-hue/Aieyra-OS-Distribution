// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestProjectSearchKeepsDigestPaginationAndLongUnicodeLine; BenchmarkProjectMatchDigest
// Impact: python -B scripts/code-atlas.py show Core/project_search_receipt_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProjectSearchKeepsDigestPaginationAndLongUnicodeLine(t *testing.T) {
	w, dir := testWorkspace(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected provider") })
	content := []byte("目标🙂一\n目标🙂二\n" + strings.Repeat("字", 22000) + "目标🙂三\n")
	if err := os.WriteFile(filepath.Join(dir, "sample.txt"), content, 0600); err != nil {
		t.Fatal(err)
	}
	for _, offset := range []int{0, 2} {
		got, err := w.project(context.Background(), WorkspaceMatrix, rawJSON(map[string]any{"action": "search", "path": "sample.txt", "query": "目标🙂", "offset": offset, "limit": 2}))
		if err != nil {
			t.Fatal(err)
		}
		result := got.(map[string]any)
		rows := result["matches"].([]any)
		if len(rows) != min(2, 3-offset) {
			t.Fatal(result)
		}
		for i, row := range rows {
			r := row.(map[string]any)
			if r["line"] != offset+i+1 || r["sha256"] != workspaceHash(content) {
				t.Fatal(r)
			}
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := w.project(ctx, WorkspaceMatrix, rawJSON(map[string]any{"action": "search", "path": "sample.txt", "query": "目标"})); err != context.Canceled {
		t.Fatal(err)
	}
}

func BenchmarkProjectMatchDigest(b *testing.B) {
	data := []byte(strings.Repeat("content match\n", 80000))
	b.Run("previous_120_matches", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			for j := 0; j < 120; j++ {
				_ = workspaceHash(data)
			}
		}
	})
	b.Run("one_digest_per_file", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			digest := workspaceHash(data)
			for j := 0; j < 120; j++ {
				if len(digest) != 64 {
					b.Fatal(digest)
				}
			}
		}
	})
}
