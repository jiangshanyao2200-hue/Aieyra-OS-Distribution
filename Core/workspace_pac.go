// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: pacPacket; pacSnapshot; memoryResult; readPAC; refreshPACProfile; renderPAC; renderPACProfile; pacBoundaryKey; pacBoundary; pacCompleteRange; sealPAC; pacCheckpoint; pacSealReceiptObservation; pacTool; persistPACOriginals; recoverPAC; pacContextBudget
// Impact: python -B scripts/code-atlas.py show Core/workspace_pac.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	contextpolicy "github.com/aieyra/aieyra-os/agent/official/Eyra/context"
)

// A request keeps this snapshot fixed until a successful seal/merge boundary.
// Effective preferences are a projection of canonical records, appended at the
// request tail so a correction does not invalidate the large history prefix.
type pacPacket = contextpolicy.Packet
type pacSnapshot struct {
	OK               bool        `json:"ok"`
	Version          int64       `json:"version"`
	Packets          []pacPacket `json:"packets"`
	Profile          []memoryRow `json:"profile"`
	HasMore          bool        `json:"has_more"`
	ProfileMore      bool        `json:"profile_has_more"`
	MergeRecommended bool        `json:"merge_recommended"`
}

func memoryResult(raw json.RawMessage, err error) (memoryRow, error) {
	if err != nil {
		return nil, err
	}
	var out memoryRow
	if err = json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	if out["ok"] != true {
		return nil, fmt.Errorf("%s", memString(out["error"]))
	}
	return out, nil
}

func (w *Workspace) readPAC(ctx context.Context) (pacSnapshot, error) {
	var out pacSnapshot
	raw, err := w.memory(ctx, map[string]any{"action": "pac_snapshot"})
	if _, err = memoryResult(raw, err); err != nil {
		return out, err
	}
	err = json.Unmarshal(raw, &out)
	return out, err
}

func (w *Workspace) refreshPACProfile(ctx context.Context, snapshot *pacSnapshot) error {
	raw, err := w.memory(ctx, map[string]any{"action": "pac_profile"})
	if _, err = memoryResult(raw, err); err != nil {
		return err
	}
	var fresh pacSnapshot
	if err = json.Unmarshal(raw, &fresh); err != nil {
		return err
	}
	snapshot.Profile, snapshot.ProfileMore = fresh.Profile, fresh.ProfileMore
	return nil
}

func renderPAC(s pacSnapshot, budget int) string {
	return contextpolicy.RenderPackets(s.Packets, s.HasMore, budget, runtimePrompt("Matrix/记忆/PAC目录.txt"))
}

func renderPACProfile(s pacSnapshot) string {
	records := make([]json.RawMessage, len(s.Profile))
	for i, row := range s.Profile {
		records[i] = rawJSON(row)
	}
	return contextpolicy.RenderProfile(records, s.ProfileMore, runtimePrompt("Matrix/记忆/当前偏好.txt"))
}

// Model supplies meaning; only the host owns source positions and the exact
// checkpoint. The seal call itself and its result stay in the active tail.
type pacBoundaryKey struct{}
type pacBoundary struct {
	workspace  *Workspace
	agent      string
	history    []Message
	covered    int
	plan       *PlanState
	previous   *Checkpoint
	exclusive  bool
	checkpoint *Checkpoint
	refresh    bool
}

func pacCompleteRange(messages []Message) bool { return contextpolicy.CompleteRange(messages) }

func (w *Workspace) sealPAC(ctx context.Context, agent string, history []Message, first, end int, title, content, keywords string) (string, error) {
	if first < 0 || end > len(history) || end <= first || !pacCompleteRange(history[first:end]) {
		return "", fmt.Errorf("封存必须覆盖完整消息和工具批次，原上下文已保留")
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	key := w.transcriptKey(agent)
	if err := w.persistPACOriginals(ctx, key, history, first, end); err != nil {
		return "", err
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	request := fmt.Sprintf("seal:%s:%d:%d", key, first, end)
	r, err := memoryResult(w.memory(ctx, map[string]any{"action": "pac_seal", "key": key, "first_pos": first, "last_pos": end - 1, "title": title, "content": content, "keywords": keywords, "request_id": request}))
	if err != nil {
		return "", err
	}
	return memString(r["id"]), nil
}

func pacCheckpoint(previous *Checkpoint, history []Message, first, end int, id, body string, plan *PlanState) *Checkpoint {
	cp := &Checkpoint{First: first, Covered: end, Packet: id, PacketText: body, Plan: ClonePlan(plan)}
	cp.keepUserOriginals(previous, history[first:end])
	cp.Compression = &ContextCompression{BeforeTokens: EstimateMessages(history[first:end]), AfterTokens: EstimateMessages([]Message{{Role: RoleUser, Content: body}, cp.Message()})}
	return cp
}

func pacSealReceiptObservation(cp *Checkpoint, newlyCovered []Message, redact func(string) string) Message {
	const maxReceipts, maxBytes = 3, 4096
	savedTokens := cp.Compression.BeforeTokens - cp.Compression.AfterTokens
	if savedTokens <= 0 {
		return Message{}
	}
	type receipt struct {
		Tool   string `json:"tool"`
		CallID string `json:"call_id"`
		Output string `json:"output"`
	}
	payload := struct {
		PACID   string    `json:"pac_id"`
		Results []receipt `json:"results"`
	}{PACID: cp.Packet}
	var observation Message
	for i := len(newlyCovered) - 1; i >= 0 && len(payload.Results) < maxReceipts; i-- {
		m := newlyCovered[i]
		if m.Role != RoleTool || m.Name == "" || m.Name == "memory" || m.ToolCallID == "" || m.Content == "" || len(m.Content) > maxBytes {
			continue
		}
		payload.Results = append([]receipt{{Tool: m.Name, CallID: m.ToolCallID, Output: redact(m.Content)}}, payload.Results...)
		candidate := Message{Role: RoleUser, Name: "sealed_tool_receipts", Content: string(rawJSON(payload)), ContextObservation: true}
		if len(candidate.Content) > maxBytes || EstimateMessages([]Message{candidate}) >= savedTokens {
			payload.Results = payload.Results[1:]
			continue
		}
		observation = candidate
	}
	return observation
}

func (w *Workspace) pacTool(ctx context.Context, a memoryRow) (any, error) {
	action := memString(a["action"])
	if action == "seal" || action == "merge" {
		b, _ := ctx.Value(pacBoundaryKey{}).(*pacBoundary)
		if b == nil || b.workspace != w || !b.exclusive {
			return nil, fmt.Errorf("封存/合并须单独成一次回复：这次回复只能有这一个 memory 调用，不能与其他工具同批；本次未执行，请单独重发")
		}
		if action == "seal" {
			id, err := w.sealPAC(ctx, b.agent, b.history, b.covered, len(b.history), memString(a["title"]), memString(a["content"]), memString(a["keywords"]))
			if err != nil {
				return nil, err
			}
			b.checkpoint = pacCheckpoint(b.previous, b.history, b.covered, len(b.history), id, memString(a["content"]), b.plan)
			b.refresh = true
			return memoryRow{"ok": true, "id": id, "covered_messages": len(b.history), "newly_covered_messages": len(b.history) - b.covered, "compression": b.checkpoint.Compression, "originals_preserved": true, "notice": runtimePrompt("Matrix/记忆/封存结果说明.txt")}, nil
		}
		args := map[string]any{"action": "pac_merge", "title": a["title"], "content": a["content"], "keywords": a["keywords"], "children": a["children"], "request_id": a["request_id"], "expected_version": a["expected_version"]}
		// Global legacy packages can only merge with other global roots. The store
		// validates all children; project-specific data never becomes global.
		if a["scope"] == "global" {
			args["scope"] = "global"
		}
		r, err := memoryResult(w.memory(ctx, args))
		b.refresh = err == nil
		return r, err
	}
	aliases := map[string]string{"packets": "pac_search", "packet": "pac_read", "original": "pac_original", "snapshot": "pac_snapshot", "history": "pac_history"}
	if mapped := aliases[action]; mapped != "" {
		args := map[string]any{}
		for k, v := range a {
			args[k] = v
		}
		args["action"] = mapped
		if action == "original" && a["key"] != nil {
			args["action"] = "pac_message"
		}
		return memoryResult(w.memory(ctx, args))
	}
	return nil, fmt.Errorf("未知PAC操作")
}

func (w *Workspace) persistPACOriginals(ctx context.Context, key string, history []Message, first, end int) error {
	// The async writer is only a convenience. Confirm every original here before
	// committing; retries are content checked by the store and never overwrite.
	for start := first; start < end; start += 128 {
		rows := transcriptRows(key, start, history[start:min(end, start+128)], w.manager.redact)
		if _, err := memoryResult(w.memory(ctx, map[string]any{"action": "transcript_append", "rows": rows})); err != nil {
			return err
		}
	}
	return nil
}

func (w *Workspace) recoverPAC(ctx context.Context, agent string, history []Message, previous *Checkpoint, plan *PlanState) (*Checkpoint, error) {
	first := 0
	if previous != nil {
		first = previous.Covered
	}
	key := w.transcriptKey(agent)
	raw, err := w.memory(ctx, map[string]any{"action": "pac_recovery", "key": key, "first_pos": first, "end_pos": len(history)})
	if _, err = memoryResult(raw, err); err != nil {
		return nil, err
	}
	var result struct {
		Packets []struct {
			ID      string `json:"id"`
			Content string `json:"content"`
			Last    int    `json:"last_pos"`
		} `json:"packets"`
	}
	if err = json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	if len(result.Packets) == 0 {
		return nil, nil
	}
	last := result.Packets[len(result.Packets)-1]
	end := last.Last + 1
	if first < 0 || end > len(history) || end <= first || !pacCompleteRange(history[first:end]) {
		return nil, fmt.Errorf("恢复PAC的原文范围不完整，保留上下文")
	}
	if err = w.persistPACOriginals(ctx, key, history, first, end); err != nil {
		return nil, err
	}
	return pacCheckpoint(previous, history, first, end, last.ID, last.Content, plan), nil
}

func pacContextBudget(settings *Settings) ContextBudget {
	// PAC changes where a checkpoint is stored, not the selected compaction
	// target. ContextBudget already reserves output and enforces known limits.
	return settings.ContextBudget()
}
