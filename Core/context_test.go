// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: summaryFor; TestCompactValidatesBeforeReplacingContext; TestCompactPreservesToolGroupsAndRecentTurns; TestArchiveRetainsExactOriginalAndRecallsDetails; TestRecallLongParagraphAndTurnBoundaries
// Impact: python -B scripts/code-atlas.py show Core/context_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func summaryFor(req []Message) CompactSummary {
	var input struct {
		Digest string `json:"source_digest"`
	}
	_ = json.Unmarshal([]byte(req[1].Content), &input)
	return CompactSummary{SourceDigest: input.Digest, Goals: []string{"继续项目"}, Constraints: []string{"不可改用户资产"}, Decisions: []string{}, Progress: []string{"构建通过"}, CriticalFacts: []string{"端口 8179"}, OpenTasks: []string{"修复显示"}, NextSteps: []string{"验证"}, Uncertainties: []string{}}
}

func TestCompactValidatesBeforeReplacingContext(t *testing.T) {
	for _, mode := range []string{"ok", "truncated", "malformed", "wrong-source", "missing-state", "cancelled", "extra-json"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			cp, err := Compact(ctx, nil, []Message{{Role: RoleUser, Content: "端口必须是 8179"}}, func(ctx context.Context, req []Message) (Message, string, error) {
				s := summaryFor(req)
				if mode == "wrong-source" {
					s.SourceDigest = "wrong"
				}
				if mode == "missing-state" {
					s.OpenTasks = nil
				}
				data, _ := json.Marshal(s)
				if mode == "malformed" {
					data = []byte("{no}")
				}
				if mode == "extra-json" {
					data = append(data, []byte(" {}")...)
				}
				if mode == "cancelled" {
					cancel()
				}
				finish := "stop"
				if mode == "truncated" {
					finish = "length"
				}
				return Message{Content: string(data)}, finish, nil
			})
			if mode == "ok" {
				if err != nil || cp.Covered != 1 {
					t.Fatal(cp, err)
				}
			} else if err == nil || cp != nil {
				t.Fatal("不可应用不完整检查点")
			}
		})
	}
}

func TestCompactPreservesToolGroupsAndRecentTurns(t *testing.T) {
	m := []Message{
		{Role: RoleUser, Content: "旧任务"},
		{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: "read"}, {ID: "check"}}, ReasoningContent: "工具推理"},
		{Role: "tool", ToolCallID: "read", Content: "路径和原文"},
		{Role: "tool", ToolCallID: "check", Content: "验证通过"},
		{Role: RoleAssistant, Content: "已完成"},
		{Role: RoleUser, Content: "继续"},
		{Role: RoleAssistant, Content: "新状态"},
		{Role: RoleUser, Content: "下一步"},
	}
	if cut := CompactCut(m, 2); cut != 5 {
		t.Fatal("拆开工具组", cut)
	}
	m[3].ToolCallID = "unrelated"
	if cut := CompactCut(m, 1); cut != 0 {
		t.Fatal("未完成工具组不能删除", cut)
	}
}

func TestArchiveRetainsExactOriginalAndRecallsDetails(t *testing.T) {
	a, err := NewSessionArchive(filepath.Join(t.TempDir(), "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	m := Message{Role: RoleAssistant, Content: "原始路径 C:\\project\\foo.go\n端口 8179\n\n\x1b[31m控制字符\x1b[0m"}
	if err = a.Append("message", m); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(a.Path)
	if err != nil {
		t.Fatal(err)
	}
	var record struct {
		Kind  string
		Value Message
	}
	if err = json.Unmarshal(data, &record); err != nil {
		t.Fatal(err)
	}
	if record.Value.Content != m.Content {
		t.Fatal("原文被渲染净化篡改")
	}
	if got := Recall([]Message{m}, 1, "端口是多少", 1000); !strings.Contains(got, "8179") {
		t.Fatal("没有恢复实际摘录", got)
	}
	if got := Recall([]Message{m}, 1, "完全无关", 1000); got != "" {
		t.Fatal("无关内容不应追加", got)
	}
}

func TestRecallLongParagraphAndTurnBoundaries(t *testing.T) {
	text := strings.Repeat("无关内容", 5000) + "精确端口为 8179" + strings.Repeat("其他内容", 5000)
	m := []Message{{Role: RoleUser, Content: text}, {Role: RoleUser, Content: RecallPrefix() + "以前的引用"}, {Role: RoleUser, Content: "端口是多少"}}
	got := Recall(m, len(m), "精确端口", 1000)
	if !strings.Contains(got, "8179") || !strings.Contains(got, "局部原文") {
		t.Fatal("长段落中的细节不能被整段跳过")
	}
	if got := Recall(m, len(m), "以前的引用", 1000); got != "" {
		t.Fatal("不应递归检索合成引用", got)
	}
	if cut := CompactCut(m, 1); cut != 1 {
		t.Fatal("近期用户消息与引用应一起保留", cut)
	}
}
