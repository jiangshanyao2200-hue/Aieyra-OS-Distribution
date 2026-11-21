// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/memoryservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: nativeMemory; memoryCall; TestNativeMemoryConnectionsCASCorrectionForgetAndReplay; TestNativeMemoryIdempotencyIsolationAndRevision; TestNativeDreamLeaseDeliveryAndPreStartBoundary
// Impact: python -B scripts/code-atlas.py show Core/memoryservice/store_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package memory

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func nativeMemory(t *testing.T, file string, now *int64, started int64) *Store {
	t.Helper()
	s, err := openMemoryStore(file, func() int64 { return *now }, started)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func memoryCall(t *testing.T, s *Store, a memoryRow, project, session string) memoryRow {
	t.Helper()
	v, err := s.Call(context.Background(), a, project, session)
	if err != nil {
		t.Fatal(err)
	}
	return v.(memoryRow)
}

func TestNativeMemoryConnectionsCASCorrectionForgetAndReplay(t *testing.T) {
	file := filepath.Join(t.TempDir(), "eyra.sqlite")
	now := int64(1700000000000)
	a, b := nativeMemory(t, file, &now, now), nativeMemory(t, file, &now, now)
	read := func(s *Store) memoryRow {
		return memoryCall(t, s, memoryRow{"action": "continuity_snapshot"}, "project:p", "cli")
	}
	commit := func(s *Store, state memoryRow, id, content string) memoryRow {
		return memoryCall(t, s, memoryRow{"action": "continuity_commit", "expected_epoch": state["epoch"], "expected_version": state["version"], "request_id": id, "content": content}, "project:p", "cli")
	}
	start := read(a)
	if commit(a, start, "one", "semantic first")["ok"] != true {
		t.Fatal("initial commit")
	}
	if commit(b, start, "two", "stale")["conflict"] != true {
		t.Fatal("second connection overwrote newer data")
	}
	if commit(b, read(b), "two", "semantic first plus second")["ok"] != true {
		t.Fatal("merge")
	}
	r := memoryCall(t, a, memoryRow{"action": "read", "id": "os-continuity"}, "project:p", "os")["record"].(memoryRow)
	late := read(b)
	memoryCall(t, a, memoryRow{"action": "update", "id": r["id"], "expected_revision": r["revision"], "content": "user correction"}, "project:p", "os")
	if commit(b, late, "late", "old content")["forgotten_or_corrected"] != true {
		t.Fatal("correction fence bypassed")
	}
	current := read(b)
	if current["content"] != "user correction" {
		t.Fatal(current)
	}
	r = memoryCall(t, b, memoryRow{"action": "read", "id": "os-continuity"}, "project:p", "cli")["record"].(memoryRow)
	memoryCall(t, a, memoryRow{"action": "forget", "id": r["id"], "expected_revision": r["revision"]}, "project:p", "os")
	if commit(b, current, "forgotten-late", "user correction")["forgotten_or_corrected"] != true {
		t.Fatal("forget fence bypassed")
	}
	if commit(a, start, "one", "semantic first")["replayed"] != true || read(b)["content"] != "" {
		t.Fatal("replay resurrected forgotten data")
	}
	if commit(b, read(b), "fresh", "new semantic memory")["ok"] != true {
		t.Fatal("fresh epoch cannot commit")
	}
	for _, table := range []string{"memory_revisions"} {
		var count int
		if err := a.db.QueryRow("SELECT count(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatal("old raw fragments retained", count, err)
		}
	}
	c := nativeMemory(t, file, &now, now)
	if read(c)["content"] != "new semantic memory" {
		t.Fatal("SQLite reopen lost shared memory")
	}
}

func TestNativeMemoryIdempotencyIsolationAndRevision(t *testing.T) {
	now := int64(1700000000000)
	s := nativeMemory(t, filepath.Join(t.TempDir(), "eyra.sqlite"), &now, now)
	request := memoryRow{"action": "record", "title": "editor preference", "content": "Use Chinese", "request_id": "once", "source": "explicit user request"}
	r := memoryCall(t, s, request, "project:p", "cli")["record"].(memoryRow)
	if memoryCall(t, s, request, "project:p", "cli")["replayed"] != true {
		t.Fatal("record retry duplicated")
	}
	request["content"] = "different"
	if _, err := s.Call(context.Background(), request, "project:p", "cli"); err == nil {
		t.Fatal("conflicting ID accepted")
	}
	if _, err := s.Call(context.Background(), memoryRow{"action": "read", "id": r["id"]}, "project:q", "os"); err == nil {
		t.Fatal("project memory leaked")
	}
	if _, err := s.Call(context.Background(), memoryRow{"action": "update", "id": r["id"], "expected_revision": 0, "content": "stale"}, "project:p", "os"); err == nil {
		t.Fatal("stale update accepted")
	}
	memoryCall(t, s, memoryRow{"action": "update", "id": r["id"], "expected_revision": 1, "content": "Use English"}, "project:p", "os")
	memoryCall(t, s, memoryRow{"action": "forget", "id": r["id"], "expected_revision": 2}, "project:p", "os")
	for _, table := range []string{"memories", "memory_terms", "memory_revisions"} {
		var count int
		if err := s.db.QueryRow("SELECT count(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatal(table, count, err)
		}
	}
}

func TestNativeDreamLeaseDeliveryAndPreStartBoundary(t *testing.T) {
	now := int64(1700000000000)
	file := filepath.Join(t.TempDir(), "eyra.sqlite")
	a := nativeMemory(t, file, &now, now+1000)
	record := memoryCall(t, a, memoryRow{"action": "record", "title": "森林 银河", "content": "森林里的散步与银河的光。", "scope": "global"}, "p", "os")["record"].(memoryRow)
	now += 2000
	b := nativeMemory(t, file, &now, 1700000001000)
	memoryCall(t, a, memoryRow{"action": "record", "title": "CURRENT_SECRET_TOPIC", "content": "new material after process start"}, "p", "os")
	claim := func(s *Store) memoryRow {
		return memoryCall(t, s, memoryRow{"action": "dream", "mode": "claim"}, "p", "cli")
	}
	dream := claim(a)["dream"].(memoryRow)
	if dream["fiction"] != true || strings.Contains(memString(dream["content"]), "CURRENT") {
		t.Fatal("new task entered dream", dream)
	}
	if claim(b)["dream"] != nil {
		t.Fatal("dream delivered twice concurrently")
	}
	ack := func(s *Store, d memoryRow, mode string) error {
		_, err := s.Call(context.Background(), memoryRow{"action": "dream", "mode": mode, "id": d["id"], "claim": d["claim"]}, "p", "cli")
		return err
	}
	wrong := memoryRow{"id": dream["id"], "claim": "wrong"}
	if ack(b, wrong, "ack") == nil {
		t.Fatal("wrong claim acknowledged")
	}
	if err := ack(a, dream, "release"); err != nil {
		t.Fatal(err)
	}
	second := claim(b)["dream"].(memoryRow)
	if second["id"] != dream["id"] || second["claim"] == dream["claim"] {
		t.Fatal("release did not renew exclusive lease")
	}
	if ack(a, dream, "ack") == nil {
		t.Fatal("released claimant acknowledged")
	}
	now += 120001
	third := claim(a)["dream"].(memoryRow)
	if ack(b, second, "ack") == nil {
		t.Fatal("expired claimant acknowledged")
	}
	if err := ack(a, third, "ack"); err != nil {
		t.Fatal(err)
	}
	now += 7 * 3600000
	if claim(b)["dream"] != nil {
		t.Fatal("unchanged source replayed after cooldown")
	}
	memoryCall(t, a, memoryRow{"action": "update", "id": record["id"], "expected_revision": 1, "content": "用户纠正：海洋与书页。"}, "p", "os")
	c := nativeMemory(t, file, &now, now+1)
	fresh := claim(c)["dream"].(memoryRow)
	if fresh["id"] == third["id"] {
		t.Fatal("new pre-start source not eligible")
	}
	memoryCall(t, a, memoryRow{"action": "forget", "id": record["id"], "expected_revision": 2}, "p", "os")
	if ack(c, fresh, "ack") == nil {
		t.Fatal("forgotten dream still deliverable")
	}
}
