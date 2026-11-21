// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestAskAnswerDisplayMatchesReplyAskWrapper
// Impact: python -B scripts/code-atlas.py show Core/workspace_ask_display_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "testing"

func TestAskAnswerDisplayMatchesReplyAskWrapper(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{"【用户回答你的提问】问：本次报告采用哪种检查方式？ 答：中文质检答复73（写了 中文质检答复73）", "回答：中文质检答复73"},
		{"【用户回答你的提问】问：选哪个？ 答：暖色（选了 A）", "回答：暖色"},
		{"【用户回答你的提问】问：选哪个？ 答：暖色 · 再亮一点（选了 A / 写了 再亮一点）", "回答：暖色 · 再亮一点"},
		{"【用户回答你的提问】问：选哪个？ 答：用户跳过了这个问题，按你的假设继续。假设：先用暖色", "回答：已跳过这个问题，按你的假设继续"},
	} {
		if got, ok := askAnswerDisplay(c.in); !ok || got != c.want {
			t.Fatalf("%q => %q %v", c.in, got, ok)
		}
	}
	for _, text := range []string{"普通消息", "【用户回答你的提问】问：没有答案分隔", "【用户回答你的提问】问：x 答：手写（写了 别的）"} {
		if got, ok := askAnswerDisplay(text); ok || got != text {
			t.Fatalf("user text must stay unchanged: %q => %q", text, got)
		}
	}
	if got := historySupplementText(RoleUser, "workspace_1", "【你工作时用户补充了 1 条】\n[route]\n1. 【用户回答你的提问】问：选哪个？ 答：暖色（选了 A）"); got != "回答：暖色" {
		t.Fatalf("reopened supplement: %q", got)
	}
}
