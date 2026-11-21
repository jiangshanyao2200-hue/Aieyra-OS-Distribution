// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: userOriginals; TestCheckpointKeepsUserOriginals; TestCheckpointUserOriginalsKeepLongInstructions; TestUserOriginalsReachTheModelAndStayStable; TestSummaryProjectionCannotDiscardExecutionOriginals
// Impact: python -B scripts/code-atlas.py show Core/context_user_originals_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func userOriginals(n, from int) []Message {
	out := make([]Message, n)
	for i := range out {
		out[i] = Message{Role: RoleUser, Content: fmt.Sprintf("原话%d", from+i)}
	}
	return out
}

func TestCheckpointKeepsUserOriginals(t *testing.T) {
	// 多次压缩累积，最多 100 条，旧的先走，顺序不变，最新一条不重复。
	var cp *Checkpoint
	for round := 0; round < 3; round++ {
		next := &Checkpoint{}
		next.keepUserOriginals(cp, userOriginals(60, round*60))
		cp = next
	}
	if cp.LastUser != "原话179" || len(cp.RecentUsers) != 99 || cp.RecentUsers[0] != "原话80" || cp.RecentUsers[98] != "原话178" {
		t.Fatalf("%q %d %q", cp.LastUser, len(cp.RecentUsers), cp.RecentUsers[0])
	}
	// 助手消息、回查内容、系统注入的具名消息都不算用户原文。
	next := &Checkpoint{}
	next.keepUserOriginals(nil, []Message{
		{Role: RoleAssistant, Content: "助手"},
		{Role: RoleUser, Content: RecallPrefix() + "回查"},
		{Role: RoleUser, Name: "compaction_state", Content: "检查点"},
		{Role: RoleUser, Content: "真的原话"},
		{Role: RoleUser, Content: "最后一句"},
	})
	if next.LastUser != "最后一句" || len(next.RecentUsers) != 1 || next.RecentUsers[0] != "真的原话" {
		t.Fatalf("%+v", next)
	}
}

func TestCheckpointUserOriginalsKeepLongInstructions(t *testing.T) {
	huge := "开始任务" + strings.Repeat("背景资料。", 2000) + "正文中间的硬约束：只迁移合成数据，不改用户提示词。" + strings.Repeat("设计细节。", 2000) + "原文结束"
	cp := &Checkpoint{}
	cp.keepUserOriginals(nil, []Message{{Role: RoleUser, Content: huge}, {Role: RoleUser, Content: "后面一句"}})
	if len(cp.RecentUsers) != 1 || cp.RecentUsers[0] != huge || !strings.Contains(cp.Message().Content, "正文中间的硬约束") {
		t.Fatal("long original was truncated or hidden from model")
	}
	for i := 0; i < 3; i++ {
		next := &Checkpoint{}
		next.keepUserOriginals(cp, []Message{{Role: RoleUser, Content: fmt.Sprintf("第%d次纠正：保留原要求", i)}})
		cp = next
	}
	if cp.RecentUsers[0] != huge || cp.LastUser != "第2次纠正：保留原要求" {
		t.Fatal("successive compaction lost a long original or correction")
	}
	raw, err := json.Marshal(cp)
	var restored Checkpoint
	if err != nil || json.Unmarshal(raw, &restored) != nil || restored.RecentUsers[0] != huge {
		t.Fatal("restart lost exact original")
	}

	// 工作中补充的话也算原文；成员发来的、系统提醒不算。
	head, _, _ := strings.Cut(runtimePrompt("Matrix/辅助指令/用户补充消息.txt"), "%d")
	cp = &Checkpoint{}
	cp.keepUserOriginals(nil, []Message{
		{Role: RoleUser, Name: "workspace_a", Content: head + "1 条】补充的话"},
		{Role: RoleUser, Name: "workspace_b", Content: "[project]成员的话"},
		{Role: RoleUser, Name: "narration_c", Content: "提醒"},
		{Role: RoleUser, Content: "最后一句"},
	})
	if cp.LastUser != "最后一句" || len(cp.RecentUsers) != 1 || !strings.Contains(cp.RecentUsers[0], "补充的话") {
		t.Fatalf("%+v", cp)
	}
	// Count is bounded; there is no undocumented 32 KiB content cutoff.
	big := make([]Message, 0, 110)
	for i := 0; i < 110; i++ {
		big = append(big, Message{Role: RoleUser, Content: fmt.Sprintf("%03d", i) + strings.Repeat("字", 1000)})
	}
	cp = &Checkpoint{}
	cp.keepUserOriginals(nil, big)
	if len(cp.RecentUsers) != 99 || cp.RecentUsers[0] != big[10].Content || cp.RecentUsers[98] != big[108].Content || cp.LastUser != big[109].Content {
		t.Fatal("did not retain the last 100 full originals in order")
	}
	required := compactRequiredTokens(nil, big, nil)
	if required < EstimateMessages([]Message{cp.Message()}) || required < 32000 {
		t.Fatal("exact originals were not charged to required input budget")
	}
	budget := ContextBudget{Window: 8192, Working: 4096}
	if required <= budget.InputLimit() || budget.AccommodateRequiredInput(required).InputLimit() != budget.InputLimit() {
		t.Fatal("long originals bypassed the model capacity limit")
	}

}

func TestUserOriginalsReachTheModelAndStayStable(t *testing.T) {
	// 三种检查点都带上原文；同一个检查点渲染结果不变，缓存前缀才稳定。
	for _, cp := range []*Checkpoint{
		{Packet: "pac_1", LastUser: "新", RecentUsers: []string{"旧的原话"}},
		{Segment: 3, LastUser: "新", RecentUsers: []string{"旧的原话"}},
		{Summary: CompactSummary{Goals: []string{"g"}}, LastUser: "新", RecentUsers: []string{"旧的原话"}},
	} {
		first := cp.Message()
		if !strings.Contains(first.Content, "recent_user_exact") || !strings.Contains(first.Content, "旧的原话") {
			t.Fatalf("missing: %s", first.Content)
		}
		if again := cp.Message(); again.Content != first.Content {
			t.Fatal("rendering is not stable")
		}
	}
	// 落盘再读回来还在。
	raw, err := json.Marshal(&Checkpoint{Packet: "p", RecentUsers: []string{"原话"}})
	if err != nil {
		t.Fatal(err)
	}
	var back Checkpoint
	if json.Unmarshal(raw, &back) != nil || len(back.RecentUsers) != 1 {
		t.Fatalf("%s", raw)
	}
	// 没有原文时不多字段（提示词里会提到这个名字，所以查的是 JSON 键）。
	if strings.Contains((&Checkpoint{Packet: "p"}).Message().Content, `"recent_user_exact"`) {
		t.Fatal("empty field rendered")
	}
}

func TestSummaryProjectionCannotDiscardExecutionOriginals(t *testing.T) {
	original := "完整约束" + strings.Repeat("中间不能省略。", 12000)
	cp := &Checkpoint{RecentUsers: []string{original}, LastUser: "最后的纠正", Covered: 19, Summary: CompactSummary{Goals: []string{"继续原任务"}}}
	projection := cp.summaryProjection()
	if projection == cp || len(projection.RecentUsers) != 0 || projection.LastUser != cp.LastUser || projection.Covered != cp.Covered || len(projection.Summary.Goals) != 1 {
		t.Fatal("summary projection is not an independent prior summary")
	}
	if len(cp.RecentUsers) != 1 || cp.RecentUsers[0] != original || !strings.Contains(cp.Message().Content, original) {
		t.Fatal("summary request changed the execution checkpoint or original")
	}
}
