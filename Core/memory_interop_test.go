// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestNativeLegacyDesktopMemoryInteroperability
// Impact: python -B scripts/code-atlas.py show Core/memory_interop_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Keep the native connection open while the frozen legacy desktop implementation
// opens and writes the same WAL database. The release suite runs this once
// with Node and again with the packaged Electron executable.
func TestNativeLegacyDesktopMemoryInteroperability(t *testing.T) {
	executable := os.Getenv("AIEYRA_MEMORY_INTEROP_EXEC")
	if executable == "" {
		var err error
		executable, err = exec.LookPath("node")
		if err != nil {
			t.Skip("Node unavailable; required by desktop release acceptance")
		}
	}
	module, err := filepath.Abs(filepath.Join("..", "Client/Desktop", "test", "fixtures", "legacy-memory-store.cjs"))
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "shared.sqlite")
	now := int64(1700000000000)
	s := nativeMemory(t, file, &now, now+100)
	peer := func(a memoryRow) memoryRow {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, executable, "-e", `const fs=require('node:fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));const s=require(p.module).createMemoryStore(p.file,{now:()=>p.now,startedAt:p.started});try{process.stdout.write(JSON.stringify(s.call(p.args,{project:'project:p',session:'shared'})));}finally{s.close();}`)
		cmd.Env = append(os.Environ(), "ELECTRON_RUN_AS_NODE=1")
		input, _ := json.Marshal(memoryRow{"module": module, "file": file, "now": now, "started": now + 100, "args": a})
		cmd.Stdin = bytes.NewReader(input)
		var diagnostic bytes.Buffer
		cmd.Stderr = &diagnostic
		out, err := cmd.Output()
		if err != nil {
			t.Fatalf("desktop peer: %v: %s", err, diagnostic.String())
		}
		var result memoryRow
		if err := json.Unmarshal(out, &result); err != nil {
			t.Fatal(err, string(out))
		}
		return result
	}
	call := func(a memoryRow) memoryRow { return memoryCall(t, s, a, "project:p", "shared") }
	first := memoryRow{"action": "record", "request_id": "one", "kind": "preference", "title": "森林与地图", "content": "喜欢森林散步，也喜欢阅读地图。", "scope": "global"}
	r := call(first)["record"].(memoryRow)
	if peer(first)["replayed"] != true {
		t.Fatal("cross-runtime request identity differs")
	}
	peer(memoryRow{"action": "update", "id": r["id"], "expected_revision": 1, "content": "喜欢星光、地图与森林。"})
	r = call(memoryRow{"action": "read", "id": r["id"]})["record"].(memoryRow)
	if r["content"] != "喜欢星光、地图与森林。" || memInt(r["revision"]) != 2 {
		t.Fatal("native did not see desktop correction", r)
	}
	claim := call(memoryRow{"action": "dream", "mode": "claim"})["dream"].(memoryRow)
	if peer(memoryRow{"action": "dream", "mode": "claim"})["dream"] != nil {
		t.Fatal("desktop duplicated leased dream")
	}
	peer(memoryRow{"action": "dream", "mode": "release", "id": claim["id"], "claim": claim["claim"]})
	second := peer(memoryRow{"action": "dream", "mode": "claim"})["dream"].(map[string]any)
	if second["id"] != claim["id"] || second["claim"] == claim["claim"] {
		t.Fatal("dream ownership did not transfer")
	}
	call(memoryRow{"action": "dream", "mode": "ack", "id": second["id"], "claim": second["claim"]})
	if peer(memoryRow{"action": "dream", "mode": "claim"})["dream"] != nil {
		t.Fatal("desktop ignored native acknowledgement")
	}
	start := peer(memoryRow{"action": "continuity_snapshot"})
	commit := memoryRow{"action": "continuity_commit", "request_id": "summary", "content": "共享语义记忆", "expected_epoch": start["epoch"], "expected_version": start["version"]}
	if call(commit)["ok"] != true || peer(commit)["replayed"] != true {
		t.Fatal("continuity receipt incompatible")
	}
	stale := peer(memoryRow{"action": "continuity_snapshot"})
	peer(memoryRow{"action": "update", "id": "os-continuity", "expected_revision": 1, "content": "用户修正后的记忆"})
	if call(memoryRow{"action": "continuity_commit", "request_id": "late", "content": "旧结果", "expected_epoch": stale["epoch"], "expected_version": stale["version"]})["forgotten_or_corrected"] != true {
		t.Fatal("native bypassed desktop correction")
	}
	call(memoryRow{"action": "forget", "id": "os-continuity", "expected_revision": 2})
	if peer(commit)["replayed"] != true || peer(memoryRow{"action": "continuity_snapshot"})["content"] != "" {
		t.Fatal("desktop resurrected forgotten continuity")
	}
	peer(memoryRow{"action": "forget", "id": r["id"], "expected_revision": 2})
	if data := string(rawJSON(call(memoryRow{"action": "surface"}))); strings.Contains(data, "森林") {
		t.Fatal("forgotten record remains in native surface", data)
	}
}
