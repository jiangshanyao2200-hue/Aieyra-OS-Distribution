// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/memoryservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: continuity
// Impact: python -B scripts/code-atlas.py show Core/memoryservice/continuity.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package memory

import (
	"context"
	"fmt"
	"strings"
)

func (s *Store) continuity(ctx context.Context, db memorySQL, a memoryRow, project, session string) (any, error) {
	commit := a["action"] == "continuity_commit"
	limit := 4000
	if commit {
		limit = 12000
	}
	body, err := memClean(a["content"], limit, "连续摘要", true)
	if err != nil {
		return nil, err
	}
	request, err := memClean(a["request_id"], 160, "请求ID", true)
	if err != nil {
		return nil, err
	}
	key, digest := memHash(session+"\x00"+request), memHash(body)
	prior, err := memoryOne(ctx, db, "SELECT digest FROM os_continuity_receipts WHERE key=?", key)
	if err != nil {
		return nil, err
	}
	if prior != nil {
		if prior["digest"] != digest {
			return nil, fmt.Errorf("摘要请求已用于其他内容")
		}
		return memoryRow{"ok": true, "replayed": true}, nil
	}
	if commit {
		state, e := memoryOne(ctx, db, "SELECT epoch,version FROM os_continuity_state WHERE id=1")
		if e != nil {
			return nil, e
		}
		if a["expected_epoch"] == nil || memInt(a["expected_epoch"]) != memInt(state["epoch"]) {
			return memoryRow{"ok": false, "forgotten_or_corrected": true}, nil
		}
		if a["expected_version"] == nil || memInt(a["expected_version"]) != memInt(state["version"]) {
			return memoryRow{"ok": false, "conflict": true}, nil
		}
		if err = memoryExec(ctx, db, "DELETE FROM os_continuity"); err != nil {
			return nil, err
		}
	}
	now := s.now()
	if err = memoryExec(ctx, db, "INSERT INTO os_continuity VALUES(?,?,?,?,?)", key, digest, body, project, now); err != nil {
		return nil, err
	}
	if err = memoryExec(ctx, db, "INSERT INTO os_continuity_receipts VALUES(?,?)", key, digest); err != nil {
		return nil, err
	}
	if !commit {
		if err = memoryExec(ctx, db, "DELETE FROM os_continuity WHERE key NOT IN (SELECT key FROM os_continuity ORDER BY updated DESC,rowid DESC LIMIT 128)"); err != nil {
			return nil, err
		}
		rows, e := memoryRows(ctx, db, "SELECT content,updated FROM os_continuity ORDER BY updated DESC,rowid DESC LIMIT 12")
		if e != nil {
			return nil, e
		}
		parts := []string{}
		for _, r := range rows {
			parts = append(parts, memISO(memInt(r["updated"]))+"\n"+memString(r["content"]))
		}
		body = memSlice(strings.Join(parts, "\n\n"), 12000)
	}
	old, err := memoryOne(ctx, db, "SELECT * FROM memories WHERE id='os-continuity'")
	if err != nil {
		return nil, err
	}
	created, revision := now, int64(1)
	if old != nil {
		created, revision = memInt(old["created"]), memInt(old["revision"])+1
		if err = memoryUnindex(ctx, db, old["id"]); err != nil {
			return nil, err
		}
	}
	r := memoryRow{"id": "os-continuity", "scope": "global", "kind": "summary", "title": "Eyra 连续记忆", "content": body, "status": "active", "due": int64(0), "created": created, "updated": now, "revision": revision, "source": s.resource("Matrix/辅助指令/连续记忆来源.txt"), "dedupe": nil}
	if err = memoryPut(ctx, db, r); err != nil {
		return nil, err
	}
	if commit {
		if err = memoryExec(ctx, db, "DELETE FROM memory_revisions WHERE id=?", r["id"]); err != nil {
			return nil, err
		}
	}
	if err = memoryExec(ctx, db, "UPDATE os_continuity_state SET version=version+1 WHERE id=1"); err != nil {
		return nil, err
	}
	if err = memoryIndex(ctx, db, r); err != nil {
		return nil, err
	}
	return memoryRow{"ok": true, "id": r["id"], "revision": revision}, nil
}
