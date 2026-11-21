// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: continuitySnapshot; readContinuity; rememberOSContinuity
// Impact: python -B scripts/code-atlas.py show Core/workspace_continuity.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

type continuitySnapshot struct {
	OK      bool   `json:"ok"`
	Epoch   int64  `json:"epoch"`
	Version int64  `json:"version"`
	Content string `json:"content"`
}

func (w *Workspace) readContinuity(ctx context.Context) (continuitySnapshot, error) {
	if w.contextMemoryOff.Load() {
		return continuitySnapshot{OK: true, Epoch: -1}, nil
	}
	c, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	raw, err := w.memory(c, map[string]any{"action": "continuity_snapshot"})
	var result continuitySnapshot
	if err == nil {
		err = json.Unmarshal(raw, &result)
	}
	if err == nil && !result.OK {
		err = fmt.Errorf("continuity unavailable")
	}
	return result, err
}

// Ordinary OS conversations remain in RAM. Only a validated semantic summary
// is committed; model work uses the same slots, budget and usage receipts.
func (m *AgentManager) rememberOSContinuity(ctx context.Context, job *agentJob, settings *Settings, epoch int64, request, user, answer string) {
	w := m.workspace
	if w.service == nil || ctx.Err() != nil || w.contextMemoryOff.Load() {
		return
	}
	c, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	saved := false
	defer func() {
		if !saved && ctx.Err() == nil {
			w.recordOutput(WorkspaceMatrix, "本次连续记忆未写入（可能已被修正、遗忘或整理失败）；回复仍可阅读，重要原文请保存为报告。", "commentary")
		}
	}()
	if epoch < 0 {
		return
	}
	maintenance := compactionSettings(settings)
	if maintenance.MaxTokens <= 0 || maintenance.MaxTokens > 4096 {
		maintenance.MaxTokens = 4096
	}
	// A concurrent window may win the revision. Re-read and summarize once more;
	// corrections/forget change the epoch and never permit this task to retry.
	for attempt := 0; attempt < 2; attempt++ {
		snapshot, err := w.readContinuity(c)
		if err != nil || snapshot.Epoch != epoch {
			return
		}
		messages := []Message{
			{Role: RoleUser, Content: runtimePrompt("潜意识/辅助指令/连续记忆.txt") + snapshot.Content},
			{Role: RoleUser, Content: runtimePrompt("潜意识/辅助指令/连续记忆输入.txt") + utf8Prefix(m.redact(user), 16000)},
			{Role: RoleAssistant, Content: utf8Prefix(m.redact(answer), 16000)},
		}
		cp, err := Compact(c, nil, messages, func(callCtx context.Context, input []Message) (Message, string, error) {
			if EstimateMessages(input) > maintenance.ContextBudget().InputLimit() {
				return Message{}, "", fmt.Errorf("continuity input exceeds model capacity")
			}
			result, _, e := m.agentRequest(callCtx, job, maintenance, input, nil, "continuity")
			return result, result.FinishReason, e
		})
		if err != nil {
			return
		}
		body := m.redact(string(rawJSON(cp.Summary)))
		if len(body) > 10000 || c.Err() != nil {
			return
		}
		raw, err := w.memory(c, map[string]any{"action": "continuity_commit", "content": body, "request_id": request, "expected_epoch": epoch, "expected_version": snapshot.Version})
		var result struct {
			OK       bool `json:"ok"`
			Conflict bool `json:"conflict"`
		}
		if err != nil || json.Unmarshal(raw, &result) != nil {
			return
		}
		if result.OK {
			saved = true
			return
		}
		if !result.Conflict {
			return
		}
	}
}
