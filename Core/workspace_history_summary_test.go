// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestHistoryToolSummaryReadsTheMeaningfulArgument; repeat
// Impact: python -B scripts/code-atlas.py show Core/workspace_history_summary_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "testing"

func TestHistoryToolSummaryReadsTheMeaningfulArgument(t *testing.T) {
	cases := []struct{ tool, input, want string }{
		{"exec_command", `{"cmd":"node verify.cjs\nsecond line","description":"只读核验最终成果"}`, "只读核验最终成果"},
		{"exec_command", `{"cmd":"go test ./...\nmore"}`, "go test ./... …"},
		{"workspace", `{"action":"canvas_document","title":"升级交付报告","format":"md"}`, "canvas_document · 升级交付报告"},
		{"workspace", `{"action":"canvas_inspect"}`, "canvas_inspect"},
		{"apply_patch", "*** Begin Patch\n*** Update File: a/b.go\n@@\n*** Add File: c.md\n*** End Patch", "a/b.go、c.md"},
		{"update_plan", `{"summary":"交付并核验","plan":[]}`, "交付并核验"},
		{"update_plan", `{"action":"create","objective":"实现并验证文件恢复"}`, "create · 实现并验证文件恢复"},
		{"update_plan", `{"action":"update","changes":[{"op":"revise","text":"读取固定输入"}]}`, "update · 修订步骤：读取固定输入"},
		{"update_plan", `{"action":"update","changes":[{"op":"insert","new_step":{"text":"核对实际产物"}},{"op":"set_status","status":"completed"}]}`, "update · 添加步骤：核对实际产物；更新步骤状态：已完成"},
		{"other", "plain text input", "plain text input"},
		{"other", "", ""},
	}
	for _, c := range cases {
		if got := historyToolSummary(c.tool, c.input); got != c.want {
			t.Errorf("%s %q: got %q want %q", c.tool, c.input, got, c.want)
		}
	}
	long := historyToolSummary("x", `{"description":"`+string(make([]rune, 0))+repeat("很长", 120)+`"}`)
	if n := len([]rune(long)); n != historySummaryRunes {
		t.Fatalf("summary not bounded: %d", n)
	}
}

func repeat(s string, n int) string {
	out := ""
	for i := 0; i < n; i++ {
		out += s
	}
	return out
}
