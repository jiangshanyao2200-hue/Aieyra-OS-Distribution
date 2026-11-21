// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/memoryservice/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: dreamPrivate; dreamExcluded; memoryDreamWords; dream
// Impact: python -B scripts/code-atlas.py show Core/memoryservice/dream.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package memory

import (
	"context"
	"crypto/sha256"
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

var dreamPrivate = regexp.MustCompile(`(?i)https?://\S+|\S+@\S+|\b(?:sk-|Bearer\s+)\S+`)
var dreamExcluded = strings.Fields("记忆 计划 保存 测试 验证 模型 参数 设置 接口 需要 已经 完成 内容 回复 今天 昨天 明天 自己 应该 可能 可以 一个 进行 api key token password secret")

// Only bounded, visible memory supplies fictional imagery. No current task or
// secret-like token is eligible; dreams never become factual continuity.
func memoryDreamWords(recent []memoryRow, old []string) []string {
	parts := []string{}
	for _, r := range recent {
		parts = append(parts, memString(r["title"]))
	}
	for _, r := range recent {
		parts = append(parts, memSlice(memString(r["content"]), 500))
	}
	safe := dreamPrivate.ReplaceAllString(strings.Join(parts, " "), " ")
	candidates := memoryTokens.FindAllString(safe, -1)
	candidates = append(candidates, old...)
	candidates = append(candidates, memoryTerms(safe)...)
	out := []string{}
	for _, word := range candidates {
		lower := strings.ToLower(word)
		valid := len([]rune(word)) >= 2 && len([]rune(word)) <= 12
		for _, r := range word {
			if unicode.IsDigit(r) || r == '_' {
				valid = false
			}
		}
		for _, v := range append(append([]string{}, memoryStop...), dreamExcluded...) {
			if lower == v {
				valid = false
			}
		}
		for _, v := range out {
			if strings.Contains(v, word) || strings.Contains(word, v) {
				valid = false
			}
		}
		if valid {
			out = append(out, word)
			if len(out) == 5 {
				break
			}
		}
	}
	return out
}

func (s *Store) dream(ctx context.Context, db memorySQL, a memoryRow, scope string) (any, error) {
	now := s.now()
	mode := memString(a["mode"])
	if mode == "ack" || mode == "release" {
		id, err := memClean(a["id"], 80, "梦境ID", true)
		if err != nil {
			return nil, err
		}
		r, err := memoryOne(ctx, db, "SELECT * FROM dreams WHERE id=?", id)
		if err != nil {
			return nil, err
		}
		if r == nil || r["scope"] != scope || memString(a["claim"]) == "" || a["claim"] != r["claim"] || memInt(r["lease"]) <= now {
			return nil, fmt.Errorf("梦境领取凭证不匹配或已过期")
		}
		told := int64(0)
		if mode == "ack" {
			told = now
		}
		return memoryRow{"ok": true}, memoryExec(ctx, db, "UPDATE dreams SET told=?,claim='',lease=0 WHERE id=?", told, id)
	}
	last, err := memoryOne(ctx, db, "SELECT * FROM dreams WHERE scope=? ORDER BY created DESC LIMIT 1", scope)
	if err != nil {
		return nil, err
	}
	latest, err := memoryOne(ctx, db, "SELECT updated FROM memories WHERE scope IN ('global',?) AND updated<? ORDER BY updated DESC LIMIT 1", scope, s.startedAt)
	if err != nil {
		return nil, err
	}
	// 记忆系统 M-B/M-C：梦由潜意识写（dream_write），领取时 generate=false 不再用模板拼凑；旧调用方仍按原规则生成。
	generate := a["generate"] != false
	if generate && (last == nil || memInt(last["told"]) > 0 && now-memInt(last["told"]) > 6*3600000) && latest != nil && memInt(latest["updated"]) > memInt(last["watermark"]) {
		recent, e := memoryRows(ctx, db, "SELECT title,content FROM memories WHERE scope IN ('global',?) AND updated<? ORDER BY updated DESC LIMIT 12", scope, s.startedAt)
		if e != nil {
			return nil, e
		}
		rows, e := memoryRows(ctx, db, "SELECT term FROM keywords WHERE scope IN ('global',?) AND last_seen<? ORDER BY count DESC,last_seen DESC LIMIT 32", scope, s.startedAt)
		if e != nil {
			return nil, e
		}
		old := []string{}
		for _, r := range rows {
			old = append(old, memString(r["term"]))
		}
		words := memoryDreamWords(recent, old)
		if len(words) >= 2 {
			x, y := words[0], words[1]
			variants := []string{"梦里，" + x + "变成一张会发光的地图，" + y + "是地图边缘的一扇小窗。", "昨晚的梦像一段散步：我沿着" + x + "走了一会儿，转角遇见了" + y + "。", "有个小小的梦：" + x + "和" + y + "坐在同一片云上，慢慢飘过一座安静的城。", "梦里有一间书店，书页写着" + x + "，翻过去却成了" + y + "。"}
			hash := sha256.Sum256([]byte(fmt.Sprintf("%s:%d", scope, memInt(latest["updated"]))))
			body := variants[int(hash[0])%len(variants)]
			last = memoryRow{"id": newID(), "content": body, "created": now, "watermark": latest["updated"], "told": int64(0), "claim": "", "lease": int64(0)}
			if err = memoryExec(ctx, db, "INSERT INTO dreams(id,scope,content,created,watermark) VALUES(?,?,?,?,?)", last["id"], scope, body, now, last["watermark"]); err != nil {
				return nil, err
			}
			if err = memoryExec(ctx, db, "DELETE FROM dreams WHERE scope=? AND told>0 AND id NOT IN (SELECT id FROM dreams WHERE scope=? ORDER BY created DESC LIMIT 32)", scope, scope); err != nil {
				return nil, err
			}
		}
	}
	if last == nil || memInt(last["told"]) > 0 {
		return memoryRow{"ok": true, "dream": nil}, nil
	}
	dream := memoryRow{"id": last["id"], "content": strings.TrimSuffix(strings.TrimSpace(memString(last["content"])), "只是记忆的联想。"), "fiction": true}
	if mode == "claim" {
		if memInt(last["lease"]) > now {
			return memoryRow{"ok": true, "dream": nil}, nil
		}
		claim := newID()
		if err = memoryExec(ctx, db, "UPDATE dreams SET claim=?,lease=? WHERE id=?", claim, now+120000, last["id"]); err != nil {
			return nil, err
		}
		dream["claim"] = claim
	}
	return memoryRow{"ok": true, "dream": dream}, nil
}
