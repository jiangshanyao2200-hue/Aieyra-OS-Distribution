// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: checkpointText; compactionMessageText; compactionTextPage; compactionSourcePage; compactionKey; compactionPhaseText
// Impact: python -B scripts/code-atlas.py show Core/context_compaction_view.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// Read-only display of committed context maintenance. Original messages remain
// in their archive; even full-history pages retain at most one page of text.
import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

func checkpointText(cp *Checkpoint) string {
	var b strings.Builder
	section := func(title string, rows []string) {
		if len(rows) > 0 {
			b.WriteString(title + "\n" + strings.Join(rows, "\n") + "\n\n")
		}
	}
	if cp.Packet != "" || cp.Segment != 0 {
		if cp.PacketText != "" {
			section("阶段摘要", []string{cp.PacketText})
		} else {
			section("阶段摘要", []string{"旧检查点未保存摘要正文；可从记忆中的原阶段记录查询。"})
		}
	} else {
		s := cp.Summary
		for _, group := range []struct {
			title string
			rows  []string
		}{
			{"目标", s.Goals}, {"约束", s.Constraints}, {"决定", s.Decisions}, {"进展", s.Progress},
			{"关键事实", s.CriticalFacts}, {"待完成", s.OpenTasks}, {"下一步", s.NextSteps}, {"未确定", s.Uncertainties},
		} {
			section(group.title, group.rows)
		}
	}
	if cp.Plan != nil {
		section("保留计划", []string{cp.Plan.Objective})
		for _, phase := range cp.Plan.Phases {
			rows := []string{}
			for _, step := range phase.Steps {
				rows = append(rows, step.Text)
			}
			section(phase.Title, rows)
		}
	}
	section("保留的用户原话", append(append([]string{}, cp.RecentUsers...), cp.LastUser))
	return strings.TrimSpace(b.String())
}

func compactionMessageText(m Message, index int) string {
	role := map[string]string{"user": "用户", "assistant": "助手", "tool": "工具回执"}[string(m.Role)]
	if role == "" {
		role = string(m.Role)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "第 %d 条 · %s\n%s", index+1, role, m.Content)
	for _, call := range m.ToolCalls {
		fmt.Fprintf(&b, "\n调用 %s\n%s", call.Function.Name, call.Function.Arguments)
	}
	return b.String() + "\n\n"
}

type compactionTextPage struct {
	Text       string
	Next, Size int
}

// Offsets address redacted UTF-8 display text, as with ordinary historyReceipt.
// The scan stops at the original event, so later turns cannot change a page.
func compactionSourcePage(ref historyRef, first, end, offset, limit int, redact func(string) string) (compactionTextPage, error) {
	result := compactionTextPage{}
	if offset < 0 || first < 0 || end < first {
		return result, fmt.Errorf("压缩原文范围无效")
	}
	var b strings.Builder
	invalid, filled := false, false
	appendText := func(text string) {
		text = redact(text)
		start := max(0, offset-result.Size)
		if start < len(text) && !filled {
			if !utf8.RuneStart(text[start]) {
				invalid = true
				return
			}
			part := utf8Prefix(text[start:], limit-b.Len())
			b.WriteString(part)
			filled = len(part) < len(text[start:]) || b.Len() == limit
		}
		result.Size += len(text)
	}
	appendText(fmt.Sprintf("压缩的原文 · 第 %d—%d 条\n\n", first+1, end))
	pos, scan := 0, int64(0)
	stop := errors.New("reached compaction event")
	for scan < ref.offset {
		budget := 2 << 20
		next, more, err := historyScan(ref.source, scan, &budget, func(line []byte, current historyRef) error {
			if current.offset >= ref.offset {
				return stop
			}
			var event struct {
				Kind  string          `json:"kind"`
				Value json.RawMessage `json:"value"`
			}
			if err := json.Unmarshal(line, &event); err != nil {
				return err
			}
			messages := []Message{}
			switch event.Kind {
			case "runtime_context":
				update, err := decodeRuntimeContext(event.Value)
				if err != nil {
					return err
				}
				messages = update.Messages
			case "message":
				var m Message
				if err := json.Unmarshal(event.Value, &m); err != nil {
					return err
				}
				messages = append(messages, m)
			case "tool_turn":
				var turn ToolTurn
				if err := json.Unmarshal(event.Value, &turn); err != nil {
					return err
				}
				messages = turn.Messages
			}
			for _, m := range messages {
				if pos >= first && pos < end {
					appendText(compactionMessageText(m, pos))
				}
				pos++
			}
			return nil
		})
		if errors.Is(err, stop) {
			break
		}
		if err != nil {
			return result, err
		}
		if next <= scan || !more {
			break
		}
		scan = next
	}
	if pos < end {
		return result, fmt.Errorf("压缩原文尚未完整读取")
	}
	if invalid || offset > result.Size {
		return result, fmt.Errorf("收据位置无效，请重新展开")
	}
	result.Text = b.String()
	if offset+b.Len() < result.Size {
		result.Next = offset + b.Len()
	}
	return result, nil
}

func compactionKey(id string) string { return "compaction:" + id }

func compactionPhaseText(v *CompactionState) string {
	text := map[string]string{"scheduled": "等待压缩", "running": "正在压缩", "completed": "压缩已提交", "failed": "压缩失败", "cancelled": "压缩已取消", "interrupted": "压缩被中断", "deferred": "压缩已延后", "skipped": "未进行压缩"}[v.State]
	if v.Code != "" {
		text += " · " + v.Code
	}
	return text
}
