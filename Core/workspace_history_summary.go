// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: historySummaryRunes; patchFileLine; historyToolSummary; historyPlanChanges; historyPatchFiles; historyFirstLine; historyClip
// Impact: python -B scripts/code-atlas.py show Core/workspace_history_summary.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

// 历史中工具调用的一行摘要：只取原始参数里最能说明"做了什么"的字段，
// 有界、单行、经过脱敏；完整输入输出仍按需从原回执读取。

import (
	"encoding/json"
	"regexp"
	"strings"
	"unicode/utf8"
)

const historySummaryRunes = 160

var patchFileLine = regexp.MustCompile(`(?m)^\*\*\* (?:Add|Update|Delete) File: (.+)$`)

func historyToolSummary(tool, input string) string {
	input = strings.TrimSpace(input)
	if input == "" {
		return ""
	}
	if tool == "apply_patch" || strings.HasPrefix(input, "*** Begin Patch") {
		return historyClip(historyPatchFiles(input))
	}
	var args map[string]any
	if json.Unmarshal([]byte(input), &args) != nil {
		return historyClip(historyFirstLine(input))
	}
	text := func(keys ...string) string {
		for _, key := range keys {
			if v, ok := args[key].(string); ok && strings.TrimSpace(v) != "" {
				return historyFirstLine(v)
			}
		}
		return ""
	}
	if patch := text("patch", "input"); strings.HasPrefix(patch, "*** Begin Patch") {
		if raw, _ := args["patch"].(string); raw != "" {
			return historyClip(historyPatchFiles(raw))
		}
		if raw, _ := args["input"].(string); raw != "" {
			return historyClip(historyPatchFiles(raw))
		}
	}
	action := text("action", "operation")
	detail := text("description", "summary", "title", "query", "q", "path", "file", "url", "cmd", "command", "name")
	if tool == "update_plan" {
		if detail == "" {
			detail = text("objective")
		}
		if action == "update" && detail == "" {
			detail = historyPlanChanges(args)
		}
	}
	switch {
	case action != "" && detail != "" && !strings.Contains(detail, action):
		return historyClip(action + " · " + detail)
	case detail != "":
		return historyClip(detail)
	default:
		return historyClip(action)
	}
}

// Distinguish plan edits in the collapsed history without loading or mutating
// the plan. Only the submitted operation and user-visible text are summarized.
func historyPlanChanges(args map[string]any) string {
	changes, _ := args["changes"].([]any)
	labels := map[string]string{"revise": "修订步骤", "insert": "添加步骤", "replace": "替换步骤", "move": "移动步骤", "phase_add": "添加阶段", "phase_revise": "修订阶段", "set_dependencies": "调整依赖", "set_status": "更新步骤状态", "set_lifecycle": "更新计划状态"}
	states := map[string]string{"active": "进行中", "in_progress": "进行中", "running": "进行中", "pending": "待处理", "todo": "待处理", "completed": "已完成", "done": "已完成", "paused": "已暂停", "blocked": "受阻", "deferred": "等待条件", "cancelled": "已取消", "canceled": "已取消"}
	var parts []string
	for _, value := range changes {
		change, ok := value.(map[string]any)
		if !ok {
			continue
		}
		op, _ := change["op"].(string)
		label := labels[op]
		if label == "" {
			continue
		}
		var detail string
		for _, key := range []string{"text", "title"} {
			if text, _ := change[key].(string); strings.TrimSpace(text) != "" {
				detail = historyFirstLine(text)
				break
			}
		}
		if step, ok := change["new_step"].(map[string]any); detail == "" && ok {
			detail, _ = step["text"].(string)
			detail = historyFirstLine(detail)
		}
		if state, _ := change["status"].(string); detail == "" {
			detail = states[state]
		}
		if detail != "" {
			label += "：" + detail
		}
		parts = append(parts, label)
		if len(parts) == 3 {
			if len(changes) > 3 {
				parts = append(parts, "等多处调整")
			}
			break
		}
	}
	return strings.Join(parts, "；")
}

func historyPatchFiles(patch string) string {
	var files []string
	for _, m := range patchFileLine.FindAllStringSubmatch(patch, 6) {
		files = append(files, strings.TrimSpace(m[1]))
	}
	return strings.Join(files, "、")
}

func historyFirstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, "\r\n"); i >= 0 {
		s = strings.TrimSpace(s[:i]) + " …"
	}
	return s
}

func historyClip(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) <= historySummaryRunes {
		return s
	}
	return string([]rune(s)[:historySummaryRunes-1]) + "…"
}
