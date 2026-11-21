// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/memoryservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: pacContentLimit; pacIDs; pacVisible; pacView; pacInsert; pacMigrate; pacCall; pacCommit; pacSnapshot; pacProfile; pacSearch; pacOriginal
// Impact: python -B scripts/code-atlas.py show Core/memoryservice/pac.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package memory

// PAC is the single durable archive for stage summaries. Packets are immutable;
// merging changes only the root set, never the children or original transcript.
import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

const pacContentLimit = 24000

func pacIDs(v any) ([]string, error) {
	b, _ := json.Marshal(v)
	var ids []string
	if json.Unmarshal(b, &ids) != nil || len(ids) < 2 || len(ids) > 32 {
		return nil, fmt.Errorf("合并需要2–32个PAC ID")
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if id == "" || len(id) > 80 || seen[id] {
			return nil, fmt.Errorf("PAC ID为空、过长或重复")
		}
		seen[id] = true
	}
	return ids, nil
}

func pacVisible(r memoryRow, scope string) bool { return memVisible(r, scope) }

func pacView(r memoryRow, limit int) memoryRow {
	out := memoryRow{}
	for _, k := range []string{"id", "scope", "kind", "title", "keywords", "level", "source", "session", "first_pos", "last_pos", "active"} {
		out[k] = r[k]
	}
	for _, k := range []string{"created", "first_at", "last_at"} {
		if ms := memInt(r[k]); ms > 0 {
			out[k] = memISO(ms)
		}
	}
	body := memString(r["content"])
	out["content"] = memSlice(body, limit)
	out["truncated"] = out["content"] != body
	return out
}

func (s *Store) pacInsert(ctx context.Context, db memorySQL, r memoryRow) error {
	keys := strings.Fields("id scope kind title content keywords level created first_at last_at source session first_pos last_pos active request_key digest")
	args := make([]any, len(keys))
	for i, key := range keys {
		args[i] = r[key]
	}
	if err := memoryExec(ctx, db, "INSERT INTO pac_packets VALUES("+memPlaceholders(len(keys))+")", args...); err != nil {
		return err
	}
	terms := append(memoryTerms(memString(r["title"])+" "+memString(r["keywords"])), memoryTerms(memString(r["content"]))...)
	for _, term := range terms {
		if err := memoryExec(ctx, db, "INSERT OR IGNORE INTO pac_terms VALUES(?,?)", term, r["id"]); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) pacMigrate(ctx context.Context, db memorySQL) error {
	state, err := memoryOne(ctx, db, "SELECT migrated FROM pac_state WHERE id=1")
	if err != nil || memInt(state["migrated"]) != 0 {
		return err
	}
	// Legacy fast-memory and diaries had no project column. Preserve that original
	// global scope and label their provenance instead of guessing a project.
	queries := []struct{ kind, sql string }{
		{"fast", "SELECT id,kind,content,created,first_at,last_at,session,first_pos,last_pos,status,source FROM fast_memory ORDER BY id"},
		{"diary", "SELECT id,title,content,created,first_at,last_at,sources FROM diaries ORDER BY id"},
		{"dream", "SELECT id,scope,content,created,watermark AS last_at FROM dreams ORDER BY created,id"},
		{"continuity", "SELECT id,title,content,created,updated AS last_at,source FROM memories WHERE id='os-continuity' AND status='active'"},
	}
	for _, query := range queries {
		rows, e := memoryRows(ctx, db, query.sql)
		if e != nil {
			return e
		}
		for _, row := range rows {
			id := "pac_legacy_" + query.kind + "_" + fmt.Sprint(row["id"])
			body := memString(row["content"])
			title := memString(row["title"])
			if title == "" {
				title = "旧记忆 · " + fmt.Sprint(row["id"])
			}
			active := 0
			if query.kind == "continuity" {
				n, e := memoryOne(ctx, db, "SELECT count(*) n FROM fast_memory WHERE kind='segment' AND status='active'")
				if e != nil {
					return e
				}
				if memInt(n["n"]) == 0 {
					active = 1
				}
			}
			if query.kind == "fast" && row["kind"] == "segment" && row["status"] == "active" {
				active = 1
			}
			kind := "legacy_" + query.kind
			if row["kind"] == "pinned" {
				kind = "legacy_profile"
			}
			first, last := memInt(row["first_pos"]), memInt(row["last_pos"])
			if memString(row["session"]) == "" {
				last = -1
			}
			packetScope := memString(row["scope"])
			if packetScope == "" {
				packetScope = "global"
			}
			r := memoryRow{"id": id, "scope": packetScope, "kind": kind, "title": title, "content": body, "keywords": "历史迁移 " + query.kind, "level": 0, "created": row["created"], "first_at": memInt(row["first_at"]), "last_at": memInt(row["last_at"]), "source": "legacy:" + query.kind + ":" + fmt.Sprint(row["id"]) + " " + memString(row["source"]), "session": memString(row["session"]), "first_pos": first, "last_pos": last, "active": active, "request_key": nil, "digest": memHash(body)}
			if e = s.pacInsert(ctx, db, r); e != nil {
				return e
			}
			existingProfiles, e := memoryOne(ctx, db, "SELECT count(*) n FROM memories WHERE kind='preference' AND status='active'")
			if e != nil {
				return e
			}
			if kind == "legacy_profile" && row["status"] == "active" && strings.TrimSpace(body) != "" && memInt(existingProfiles["n"]) == 0 {
				profile := memoryRow{"id": id, "scope": "global", "kind": "preference", "title": "旧记忆中的长期要点（须以用户最新纠正为准）", "content": body, "status": "active", "due": 0, "created": row["created"], "updated": row["created"], "revision": 1, "source": "legacy fast-memory pinned; provenance unverified", "dedupe": nil}
				if e = memoryPut(ctx, db, profile); e != nil {
					return e
				}
				if e = memoryIndex(ctx, db, profile); e != nil {
					return e
				}
			}
			if query.kind == "diary" {
				var sources []memoryRow
				_ = json.Unmarshal([]byte(memString(row["sources"])), &sources)
				for i, ref := range sources {
					child := fmt.Sprintf("pac_legacy_fast_%d", memInt(ref["segment"]))
					if e = memoryExec(ctx, db, "INSERT OR IGNORE INTO pac_children SELECT ?,id,? FROM pac_packets WHERE id=?", id, i, child); e != nil {
						return e
					}
				}
			}
		}
	}
	if err = memoryExec(ctx, db, "UPDATE pac_packets SET level=1 WHERE kind='legacy_diary' AND EXISTS(SELECT 1 FROM pac_children c WHERE c.parent=pac_packets.id)"); err != nil {
		return err
	}
	return memoryExec(ctx, db, "UPDATE pac_state SET migrated=1,version=version+1 WHERE id=1")
}

func (s *Store) pacCall(ctx context.Context, db memorySQL, a memoryRow, scope, session string) (any, error) {
	if err := s.pacMigrate(ctx, db); err != nil {
		return nil, err
	}
	switch memString(a["action"]) {
	case "pac_recovery":
		key := memString(a["key"])
		owner, e := memoryOne(ctx, db, "SELECT scope FROM transcript_scopes WHERE session=?", key)
		if e != nil {
			return nil, e
		}
		if owner == nil || owner["scope"] != scope {
			return memoryRow{"ok": true, "packets": []memoryRow{}}, nil
		}
		first, end := memInt(a["first_pos"]), memInt(a["end_pos"])
		rows, e := memoryRows(ctx, db, "SELECT * FROM pac_packets WHERE session=? AND kind='stage' AND first_pos>=? AND last_pos<? ORDER BY first_pos LIMIT 64", key, first, end)
		if e != nil {
			return nil, e
		}
		out := []memoryRow{}
		for _, r := range rows {
			if memInt(r["first_pos"]) != first {
				break
			}
			out = append(out, pacView(r, pacContentLimit))
			first = memInt(r["last_pos"]) + 1
		}
		return memoryRow{"ok": true, "packets": out}, nil
	case "pac_history":
		return s.pacHistory(ctx, db, a, scope)
	case "pac_message":
		key, err := memClean(a["key"], 200, "原文会话", true)
		if err != nil {
			return nil, err
		}
		owner, err := memoryOne(ctx, db, "SELECT scope FROM transcript_scopes WHERE session=?", key)
		if err != nil {
			return nil, err
		}
		if owner != nil && owner["scope"] != "global" && owner["scope"] != scope {
			return nil, fmt.Errorf("原文不属于当前项目")
		}
		if a["position"] == nil || memInt(a["position"]) < 0 {
			return nil, fmt.Errorf("原文位置无效")
		}
		pos := memInt(a["position"])
		return s.pacOriginal(ctx, db, a, memoryRow{"id": key, "session": key, "first_pos": pos, "last_pos": pos})
	case "pac_seal", "pac_merge":
		return s.pacCommit(ctx, db, a, scope, session)
	case "pac_snapshot":
		return s.pacSnapshot(ctx, db, scope)
	case "pac_profile":
		return s.pacProfile(ctx, db, scope)
	case "pac_search":
		return s.pacSearch(ctx, db, a, scope)
	case "pac_read", "pac_original":
		id, err := memClean(a["id"], 80, "PAC ID", true)
		if err != nil {
			return nil, err
		}
		r, err := memoryOne(ctx, db, "SELECT * FROM pac_packets WHERE id=?", id)
		if err != nil {
			return nil, err
		}
		if !pacVisible(r, scope) {
			return nil, fmt.Errorf("PAC不存在或不属于当前项目")
		}
		if a["action"] == "pac_original" {
			return s.pacOriginal(ctx, db, a, r)
		}
		children, err := memoryRows(ctx, db, "SELECT p.id,p.title,p.level,p.first_at,p.last_at FROM pac_children c JOIN pac_packets p ON p.id=c.child WHERE c.parent=? ORDER BY c.ordinal", id)
		if err != nil {
			return nil, err
		}
		content := []rune(memString(r["content"]))
		offset := int(memInt(a["offset"]))
		if offset < 0 || offset > len(content) {
			return nil, fmt.Errorf("PAC正文偏移无效")
		}
		end := min(len(content), offset+int(memClamp(a["limit_chars"], 256, 8000, 4000)))
		view := pacView(r, 0)
		view["content"], view["truncated"] = string(content[offset:end]), end < len(content)
		return memoryRow{"ok": true, "record": view, "children": children, "next_offset": end, "has_more": end < len(content)}, nil
	default:
		return nil, fmt.Errorf("未知PAC操作")
	}
}

func (s *Store) pacCommit(ctx context.Context, db memorySQL, a memoryRow, scope, session string) (any, error) {
	body, err := memClean(a["content"], pacContentLimit, "PAC摘要", true)
	if err != nil {
		return nil, err
	}
	title, err := memClean(a["title"], 160, "PAC标题", true)
	if err != nil {
		return nil, err
	}
	keywords, err := memClean(a["keywords"], 1024, "PAC关键词", false)
	if err != nil {
		return nil, err
	}
	request, err := memClean(a["request_id"], 200, "封存请求ID", true)
	if err != nil {
		return nil, err
	}
	key := memHash(scope + "\x00" + session + "\x00" + request)
	digest := memHash(string(rawJSON([]any{a["action"], title, body, keywords, a["key"], a["first_pos"], a["last_pos"], a["children"]})))
	old, err := memoryOne(ctx, db, "SELECT id,digest FROM pac_packets WHERE request_key=?", key)
	if err != nil {
		return nil, err
	}
	if old != nil {
		if old["digest"] != digest {
			return nil, fmt.Errorf("同一封存请求ID不能用于不同内容")
		}
		return memoryRow{"ok": true, "id": old["id"], "replayed": true}, nil
	}
	state, err := memoryOne(ctx, db, "SELECT version FROM pac_state WHERE id=1")
	if err != nil {
		return nil, err
	}
	if a["expected_version"] != nil && memInt(a["expected_version"]) != memInt(state["version"]) {
		return nil, fmt.Errorf("PAC目录已变化，请重新读取后封存")
	}
	now := s.now()
	r := memoryRow{"id": "pac_" + newID(), "scope": scope, "kind": "stage", "title": title, "content": body, "keywords": keywords, "level": 0, "created": now, "first_at": int64(0), "last_at": int64(0), "source": "Eyra", "session": "", "first_pos": 0, "last_pos": -1, "active": 1, "request_key": key, "digest": digest}
	var children []string
	if a["action"] == "pac_merge" {
		children, err = pacIDs(a["children"])
		if err != nil {
			return nil, err
		}
		for _, id := range children {
			child, e := memoryOne(ctx, db, "SELECT * FROM pac_packets WHERE id=?", id)
			if e != nil {
				return nil, e
			}
			if child == nil || child["scope"] != scope || memInt(child["active"]) != 1 {
				return nil, fmt.Errorf("只能合并同一项目当前未合并的PAC")
			}
			r["level"] = max(memInt(r["level"]), memInt(child["level"])+1)
			if at := memInt(child["first_at"]); at > 0 && (memInt(r["first_at"]) == 0 || at < memInt(r["first_at"])) {
				r["first_at"] = at
			}
			r["last_at"] = max(memInt(r["last_at"]), memInt(child["last_at"]))
		}
		r["kind"] = "aggregate"
	} else {
		key, e := memClean(a["key"], 200, "原文会话键", true)
		if e != nil {
			return nil, e
		}
		first, last := memInt(a["first_pos"]), memInt(a["last_pos"])
		if a["first_pos"] == nil || a["last_pos"] == nil || first < 0 || last < first {
			return nil, fmt.Errorf("封存原文范围无效")
		}
		owner, e := memoryOne(ctx, db, "SELECT scope FROM transcript_scopes WHERE session=?", key)
		if e != nil {
			return nil, e
		}
		if owner == nil || owner["scope"] != scope {
			return nil, fmt.Errorf("原文尚未可靠保存或不属于当前项目")
		}
		span, e := memoryOne(ctx, db, "SELECT count(*) n,min(at) first_at,max(at) last_at FROM transcript WHERE session=? AND pos BETWEEN ? AND ?", key, first, last)
		if e != nil {
			return nil, e
		}
		if memInt(span["n"]) != last-first+1 {
			return nil, fmt.Errorf("原文范围不完整，保留原上下文")
		}
		overlap, e := memoryOne(ctx, db, "SELECT id FROM pac_packets WHERE session=? AND first_pos<=? AND last_pos>=? LIMIT 1", key, last, first)
		if e != nil {
			return nil, e
		}
		if overlap != nil {
			return nil, fmt.Errorf("原文范围已封存于%s，请使用原PAC", overlap["id"])
		}
		r["session"], r["first_pos"], r["last_pos"] = key, first, last
		r["first_at"], r["last_at"] = span["first_at"], span["last_at"]
	}
	if err = s.pacInsert(ctx, db, r); err != nil {
		return nil, err
	}
	for i, id := range children {
		if err = memoryExec(ctx, db, "INSERT INTO pac_children VALUES(?,?,?)", r["id"], id, i); err != nil {
			return nil, err
		}
		if err = memoryExec(ctx, db, "UPDATE pac_packets SET active=0 WHERE id=?", id); err != nil {
			return nil, err
		}
	}
	if key := memString(r["session"]); key != "" {
		if err = s.transcriptCover(ctx, db, key, memInt(r["last_pos"])+1, now); err != nil {
			return nil, err
		}
	}
	if err = memoryExec(ctx, db, "UPDATE pac_state SET version=version+1 WHERE id=1"); err != nil {
		return nil, err
	}
	return memoryRow{"ok": true, "id": r["id"], "version": memInt(state["version"]) + 1, "record": pacView(r, pacContentLimit), "children": children}, nil
}

func (s *Store) pacSnapshot(ctx context.Context, db memorySQL, scope string) (any, error) {
	state, err := memoryOne(ctx, db, "SELECT version FROM pac_state WHERE id=1")
	if err != nil {
		return nil, err
	}
	rows, err := memoryRows(ctx, db, "SELECT * FROM (SELECT * FROM pac_packets WHERE scope IN ('global',?) AND active=1 ORDER BY created DESC,id DESC LIMIT 65) ORDER BY created,id", scope)
	if err != nil {
		return nil, err
	}
	more := len(rows) > 64
	if more {
		rows = rows[1:]
	}
	roots, used := []memoryRow{}, 0
	for _, row := range rows {
		used += s.estimate(memString(row["content"]))
		roots = append(roots, pacView(row, pacContentLimit))
	}
	profile, err := s.pacProfile(ctx, db, scope)
	if err != nil {
		return nil, err
	}
	return memoryRow{"ok": true, "version": state["version"], "packets": roots, "profile": profile["profile"], "profile_has_more": profile["profile_has_more"], "has_more": more, "summary_tokens": used, "merge_recommended": more || used >= 10000}, nil
}

func (s *Store) pacProfile(ctx context.Context, db memorySQL, scope string) (memoryRow, error) {
	// Read only canonical current preferences; packet prefixes remain stable.
	preferences, err := memoryRows(ctx, db, "SELECT * FROM memories WHERE scope IN ('global',?) AND status='active' AND kind IN ('preference','decision','fact') ORDER BY CASE kind WHEN 'preference' THEN 0 WHEN 'decision' THEN 1 ELSE 2 END,updated DESC,id DESC LIMIT 65", scope)
	if err != nil {
		return nil, err
	}
	profileMore := len(preferences) > 64
	preferences = preferences[:min(64, len(preferences))]
	profile := []memoryRow{}
	for _, row := range preferences {
		profile = append(profile, memView(row, false))
	}
	return memoryRow{"ok": true, "profile": profile, "profile_has_more": profileMore}, nil
}

func (s *Store) pacSearch(ctx context.Context, db memorySQL, a memoryRow, scope string) (any, error) {
	query, err := memClean(a["query"], 1024, "检索词", false)
	if err != nil {
		return nil, err
	}
	offset := 0
	if cursor := memString(a["cursor"]); cursor != "" {
		offset, err = strconv.Atoi(cursor)
		if err != nil || offset < 0 || offset > 1000000 {
			return nil, fmt.Errorf("检索游标无效")
		}
	}
	limit := int(memClamp(a["limit"], 1, 20, 8))
	args := []any{scope}
	where := "p.scope IN ('global',?)"
	if terms := memoryTerms(query); len(terms) > 0 {
		where += " AND EXISTS(SELECT 1 FROM pac_terms t WHERE t.id=p.id AND t.term IN (" + memPlaceholders(len(terms)) + "))"
		for _, term := range terms {
			args = append(args, term)
		}
	} else if query != "" {
		return memoryRow{"ok": true, "records": []memoryRow{}, "next_cursor": nil}, nil
	}
	args = append(args, limit+1, offset)
	rows, err := memoryRows(ctx, db, "SELECT p.* FROM pac_packets p WHERE "+where+" ORDER BY p.last_at DESC,p.created DESC,p.id DESC LIMIT ? OFFSET ?", args...)
	if err != nil {
		return nil, err
	}
	more := len(rows) > limit
	rows = rows[:min(len(rows), limit)]
	result := []memoryRow{}
	for _, row := range rows {
		v := pacView(row, 1000)
		if a["_lookup"] == true {
			memoryMatchExcerpt(v, "content", memString(row["content"]), query, 600)
		}
		result = append(result, v)
	}
	var next any
	if more {
		next = strconv.Itoa(offset + len(rows))
	}
	return memoryRow{"ok": true, "records": result, "next_cursor": next}, nil
}

func (s *Store) pacOriginal(ctx context.Context, db memorySQL, a, packet memoryRow) (any, error) {
	key := memString(packet["session"])
	if key == "" {
		return memoryRow{"ok": true, "rows": []memoryRow{}, "notice": "此包是汇总或旧资料，请通过pac_read读取正文及子包，再按ID直接取回原文。"}, nil
	}
	first, last := memInt(packet["first_pos"]), memInt(packet["last_pos"])
	pos, offset := first, 0
	if cursor := memString(a["cursor"]); cursor != "" {
		parts := strings.Split(cursor, ":")
		if len(parts) != 2 {
			return nil, fmt.Errorf("原文游标无效")
		}
		var e error
		pos, e = strconv.ParseInt(parts[0], 10, 64)
		if e != nil {
			return nil, fmt.Errorf("原文位置无效")
		}
		offset, e = strconv.Atoi(parts[1])
		if e != nil || offset < 0 || pos < first || pos > last {
			return nil, fmt.Errorf("原文游标越界")
		}
	}
	row, err := memoryOne(ctx, db, "SELECT t.pos,t.at,t.role,t.name,t.content,t.truncated,p.payload,p.digest FROM transcript t LEFT JOIN transcript_payloads p ON p.session=t.session AND p.pos=t.pos WHERE t.session=? AND t.pos=?", key, pos)
	if err != nil || row == nil {
		return nil, fmt.Errorf("原文不可用: %v", err)
	}
	body := memString(row["payload"])
	full := body != ""
	if !full {
		body = memString(row["content"])
	}
	runes := []rune(body)
	if offset > len(runes) {
		return nil, fmt.Errorf("原文偏移越界")
	}
	end := min(len(runes), offset+int(memClamp(a["limit_chars"], 256, 8000, 4000)))
	var next any
	if end < len(runes) {
		next = fmt.Sprintf("%d:%d", pos, end)
	} else if pos < last {
		next = fmt.Sprintf("%d:0", pos+1)
	}
	return memoryRow{"ok": true, "id": packet["id"], "position": pos, "at": memISO(memInt(row["at"])), "role": row["role"], "source": memSource(row["role"]), "format": map[bool]string{true: "message_json", false: "legacy_text"}[full], "content": string(runes[offset:end]), "sha256": row["digest"], "legacy_truncated": !full && memInt(row["truncated"]) != 0, "next_cursor": next}, nil
}
