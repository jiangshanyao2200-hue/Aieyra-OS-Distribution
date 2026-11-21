// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/memoryservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: historyCursor; memorySourceRole; memoryHistoryQueryKey; pacHistory; memSource
// Impact: python -B scripts/code-atlas.py show Core/memoryservice/pac_history.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package memory

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// Anchor to the last scanned immutable transcript position. Looking up history
// itself appends new messages; an OFFSET would repeat/skip rows as that happens.
type historyCursor struct {
	Query    string `json:"q"`
	At       int64  `json:"at"`
	Session  string `json:"session"`
	Position int64  `json:"pos"`
}

func memorySourceRole(a memoryRow) (string, error) {
	if a["source_role"] == nil {
		return "", nil
	}
	role, ok := a["source_role"].(string)
	if ok && (role == "" || role == "user" || role == "assistant" || role == "tool") {
		return role, nil
	}
	return "", fmt.Errorf("source_role 只支持 user、assistant 或 tool；不筛选时省略")
}

func memoryHistoryQueryKey(scope, query, role string) string {
	key := scope + "\x00" + query
	// Preserve unfiltered cursors issued before source filtering was added.
	if role != "" {
		key += "\x00source_role=" + role
	}
	return fmt.Sprintf("%x", sha256.Sum256([]byte(key)))
}

// Unsealed tails (including old launches) remain available without an idle
// summarizer. Scan a bounded page; report the continuation even when no match
// exists in that page. Source scope is enforced before matching or projection.
func (s *Store) pacHistory(ctx context.Context, db memorySQL, a memoryRow, scope string) (any, error) {
	query, err := memClean(a["query"], 1024, "原文查询", false)
	if err != nil {
		return nil, err
	}
	role, err := memorySourceRole(a)
	if err != nil {
		return nil, err
	}
	offset := 0
	queryKey := memoryHistoryQueryKey(scope, query, role)
	boundary := ""
	args := []any{scope}
	if cursor := memString(a["cursor"]); cursor != "" {
		if len(cursor) > 4096 {
			return nil, fmt.Errorf("原文检索游标过长")
		}
		if strings.HasPrefix(cursor, "h1.") {
			var saved historyCursor
			data, decodeErr := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(cursor, "h1."))
			if decodeErr != nil || json.Unmarshal(data, &saved) != nil || saved.Query != queryKey || saved.Session == "" || len(saved.Session) > 1024 || saved.At < 0 || saved.Position < 0 {
				return nil, fmt.Errorf("原文检索游标无效，请保持原查询、项目及来源筛选，或开始新查询")
			}
			boundary = " AND (t.at < ? OR (t.at = ? AND (t.session > ? OR (t.session = ? AND t.pos < ?))))"
			args = append(args, saved.At, saved.At, saved.Session, saved.Session, saved.Position)
		} else if offset, err = strconv.Atoi(cursor); err != nil || offset < 0 || offset > 10000000 {
			return nil, fmt.Errorf("原文检索游标无效")
		}
	}
	if role != "" {
		boundary += " AND t.role=?"
		args = append(args, role)
	}
	// Numeric cursors issued by older releases remain readable; the following
	// continuation upgrades to an anchor without rewriting stored history.
	args = append(args, offset)
	rows, err := memoryRows(ctx, db, "SELECT t.session,t.pos,t.at,t.role,t.content,t.truncated,COALESCE(o.scope,'legacy_global') AS scope FROM transcript t LEFT JOIN transcript_scopes o ON o.session=t.session WHERE (o.scope IN ('global',?) OR o.scope IS NULL)"+boundary+" ORDER BY t.at DESC,t.session,t.pos DESC LIMIT 513 OFFSET ?", args...)
	if err != nil {
		return nil, err
	}
	more := len(rows) > 512
	rows = rows[:min(512, len(rows))]
	limit := int(memClamp(a["limit"], 1, 20, 8))
	// 多个空格分隔的关键词按“全部出现”匹配，不再当成一整句字面量（R46：模型连写四个词始终零命中）。
	// 不截断关键词、不给部分命中：每个词都是约束，翻页游标也只按实际扫描位置前进。
	terms := strings.Fields(strings.ToLower(query))
	result := []memoryRow{}
	scanned := 0
	for i, r := range rows {
		scanned = i + 1
		body := memString(r["content"])
		hay, all := strings.ToLower(body), true
		for _, t := range terms {
			all = all && strings.Contains(hay, t)
		}
		if !all {
			continue
		}
		result = append(result, memoryRow{"key": r["session"], "position": r["pos"], "at": memISO(memInt(r["at"])), "role": r["role"], "source": memSource(r["role"]), "scope": r["scope"], "excerpt": memSlice(body, 1200), "truncated": memInt(r["truncated"]) != 0 || len([]rune(body)) > 1200})
		if a["_lookup"] == true {
			memoryMatchExcerpt(result[len(result)-1], "excerpt", body, query, 600)
		}
		if len(result) == limit {
			more = more || scanned < len(rows)
			break
		}
	}
	var next any
	if more && scanned > 0 {
		last := rows[scanned-1]
		next = "h1." + base64.RawURLEncoding.EncodeToString(rawJSON(historyCursor{Query: queryKey, At: memInt(last["at"]), Session: memString(last["session"]), Position: memInt(last["pos"])}))
	}
	out := memoryRow{"ok": true, "records": result, "next_cursor": next, "scanned": scanned, "notice": s.resource("Matrix/记忆/历史来源说明.txt")}
	if len(result) == 0 && len(terms) > 1 {
		out["hint"] = "多个关键词须在同一条原文里全部出现；可只用最有区分度的一两个词再查，或按next_cursor继续。"
	}
	return out, nil
}

// memSource 把 role 写成一眼能懂的出处（R46：模型把助手说错的口令当成了用户给的）。
func memSource(role any) string {
	switch memString(role) {
	case "user":
		return "用户原话"
	case "assistant":
		return "助手当时的回复（不是用户提供的信息）"
	case "tool":
		return "工具输出"
	case "system":
		return "系统记录"
	}
	return "出处未知"
}
