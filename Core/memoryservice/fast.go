// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/memoryservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: transcriptRole; transcriptAppend; readableContinuity; fastMigrate; fastSnapshot; fastAppend; transcriptCover; transcriptPending; transcriptBacklog; transcriptSkip
// Impact: python -B scripts/code-atlas.py show Core/memoryservice/fast.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package memory

// Fast memory（表层记忆）与深层原文（记忆系统 M-A，README.md 记忆系统）。
// 原文按“会话键 + 位置”只追加、去重；记忆段只追加，整理时才改；旧版连续记忆在第一次读取时迁成第一段。
// 这里只做存取，不调用模型；压缩由工作区按同一前缀发起。
import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	transcriptRowLimit  = 16000 // 单条原文上限（UTF-16 单位）
	fastSegmentLimit    = 12000 // 单个记忆段上限
	PendingDefault      = 60000 // 启动补压时一次取回的原文字数
	fastSnapshotSegment = 64    // 一次最多返回的活跃记忆段
)

func transcriptRole(role string) bool {
	return role == RoleUser || role == RoleAssistant || role == RoleTool || role == "system"
}

func (s *Store) transcriptAppend(ctx context.Context, db memorySQL, a memoryRow, scope string) (any, error) {
	rows, _ := a["rows"].([]any)
	if len(rows) == 0 || len(rows) > 512 {
		return nil, fmt.Errorf("原文批次为空或过大")
	}
	now := s.now()
	written := 0
	for _, raw := range rows {
		r, _ := raw.(map[string]any)
		key, err := memClean(r["key"], 200, "会话键", true)
		if err != nil {
			return nil, err
		}
		role := memString(r["role"])
		if !transcriptRole(role) {
			return nil, fmt.Errorf("不支持的原文角色")
		}
		pos := memInt(r["pos"])
		if pos < 0 {
			return nil, fmt.Errorf("原文位置无效")
		}
		owner, err := memoryOne(ctx, db, "SELECT scope FROM transcript_scopes WHERE session=?", key)
		if err != nil {
			return nil, err
		}
		if owner != nil && owner["scope"] != scope {
			return nil, fmt.Errorf("原文会话属于其它项目")
		}
		if err = memoryExec(ctx, db, "INSERT OR IGNORE INTO transcript_scopes VALUES(?,?)", key, scope); err != nil {
			return nil, err
		}
		at := memInt(r["at"])
		if at <= 0 {
			at = now
		}
		content := memString(r["content"])
		truncated := 0
		if v, _ := r["truncated"].(bool); v {
			truncated = 1
		}
		if limited := memSlice(content, transcriptRowLimit); limited != content {
			content, truncated = limited, 1
		}
		prior, err := memoryOne(ctx, db, "SELECT role,content FROM transcript WHERE session=? AND pos=?", key, pos)
		if err != nil {
			return nil, err
		}
		if prior != nil && (prior["role"] != role || prior["content"] != content) {
			return nil, fmt.Errorf("原文位置已被不同内容占用")
		}
		if err = memoryExec(ctx, db, "INSERT OR IGNORE INTO transcript(session,pos,at,role,name,content,truncated) VALUES(?,?,?,?,?,?,?)", key, pos, at, role, memSlice(memString(r["name"]), 120), content, truncated); err != nil {
			return nil, err
		}
		if payload := memString(r["payload"]); payload != "" {
			if !json.Valid([]byte(payload)) {
				return nil, fmt.Errorf("完整原文消息格式无效")
			}
			digest := memHash(payload)
			previous, e := memoryOne(ctx, db, "SELECT digest FROM transcript_payloads WHERE session=? AND pos=?", key, pos)
			if e != nil {
				return nil, e
			}
			if previous != nil && previous["digest"] != digest {
				return nil, fmt.Errorf("原文重试内容不一致")
			}
			if err = memoryExec(ctx, db, "INSERT OR IGNORE INTO transcript_payloads VALUES(?,?,?,?)", key, pos, payload, digest); err != nil {
				return nil, err
			}
		}
		if err = memoryExec(ctx, db, "INSERT INTO transcript_sessions(session,started,updated,covered) VALUES(?,?,?,0) ON CONFLICT(session) DO UPDATE SET updated=excluded.updated", key, at, at); err != nil {
			return nil, err
		}
		written++
	}
	return memoryRow{"ok": true, "rows": written}, nil
}

// 旧版 os-continuity 是 CompactSummary JSON；迁移时转成人能读、模型也好读的分条文字。
func readableContinuity(raw string) string {
	var summary struct {
		Goals         []string `json:"goals"`
		Constraints   []string `json:"constraints"`
		Decisions     []string `json:"decisions"`
		Progress      []string `json:"progress"`
		CriticalFacts []string `json:"critical_facts"`
		OpenTasks     []string `json:"open_tasks"`
		NextSteps     []string `json:"next_steps"`
		Uncertainties []string `json:"uncertainties"`
	}
	if json.Unmarshal([]byte(raw), &summary) != nil || len(summary.Goals) == 0 {
		return strings.TrimSpace(raw)
	}
	parts := []string{}
	for _, group := range []struct {
		name  string
		items []string
	}{{"目标", summary.Goals}, {"约束与偏好", summary.Constraints}, {"决定", summary.Decisions}, {"进展", summary.Progress}, {"关键事实", summary.CriticalFacts}, {"没做完的事", summary.OpenTasks}, {"下一步", summary.NextSteps}, {"不确定", summary.Uncertainties}} {
		if len(group.items) > 0 {
			parts = append(parts, group.name+"：\n- "+strings.Join(group.items, "\n- "))
		}
	}
	return strings.Join(parts, "\n")
}

func (s *Store) fastMigrate(ctx context.Context, db memorySQL, scope string) error {
	state, err := memoryOne(ctx, db, "SELECT migrated FROM fast_memory_state WHERE id=1")
	if err != nil || state == nil || memInt(state["migrated"]) != 0 {
		return err
	}
	now := s.now()
	facts, err := memoryRows(ctx, db, "SELECT kind,title,content FROM memories WHERE id<>'os-continuity' AND status='active' AND scope IN ('global',?) AND kind IN ('preference','fact','decision','plan') ORDER BY updated DESC,id LIMIT 30", scope)
	if err != nil {
		return err
	}
	names := map[string]string{"preference": "偏好", "fact": "事实", "decision": "决定", "plan": "计划"}
	lines := []string{}
	for _, r := range facts {
		lines = append(lines, "- ["+names[memString(r["kind"])]+"] "+memSlice(memString(r["title"]), 80)+"："+memSlice(strings.Join(strings.Fields(memString(r["content"])), " "), 240))
	}
	if len(lines) > 0 {
		if err = memoryExec(ctx, db, "INSERT INTO fast_memory(kind,content,created,source) VALUES('pinned',?,?,'migrated')", strings.Join(lines, "\n"), now); err != nil {
			return err
		}
	}
	old, err := memoryOne(ctx, db, "SELECT content,updated FROM memories WHERE id='os-continuity' AND status='active'")
	if err != nil {
		return err
	}
	if old != nil {
		if body := memSlice(readableContinuity(memString(old["content"])), fastSegmentLimit); body != "" {
			at := memInt(old["updated"])
			if err = memoryExec(ctx, db, "INSERT INTO fast_memory(kind,content,created,first_at,last_at,source) VALUES('segment',?,?,?,?,'migrated')", "（旧版连续记忆，换用记忆段时迁入）\n"+body, now, at, at); err != nil {
				return err
			}
		}
	}
	return memoryExec(ctx, db, "UPDATE fast_memory_state SET migrated=1,version=version+1 WHERE id=1")
}

func (s *Store) fastSnapshot(ctx context.Context, db memorySQL, scope string) (any, error) {
	if err := s.fastMigrate(ctx, db, scope); err != nil {
		return nil, err
	}
	state, err := memoryOne(ctx, db, "SELECT version FROM fast_memory_state WHERE id=1")
	if err != nil {
		return nil, err
	}
	pinned, err := memoryOne(ctx, db, "SELECT content FROM fast_memory WHERE kind='pinned' AND status='active' ORDER BY id DESC LIMIT 1")
	if err != nil {
		return nil, err
	}
	rows, err := memoryRows(ctx, db, "SELECT * FROM (SELECT id,created,content,source,first_at,last_at FROM fast_memory WHERE kind='segment' AND status='active' ORDER BY id DESC LIMIT ?) ORDER BY id ASC", fastSnapshotSegment)
	if err != nil {
		return nil, err
	}
	segments := []memoryRow{}
	for _, r := range rows {
		segments = append(segments, memoryRow{"id": memInt(r["id"]), "created": memInt(r["created"]), "content": memString(r["content"]), "source": memString(r["source"]), "first_at": memInt(r["first_at"]), "last_at": memInt(r["last_at"])})
	}
	return memoryRow{"ok": true, "version": memInt(state["version"]), "pinned": memString(pinned["content"]), "segments": segments}, nil
}

func (s *Store) fastAppend(ctx context.Context, db memorySQL, a memoryRow) (any, error) {
	key, err := memClean(a["key"], 200, "会话键", true)
	if err != nil {
		return nil, err
	}
	body := strings.TrimSpace(memString(a["content"]))
	if body == "" {
		return nil, fmt.Errorf("记忆段为空")
	}
	body = memSlice(body, fastSegmentLimit)
	source, err := memClean(a["source"], 40, "来源", false)
	if err != nil {
		return nil, err
	}
	first, last := memInt(a["first_pos"]), memInt(a["last_pos"])
	if first < 0 || last < first {
		return nil, fmt.Errorf("记忆段范围无效")
	}
	// 同一事务内查重：主/潜意识或重试覆盖同一原文时，活跃段只留一份。
	existing, err := memoryOne(ctx, db, "SELECT id,first_pos,last_pos FROM fast_memory WHERE kind='segment' AND status='active' AND session=? AND first_pos<=? AND last_pos>=? ORDER BY id LIMIT 1", key, last, first)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return memoryRow{"ok": true, "id": memInt(existing["id"]), "deduplicated": true, "first_pos": memInt(existing["first_pos"]), "last_pos": memInt(existing["last_pos"])}, nil
	}
	now := s.now()
	span, err := memoryOne(ctx, db, "SELECT min(at) first_at,max(at) last_at FROM transcript WHERE session=? AND pos BETWEEN ? AND ?", key, first, last)
	if err != nil {
		return nil, err
	}
	firstAt, lastAt := memInt(span["first_at"]), memInt(span["last_at"])
	if firstAt <= 0 {
		firstAt, lastAt = now, now
	}
	if err = memoryExec(ctx, db, "INSERT INTO fast_memory(kind,content,created,session,first_pos,last_pos,first_at,last_at,source) VALUES('segment',?,?,?,?,?,?,?,?)", body, now, key, first, last, firstAt, lastAt, source); err != nil {
		return nil, err
	}
	id, err := memoryOne(ctx, db, "SELECT last_insert_rowid() id")
	if err != nil {
		return nil, err
	}
	if err = s.transcriptCover(ctx, db, key, last+1, now); err != nil {
		return nil, err
	}
	if err = memoryExec(ctx, db, "UPDATE fast_memory_state SET version=version+1 WHERE id=1"); err != nil {
		return nil, err
	}
	return memoryRow{"ok": true, "id": memInt(id["id"])}, nil
}

// 已经并进记忆段（或确认不值得整理）的原文位置只前进不后退。
func (s *Store) transcriptCover(ctx context.Context, db memorySQL, key string, covered, now int64) error {
	return memoryExec(ctx, db, "INSERT INTO transcript_sessions(session,started,updated,covered) VALUES(?,?,?,?) ON CONFLICT(session) DO UPDATE SET covered=max(covered,excluded.covered)", key, now, now, covered)
}

// 找一段上次（或更早）会话里还没整理进记忆段的原文：最旧的会话先来，原文按字数从尾部往前取。
func (s *Store) transcriptPending(ctx context.Context, db memorySQL, a memoryRow) (any, error) {
	current, err := memClean(a["exclude_prefix"], 200, "当前会话", true)
	if err != nil {
		return nil, err
	}
	limit := memClamp(a["limit_chars"], 2000, 400000, PendingDefault)
	pending, err := memoryOne(ctx, db, "SELECT s.session,s.covered,max(t.pos) last_pos FROM transcript_sessions s JOIN transcript t ON t.session=s.session AND t.pos>=s.covered WHERE substr(s.session,1,length(?))<>? GROUP BY s.session ORDER BY s.started ASC LIMIT 1", current, current)
	if err != nil {
		return nil, err
	}
	if pending == nil || pending["session"] == nil {
		return memoryRow{"ok": true, "key": ""}, nil
	}
	key, covered := memString(pending["session"]), memInt(pending["covered"])
	rows, err := memoryRows(ctx, db, "SELECT pos,at,role,name,content,truncated FROM transcript WHERE session=? AND pos>=? ORDER BY pos DESC LIMIT 2000", key, covered)
	if err != nil {
		return nil, err
	}
	out, used, omitted := []memoryRow{}, 0, 0
	for _, r := range rows {
		n := len([]rune(memString(r["content"]))) + 16
		if used+n > limit && len(out) > 0 {
			omitted++
			continue
		}
		used += n
		out = append(out, r)
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return memoryRow{"ok": true, "key": key, "covered": covered, "last": memInt(pending["last_pos"]), "rows": out, "omitted": omitted}, nil
}

// 以前各次会话里还没整理的原文一共有多少（不含当前会话）：启动时据此决定要不要整理。
func (s *Store) transcriptBacklog(ctx context.Context, db memorySQL, a memoryRow) (any, error) {
	current, err := memClean(a["exclude_prefix"], 200, "当前会话", true)
	if err != nil {
		return nil, err
	}
	row, err := memoryOne(ctx, db, "SELECT count(*) n,coalesce(sum(length(t.content)),0) chars FROM transcript_sessions s JOIN transcript t ON t.session=s.session AND t.pos>=s.covered WHERE substr(s.session,1,length(?))<>?", current, current)
	if err != nil {
		return nil, err
	}
	return memoryRow{"ok": true, "rows": memInt(row["n"]), "chars": memInt(row["chars"])}, nil
}

func (s *Store) transcriptSkip(ctx context.Context, db memorySQL, a memoryRow) (any, error) {
	key, err := memClean(a["key"], 200, "会话键", true)
	if err != nil {
		return nil, err
	}
	covered := memInt(a["covered"])
	if covered < 0 {
		return nil, fmt.Errorf("原文位置无效")
	}
	return memoryRow{"ok": true}, s.transcriptCover(ctx, db, key, covered, s.now())
}
