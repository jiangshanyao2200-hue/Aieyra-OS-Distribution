// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: chatPageCursor; addRound; conversationChatPage
// Impact: python -B scripts/code-atlas.py show Core/conversation_chat_page.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

type chatPageCursor struct {
	Scope string `json:"scope"`
	Kind  string `json:"kind"`
	Epoch string `json:"epoch"`
	Key   string `json:"key"`
}

func (ix *groupLog) addRound(seq int64, from string) {
	round := int64(0)
	if len(ix.rounds) > 0 {
		round = ix.rounds[len(ix.rounds)-1]
	}
	if from == "user" || from == "eyra" || from == "mother" {
		round = seq
	}
	ix.rounds = append(ix.rounds, round)
}

func (m *AgentManager) conversationChatPage(raw json.RawMessage) (any, error) {
	var p struct {
		ID, Kind, Before string
		LimitRounds      int `json:"limit_rounds"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if p.Kind == "" {
		p.Kind = "conversation"
	}
	if p.Kind != "conversation" && p.Kind != "group" || !sessionIDPattern.MatchString(p.ID) {
		return nil, fmt.Errorf("聊天会话身份无效")
	}
	if p.LimitRounds == 0 {
		p.LimitRounds = 20
	}
	if p.LimitRounds < 1 || p.LimitRounds > 20 {
		return nil, fmt.Errorf("每页最多20轮")
	}
	epoch := ""
	if m.streamProjection != nil {
		epoch = m.streamProjection.epoch
	}
	result := map[string]any{"scope_id": p.ID, "core_epoch": epoch, "revision": 0, "entries": []map[string]any{}, "before": "", "has_more": false, "indexing": false, "reset": false, "warning": ""}
	cursor := chatPageCursor{Scope: p.ID, Kind: p.Kind, Epoch: epoch}
	if p.Before != "" {
		data, err := base64.RawURLEncoding.DecodeString(p.Before)
		var prior chatPageCursor
		if err != nil || len(data) > 4096 || json.Unmarshal(data, &prior) != nil || prior.Scope != p.ID || prior.Kind != p.Kind || prior.Epoch != epoch {
			result["reset"] = true
			return result, nil
		}
		cursor.Key = prior.Key
	}
	rows := []map[string]any{}
	if p.Kind == "group" {
		conversationGroupsMu.Lock()
		defer conversationGroupsMu.Unlock()
		g, err := m.readGroup(p.ID)
		if err != nil {
			return nil, err
		}
		if g.LinkScope != "" {
			return nil, fmt.Errorf("请从所属会话读取协作记录")
		}
		ix, err := m.groupIndex(g)
		if err != nil {
			return nil, err
		}
		hi := g.Seq
		if cursor.Key != "" {
			before, e := strconv.ParseInt(cursor.Key, 10, 64)
			if e != nil || before < 1 || before > g.Seq+1 {
				result["reset"] = true
				return result, nil
			}
			hi = before - 1
		}
		// The durable group log has the user request and all addressed replies.
		// Read bounded chunks backwards; reading never dispatches pending work.
		start, rounds := hi, map[int64]bool{}
		selected := []groupMessage{}
		for start > 0 && len(selected) < 200 {
			lo := max(int64(0), start-200)
			chunk, e := m.groupRange(g, lo, start)
			if e != nil {
				return nil, e
			}
			for i := len(chunk) - 1; i >= 0; i-- {
				msg := chunk[i]
				if msg.Kind == "system" {
					start = msg.Seq - 1
					continue
				}
				round := ix.rounds[msg.Seq-1]
				if !rounds[round] && len(rounds) >= p.LimitRounds {
					break
				}
				start = msg.Seq - 1
				rounds[round] = true
				selected = append(selected, msg)
				if len(selected) >= 200 {
					break
				}
			}
			if len(rounds) >= p.LimitRounds || len(chunk) == 0 {
				break
			}
		}
		for i := len(selected) - 1; i >= 0; i-- {
			msg := selected[i]
			round := strconv.FormatInt(ix.rounds[msg.Seq-1], 10)
			id := fmt.Sprintf("%s:%d", p.ID, msg.Seq)
			if g.ManagedProgram == "coding" && msg.Kind == "brief" {
				rows = append(rows, map[string]any{"id": id, "round_id": p.ID + ":" + round, "sender_id": msg.From, "kind": "brief", "text": m.redact(msg.Brief), "state": "completed", "at": msg.At, "seq": msg.Seq, "generation": msg.SenderGeneration})
				continue
			}
			if g.ManagedProgram == "coding" && msg.From != "user" {
				member := g.member(msg.From)
				parts := strings.Split(msg.Request, ":")
				if member != nil && len(parts) == 5 && parts[0] == "result" && parts[1] == member.Session && parts[3] == "retry" {
					if generation, err := strconv.Atoi(parts[2]); err == nil && generation > 0 {
						id = fmt.Sprintf("live:%s:%d", member.Session, generation)
					}
				}
			}
			rows = append(rows, map[string]any{"id": id, "round_id": p.ID + ":" + round, "sender_id": msg.From, "kind": "message", "text": m.redact(msg.Text), "state": "completed", "at": msg.At, "name": msg.Name, "seq": msg.Seq, "attachments": msg.Attachments})
		}
		result["revision"], result["has_more"] = g.Seq, start > 0
		if len(selected) > 0 {
			cursor.Key = strconv.FormatInt(selected[len(selected)-1].Seq, 10)
		}
	} else {
		value, err := m.conversationHistory(rawJSON(map[string]any{"action": "history", "id": p.ID, "before": cursor.Key, "chat_rounds": p.LimitRounds}))
		if err != nil {
			return nil, err
		}
		page := value.(map[string]any)
		if page["reset"] == true {
			result["reset"] = true
			return result, nil
		}
		entries := page["entries"].([]historyEntry)
		last := map[int]string{}
		states := map[int]string{}
		if record, e := m.Status(m.owner, p.ID); e == nil {
			states[record.Generation] = record.State
			for _, outcome := range record.History {
				states[outcome.Generation] = outcome.State
			}
		}
		for _, row := range entries {
			if row.Kind == "message" && row.Role != "user" {
				last[row.Generation] = row.ID
			}
		}
		for _, row := range entries {
			state := states[row.Generation]
			live := activeAgent(state) || state == "waiting_user"
			failed := state != "" && state != "completed" && !live
			process := row.Role != "user" && (live || failed || last[row.Generation] != row.ID)
			rows = append(rows, map[string]any{"id": row.ID, "round_id": p.ID + ":" + row.Round, "snapshot_id": row.SnapshotID, "sender_id": row.Role, "kind": row.Kind, "text": row.Text, "state": row.State, "process": process, "at": row.At, "generation": row.Generation, "attachments": row.Attachments, "artifacts": row.Artifacts, "text_more": row.TextMore, "receipt": map[string]any{"action": "history_receipt", "id": p.ID, "entry_id": row.ID}})
		}
		cursor.Key, _ = page["before"].(string)
		result["has_more"], result["indexing"], result["warning"] = page["has_more"], page["indexing"], page["warning"]
		if r, e := m.Status(m.owner, p.ID); e == nil {
			result["revision"] = r.Generation
		}
	}
	result["entries"] = rows
	if cursor.Key != "" {
		data, _ := json.Marshal(cursor)
		result["before"] = base64.RawURLEncoding.EncodeToString(data)
	}
	return result, nil
}
