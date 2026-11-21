// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: nativeMemory; memoryCall; pacTestStore; pacTestTranscript; pacTestSeal
// Impact: python -B scripts/code-atlas.py show Core/memory_helpers_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
)

func nativeMemory(t *testing.T, file string, now *int64, started int64) *memoryStore {
	t.Helper()
	s, err := openMemoryStore(file, func() int64 { return *now }, started)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func memoryCall(t *testing.T, s *memoryStore, a memoryRow, project, session string) memoryRow {
	t.Helper()
	v, err := s.Call(context.Background(), a, project, session)
	if err != nil {
		t.Fatal(err)
	}
	return v.(memoryRow)
}

func pacTestStore(t *testing.T) *memoryStore {
	t.Helper()
	now := int64(1792560000000)
	return nativeMemory(t, filepath.Join(t.TempDir(), "memory.sqlite"), &now, now)
}

func pacTestTranscript(t *testing.T, s *memoryStore, scope, key string, messages []Message) {
	t.Helper()
	var rows []any
	if err := json.Unmarshal(rawJSON(transcriptRows(key, 0, messages, nil)), &rows); err != nil {
		t.Fatal(err)
	}
	memoryCall(t, s, memoryRow{"action": "transcript_append", "rows": rows}, scope, "test")
}

func pacTestSeal(t *testing.T, s *memoryStore, scope, key, request, content string, first, last int) memoryRow {
	t.Helper()
	return memoryCall(t, s, memoryRow{"action": "pac_seal", "title": request, "keywords": "琥珀色 动画", "content": content, "key": key, "request_id": request, "first_pos": first, "last_pos": last}, scope, "test")
}
