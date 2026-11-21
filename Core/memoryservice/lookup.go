// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/memoryservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: lookupSources; lookupCursor; lookup; memoryMatchExcerpt
// Impact: python -B scripts/code-atlas.py show Core/memoryservice/lookup.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package memory

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"
)

// lookup 一次查三处：记录下来的事实与偏好（records）、封存的 PAC 包（packets）、
// 未封存的聊天原文（transcripts）。三类分开返回、各自保留出处字段，不混排打分；
// 每类有自己的游标，合成一个 next_cursor，某类翻完就不再查它，不会因合并而跳过结果。
// 何时检索仍由模型自己决定，这里不自动触发；项目边界与 memory_enabled 沿用各子查询与服务层。
var lookupSources = []string{"records", "packets", "transcripts"}

type lookupCursor struct {
	Version int               `json:"v"`
	Query   string            `json:"q"`
	Sources map[string]string `json:"sources"`
}

func (s *Store) lookup(ctx context.Context, db memorySQL, a memoryRow, scope string) (any, error) {
	query, err := memClean(a["query"], 256, "查询", false)
	if err != nil {
		return nil, err
	}
	if query == "" {
		return nil, fmt.Errorf("lookup 需要 query")
	}
	role, err := memorySourceRole(a)
	if err != nil {
		return nil, err
	}
	if err := s.pacMigrate(ctx, db); err != nil {
		return nil, err
	}
	queryKey := memoryHistoryQueryKey(scope, query, role)
	cursors := map[string]string{"records": "", "packets": "", "transcripts": ""}
	if c := memString(a["cursor"]); c != "" {
		if len(c) > 4096 {
			return nil, fmt.Errorf("lookup 游标过长")
		}
		data, e := base64.RawURLEncoding.DecodeString(c)
		var saved lookupCursor
		if e != nil || json.Unmarshal(data, &saved) != nil || saved.Version != 1 || saved.Query != queryKey || len(saved.Sources) == 0 {
			return nil, fmt.Errorf("lookup 游标无效")
		}
		cursors = saved.Sources
		for k := range cursors {
			if k != "records" && k != "packets" && k != "transcripts" {
				return nil, fmt.Errorf("lookup 游标无效")
			}
		}
	}
	limit := memClamp(a["limit"], 1, 5, 3)
	out := memoryRow{"ok": true, "query": query}
	next := map[string]string{}
	for _, name := range lookupSources {
		cursor, active := cursors[name]
		if !active {
			out[name] = []memoryRow{}
			continue
		}
		var (
			page any
			e    error
		)
		args := memoryRow{"query": query, "limit": limit, "_lookup": true}
		if cursor != "" {
			args["cursor"] = cursor
		}
		switch name {
		case "records":
			args["history"], args["_lookup"] = true, true
			page, e = s.search(ctx, db, args, scope)
		case "packets":
			page, e = s.pacSearch(ctx, db, args, scope)
		case "transcripts":
			args["source_role"] = role
			page, e = s.pacHistory(ctx, db, args, scope)
		}
		if e != nil {
			return nil, fmt.Errorf("%s 检索失败：%w", name, e)
		}
		row, _ := page.(memoryRow)
		records, _ := row["records"].([]memoryRow)
		if records == nil {
			records = []memoryRow{}
		}
		for _, record := range records {
			switch name {
			case "records":
				record["read"] = memoryRow{"action": "read", "id": record["id"]}
			case "packets":
				record["read"] = memoryRow{"action": "packet", "id": record["id"]}
			case "transcripts":
				record["read"] = memoryRow{"action": "original", "key": record["key"], "position": record["position"]}
			}
		}

		out[name] = records
		if c := memString(row["next_cursor"]); c != "" {
			next[name] = c
		}
	}
	if len(next) > 0 {
		out["next_cursor"] = base64.RawURLEncoding.EncodeToString(rawJSON(lookupCursor{Version: 1, Query: queryKey, Sources: next}))
	} else {
		out["next_cursor"] = nil
	}
	out["notice"] = s.resource("Matrix/记忆/检索结果说明.txt")
	return out, nil
}

// Offsets count Unicode code points in stored content; never slice UTF-8 bytes.
// A contiguous excerpt preserves context. Widely separated terms require read.
func memoryMatchExcerpt(row memoryRow, field, body, query string, limit int) {
	runes := []rune(body)
	lower := strings.ToLower(body)
	match := -1
	groups := [][]string{{strings.TrimSpace(strings.ToLower(query))}, strings.Fields(strings.ToLower(query)), memoryTerms(query)}
	for _, terms := range groups {
		for _, term := range terms {
			if term == "" {
				continue
			}
			pos := strings.Index(lower, term)
			if pos >= 0 {
				n := utf8.RuneCountInString(lower[:pos])
				if match < 0 || n < match {
					match = n
				}
			}
		}
		if match >= 0 {
			break
		}
	}
	start := max(0, match-limit/4)
	start = min(start, max(0, len(runes)-limit))
	end := min(len(runes), start+limit)
	row[field] = string(runes[start:end])
	row["excerpt_start"] = start
	row["excerpt_end"] = end
	row["truncated"] = row["truncated"] == true || start > 0 || end < len(runes)
}
