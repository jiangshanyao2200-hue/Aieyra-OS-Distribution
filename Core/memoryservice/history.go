// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/memoryservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: transcriptHistory; transcriptHistoryOriginal; payloadOriginalText
// Impact: python -B scripts/code-atlas.py show Core/memoryservice/history.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package memory

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// The UI reads the existing memory transcript through its owner. There is no
// second chat database and these operations are not exposed as model tools.
func (s *Store) transcriptHistory(ctx context.Context, db memorySQL, a memoryRow) (any, error) {
	limit := int(memInt(a["limit"]))
	if limit < 1 || limit > 51 {
		return nil, fmt.Errorf("invalid history limit")
	}
	prefix, err := memClean(a["exclude_prefix"], 200, "当前会话", true)
	if err != nil {
		return nil, err
	}
	before := memString(a["before"])
	if len(before) > 512 {
		return nil, fmt.Errorf("invalid history cursor")
	}
	query := `SELECT session,pos,at,role,name,content,truncated FROM transcript WHERE substr(session,1,length(?))<>? AND role IN ('user','assistant') AND trim(content)<>'' AND NOT(role='assistant' AND ltrim(content) LIKE '→ 调用 %')`
	args := []any{prefix, prefix}
	if before != "" {
		query += ` AND (printf('%020d',at*1000000)||':memory:'||session||':'||printf('%012d',pos))<?`
		args = append(args, before)
	}
	query += ` ORDER BY at DESC,session DESC,pos DESC LIMIT ?`
	args = append(args, limit)
	rows, err := memoryRows(ctx, db, query, args...)
	if err != nil {
		return nil, err
	}
	return memoryRow{"ok": true, "rows": rows}, nil
}
func (s *Store) transcriptHistoryOriginal(ctx context.Context, db memorySQL, a memoryRow) (any, error) {
	id := memString(a["entry_id"])
	if !strings.HasPrefix(id, "memory:") || len(id) > 512 {
		return nil, fmt.Errorf("invalid history entry")
	}
	at := strings.LastIndex(id, ":")
	if at <= len("memory:") || at == len(id)-1 {
		return nil, fmt.Errorf("invalid history entry")
	}
	key := id[len("memory:"):at]
	pos, err := strconv.ParseInt(id[at+1:], 10, 64)
	if err != nil || pos < 0 {
		return nil, fmt.Errorf("invalid history position")
	}
	row, err := memoryOne(ctx, db, `SELECT t.content,t.truncated,p.payload FROM transcript t LEFT JOIN transcript_payloads p ON p.session=t.session AND p.pos=t.pos WHERE t.session=? AND t.pos=? AND t.role IN ('user','assistant')`, key, pos)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, fmt.Errorf("历史原文已不可用")
	}
	// 检索预览去掉了首尾空白；查看原文时从完整脱敏消息取回逐字内容（R46：末尾换行丢失）。
	// 只在两者去空白后一致时采用，附图/工具调用等补充说明照旧走预览。
	if text, ok := payloadOriginalText(memString(row["payload"])); ok && memInt(row["truncated"]) == 0 && strings.TrimSpace(text) == memString(row["content"]) {
		row["content"] = text
	}
	delete(row, "payload")
	return memoryRow{"ok": true, "row": row}, nil
}

func payloadOriginalText(payload string) (string, bool) {
	var m struct {
		Content   json.RawMessage `json:"content"`
		ToolCalls []any           `json:"tool_calls"`
		Images    []any           `json:"image_attachments"`
	}
	var text string
	if payload == "" || json.Unmarshal([]byte(payload), &m) != nil || len(m.ToolCalls) > 0 || len(m.Images) > 0 || json.Unmarshal(m.Content, &text) != nil {
		return "", false
	}
	return text, true
}
