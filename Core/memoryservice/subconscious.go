// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/memoryservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: memIDs; memPlaceholders; fastOrganize; dreamWrite; dreamState; diaryView; diaryList; diaryRead; diaryMark; deepSnippet; deepScore; deepSearch; doubleArgs; transcriptRange
// Impact: python -B scripts/code-atlas.py show Core/memoryservice/subconscious.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package memory

// 潜意识的存储一侧（记忆系统 M-C，README.md 记忆系统 §2、§7、§8）：
// 整理 fast memory（较早的段写成一篇日记、新要点并进“要点”、这些段退出表层）、日记的分享与已读、模型写的梦、
// 以及给“问潜意识”用的深层检索。没有删除：退出表层的段仍在库里，原文也在。这里只做存取，不调用模型。
import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	diaryLimit       = 8000 // 单篇日记上限
	pinnedLimit      = 6000 // 要点上限
	dreamLimit       = 800  // 单个梦上限
	SearchTermsLimit = 8
	deepSearchRows   = 400
	deepSnippetChars = 600
)

func memIDs(raw any) []int64 {
	list, _ := raw.([]any)
	out := []int64{}
	for _, v := range list {
		if id := memInt(v); id > 0 {
			out = append(out, id)
		}
	}
	return out
}

func memPlaceholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

// 一次整理：要点整体替换，指定的段退出表层，写一篇日记（可选），顺手记下一个梦（可选）。全部在同一个事务里。
func (s *Store) fastOrganize(ctx context.Context, db memorySQL, a memoryRow, scope string) (any, error) {
	now := s.now()
	retire := memIDs(a["retire"])
	if len(retire) > fastSnapshotSegment {
		return nil, fmt.Errorf("一次整理的段太多")
	}
	args := make([]any, len(retire))
	for i, id := range retire {
		args[i] = id
	}
	segments := []memoryRow{}
	if len(retire) > 0 {
		var err error
		segments, err = memoryRows(ctx, db, "SELECT id,session,first_pos,last_pos,first_at,last_at FROM fast_memory WHERE kind='segment' AND status='active' AND id IN ("+memPlaceholders(len(retire))+") ORDER BY id", args...)
		if err != nil {
			return nil, err
		}
		if len(segments) != len(retire) {
			return nil, fmt.Errorf("要整理的段已经变化，请重新读取")
		}
	}
	diaryID := int64(0)
	if d, _ := a["diary"].(map[string]any); d != nil {
		title := memSlice(strings.TrimSpace(memString(d["title"])), 80)
		body := memSlice(strings.TrimSpace(memString(d["content"])), diaryLimit)
		if body == "" {
			return nil, fmt.Errorf("日记为空")
		}
		if title == "" {
			title = "日记"
		}
		sources := []memoryRow{}
		firstAt, lastAt := int64(0), int64(0)
		for _, r := range segments {
			sources = append(sources, memoryRow{"segment": memInt(r["id"]), "session": memString(r["session"]), "first_pos": memInt(r["first_pos"]), "last_pos": memInt(r["last_pos"])})
			if at := memInt(r["first_at"]); at > 0 && (firstAt == 0 || at < firstAt) {
				firstAt = at
			}
			lastAt = max(lastAt, memInt(r["last_at"]))
		}
		shareable := 0
		if v, _ := d["shareable"].(bool); v {
			shareable = 1
		}
		if err := memoryExec(ctx, db, "INSERT INTO diaries(created,title,content,first_at,last_at,sources,shareable) VALUES(?,?,?,?,?,?,?)", now, title, body, firstAt, lastAt, string(rawJSON(sources)), shareable); err != nil {
			return nil, err
		}
		row, err := memoryOne(ctx, db, "SELECT last_insert_rowid() id")
		if err != nil {
			return nil, err
		}
		diaryID = memInt(row["id"])
	}
	if len(retire) > 0 {
		if err := memoryExec(ctx, db, "UPDATE fast_memory SET status='organized' WHERE kind='segment' AND status='active' AND id IN ("+memPlaceholders(len(retire))+")", args...); err != nil {
			return nil, err
		}
	}
	if pinned := memSlice(strings.TrimSpace(memString(a["pinned"])), pinnedLimit); pinned != "" {
		if err := memoryExec(ctx, db, "UPDATE fast_memory SET status='replaced' WHERE kind='pinned' AND status='active'"); err != nil {
			return nil, err
		}
		if err := memoryExec(ctx, db, "INSERT INTO fast_memory(kind,content,created,source) VALUES('pinned',?,?,'organize')", pinned, now); err != nil {
			return nil, err
		}
	}
	if dream := strings.TrimSpace(memString(a["dream"])); dream != "" {
		if err := s.dreamWrite(ctx, db, scope, dream); err != nil {
			return nil, err
		}
	}
	if err := memoryExec(ctx, db, "UPDATE fast_memory_state SET version=version+1 WHERE id=1"); err != nil {
		return nil, err
	}
	return memoryRow{"ok": true, "diary_id": diaryID, "retired": len(retire)}, nil
}

// 模型写的梦：存起来留给下次启动，由问候领取（memory_dream.go 的 claim/ack）。
func (s *Store) dreamWrite(ctx context.Context, db memorySQL, scope, content string) error {
	body := memSlice(dreamPrivate.ReplaceAllString(memorySecret.ReplaceAllString(strings.TrimSpace(content), " "), " "), dreamLimit)
	if body == "" {
		return fmt.Errorf("梦为空")
	}
	now := s.now()
	if err := memoryExec(ctx, db, "INSERT INTO dreams(id,scope,content,created,watermark) VALUES(?,?,?,?,?)", newID(), scope, body, now, now); err != nil {
		return err
	}
	return memoryExec(ctx, db, "DELETE FROM dreams WHERE scope=? AND told>0 AND id NOT IN (SELECT id FROM dreams WHERE scope=? ORDER BY created DESC LIMIT 32)", scope, scope)
}

func (s *Store) dreamState(ctx context.Context, db memorySQL, scope string) (any, error) {
	last, err := memoryOne(ctx, db, "SELECT created,told FROM dreams WHERE scope=? ORDER BY created DESC LIMIT 1", scope)
	if err != nil {
		return nil, err
	}
	if last == nil {
		return memoryRow{"ok": true, "last": int64(0), "untold": false}, nil
	}
	return memoryRow{"ok": true, "last": memInt(last["created"]), "untold": memInt(last["told"]) == 0}, nil
}

func diaryView(r memoryRow, full bool) memoryRow {
	out := memoryRow{"id": memInt(r["id"]), "created": memInt(r["created"]), "title": memString(r["title"]), "first_at": memInt(r["first_at"]), "last_at": memInt(r["last_at"]), "shareable": memInt(r["shareable"]) > 0, "shared": memInt(r["shared"]), "read": memInt(r["read"])}
	if full {
		out["content"] = memString(r["content"])
		var sources any
		_ = json.Unmarshal([]byte(memString(r["sources"])), &sources)
		out["sources"] = sources
	} else {
		out["chars"] = len([]rune(memString(r["content"])))
	}
	return out
}

// filter：shareable（可分享、还没给用户看）、waiting（已经给出、用户还没看）、空 = 全部。
func (s *Store) diaryList(ctx context.Context, db memorySQL, a memoryRow) (any, error) {
	where := "1=1"
	switch memString(a["filter"]) {
	case "shareable":
		where = "shareable=1 AND shared=0"
	case "waiting":
		where = "shared>0 AND read=0"
	}
	rows, err := memoryRows(ctx, db, "SELECT * FROM diaries WHERE "+where+" ORDER BY created DESC LIMIT ?", memClamp(a["limit"], 1, 50, 10))
	if err != nil {
		return nil, err
	}
	out := []memoryRow{}
	for _, r := range rows {
		out = append(out, diaryView(r, false))
	}
	return memoryRow{"ok": true, "diaries": out}, nil
}

func (s *Store) diaryRead(ctx context.Context, db memorySQL, a memoryRow) (any, error) {
	r, err := memoryOne(ctx, db, "SELECT * FROM diaries WHERE id=?", memInt(a["id"]))
	if err != nil {
		return nil, err
	}
	if r == nil {
		return memoryRow{"ok": false, "error": "没有这篇日记"}, nil
	}
	return memoryRow{"ok": true, "diary": diaryView(r, true)}, nil
}

// 分享：只能分享潜意识标为可分享的；已读：用户点开看过。两者都只记第一次的时间。
func (s *Store) diaryMark(ctx context.Context, db memorySQL, a memoryRow) (any, error) {
	id := memInt(a["id"])
	r, err := memoryOne(ctx, db, "SELECT shareable,shared FROM diaries WHERE id=?", id)
	if err != nil {
		return nil, err
	}
	if r == nil {
		return memoryRow{"ok": false, "error": "没有这篇日记"}, nil
	}
	now := s.now()
	switch memString(a["mark"]) {
	case "shared":
		if memInt(r["shareable"]) == 0 {
			return memoryRow{"ok": false, "error": "这篇日记没有标为可以分享"}, nil
		}
		err = memoryExec(ctx, db, "UPDATE diaries SET shared=? WHERE id=? AND shared=0", now, id)
	case "read":
		if memInt(r["shared"]) == 0 {
			return memoryRow{"ok": false, "error": "这篇日记还没有分享"}, nil
		}
		err = memoryExec(ctx, db, "UPDATE diaries SET read=? WHERE id=? AND read=0", now, id)
	default:
		return nil, fmt.Errorf("mark 仅支持 shared 或 read")
	}
	return memoryRow{"ok": err == nil}, err
}

func deepSnippet(content string, terms []string) string {
	runes := []rune(content)
	if len(runes) <= deepSnippetChars {
		return content
	}
	lower := strings.ToLower(content)
	at := -1
	for _, t := range terms {
		if i := strings.Index(lower, strings.ToLower(t)); i >= 0 && (at < 0 || i < at) {
			at = i
		}
	}
	start := 0
	if at > 0 {
		start = max(0, len([]rune(content[:at]))-deepSnippetChars/3)
	}
	end := min(len(runes), start+deepSnippetChars)
	out := string(runes[start:end])
	if start > 0 {
		out = "…" + out
	}
	if end < len(runes) {
		out += "…"
	}
	return out
}

func deepScore(content string, terms []string) int {
	lower, n := strings.ToLower(content), 0
	for _, t := range terms {
		if strings.Contains(lower, strings.ToLower(t)) {
			n++
		}
	}
	return n
}

// 深层检索：日记、已退出表层的段、原文（只看用户和 Eyra 的话）。按命中的关键词个数排，再按新近。
func (s *Store) deepSearch(ctx context.Context, db memorySQL, a memoryRow) (any, error) {
	terms := []string{}
	if list, _ := a["terms"].([]any); len(list) > 0 {
		for _, v := range list {
			if t := strings.TrimSpace(memString(v)); len([]rune(t)) >= 2 && len(terms) < SearchTermsLimit {
				terms = append(terms, memSlice(t, 40))
			}
		}
	}
	if len(terms) == 0 {
		return memoryRow{"ok": true, "terms": terms, "diaries": []memoryRow{}, "segments": []memoryRow{}, "transcript": []memoryRow{}}, nil
	}
	like := make([]string, len(terms))
	args := make([]any, len(terms))
	for i, t := range terms {
		like[i] = "content LIKE ?"
		args[i] = "%" + strings.NewReplacer("%", "", "_", "").Replace(t) + "%"
	}
	cond := "(" + strings.Join(like, " OR ") + ")"
	pick := func(rows []memoryRow, limit int, view func(memoryRow) memoryRow) []memoryRow {
		type scored struct {
			row   memoryRow
			score int
		}
		list := []scored{}
		for _, r := range rows {
			if n := deepScore(memString(r["title"])+" "+memString(r["content"]), terms); n > 0 {
				list = append(list, scored{r, n})
			}
		}
		for i := 1; i < len(list); i++ {
			for j := i; j > 0 && list[j].score > list[j-1].score; j-- {
				list[j], list[j-1] = list[j-1], list[j]
			}
		}
		out := []memoryRow{}
		for _, v := range list[:min(limit, len(list))] {
			out = append(out, view(v.row))
		}
		return out
	}
	diaries, err := memoryRows(ctx, db, "SELECT id,created,title,content,first_at,last_at FROM diaries WHERE "+strings.ReplaceAll(cond, "content LIKE ?", "(content LIKE ? OR title LIKE ?)")+" ORDER BY created DESC LIMIT 60", doubleArgs(args)...)
	if err != nil {
		return nil, err
	}
	segments, err := memoryRows(ctx, db, "SELECT id,content,first_at,last_at FROM fast_memory WHERE kind='segment' AND status<>'active' AND "+cond+" ORDER BY id DESC LIMIT 60", args...)
	if err != nil {
		return nil, err
	}
	transcript, err := memoryRows(ctx, db, "SELECT session,pos,at,role,content FROM transcript WHERE role IN ('user','assistant') AND "+cond+" ORDER BY at DESC LIMIT ?", append(args, deepSearchRows)...)
	if err != nil {
		return nil, err
	}
	limit := memClamp(a["limit"], 1, 20, 8)
	return memoryRow{"ok": true, "terms": terms,
		"diaries": pick(diaries, 4, func(r memoryRow) memoryRow {
			return memoryRow{"id": memInt(r["id"]), "title": memString(r["title"]), "first_at": memInt(r["first_at"]), "last_at": memInt(r["last_at"]), "content": memSlice(memString(r["content"]), 1500)}
		}),
		"segments": pick(segments, 4, func(r memoryRow) memoryRow {
			return memoryRow{"id": memInt(r["id"]), "first_at": memInt(r["first_at"]), "last_at": memInt(r["last_at"]), "content": memSlice(memString(r["content"]), 1200)}
		}),
		"transcript": pick(transcript, int(limit), func(r memoryRow) memoryRow {
			return memoryRow{"session": memString(r["session"]), "pos": memInt(r["pos"]), "at": memInt(r["at"]), "role": memString(r["role"]), "content": deepSnippet(memString(r["content"]), terms)}
		}),
	}, nil
}

func doubleArgs(args []any) []any {
	out := make([]any, 0, len(args)*2)
	for _, v := range args {
		out = append(out, v, v)
	}
	return out
}

// 一段原文（按位置），给潜意识压缩用；带上时间，记忆段里的“什么时候说的”才准。
func (s *Store) transcriptRange(ctx context.Context, db memorySQL, a memoryRow) (any, error) {
	key, err := memClean(a["key"], 200, "会话键", true)
	if err != nil {
		return nil, err
	}
	first, last := memInt(a["first_pos"]), memInt(a["last_pos"])
	if first < 0 || last < first {
		return nil, fmt.Errorf("原文范围无效")
	}
	rows, err := memoryRows(ctx, db, "SELECT pos,at,role,name,content,truncated FROM transcript WHERE session=? AND pos BETWEEN ? AND ? ORDER BY pos LIMIT 4000", key, first, last)
	if err != nil {
		return nil, err
	}
	return memoryRow{"ok": true, "rows": rows}, nil
}
