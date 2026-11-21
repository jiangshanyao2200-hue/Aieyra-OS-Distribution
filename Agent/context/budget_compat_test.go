// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Agent/context/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestBudgetReservesOutputAndCalibrates; TestKnownPrefixUsesActualTokens; TestTokenMeterRelayPrefixDoesNotMultiplyNewContent; TestRequiredInputAutomaticallyFitsWorkingBudget
// Impact: python -B scripts/code-atlas.py show Agent/context/budget_compat_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package context

import (
	"github.com/aieyra/aieyra-os/contracts/protocol"
	"strings"
	"testing"
)

func TestBudgetReservesOutputAndCalibrates(t *testing.T) {
	b := Budget{Window: 10000, Output: 4000, Percent: 75, KeepTurns: 2}
	if b.Threshold() != 3952 {
		t.Fatal(b.Threshold())
	}
	m := TokenMeter{}
	m.Observe(100, 180)
	if m.Estimate([]protocol.Message{{Content: "正文"}}) < EstimateMessages([]protocol.Message{{Content: "正文"}})*19/10 {
		t.Fatal("未按实际输入上调")
	}
}

func TestKnownPrefixUsesActualTokens(t *testing.T) {
	old := []protocol.Message{{Role: protocol.RoleUser, Content: strings.Repeat("中文", 5000)}}
	m := TokenMeter{}
	m.ObserveRequest(old, 5000)
	next := append(append([]protocol.Message(nil), old...), protocol.Message{Role: protocol.RoleAssistant, Content: "新的结果"}, protocol.Message{Role: protocol.RoleUser, Content: "继续"})
	got := m.Estimate(next)
	if got < 5150 || got > 5300 {
		t.Fatalf("旧前缀应使用服务端计数，实际 %d", got)
	}
	next[0].Content = "改过的前缀"
	if m.Estimate(next) >= 5150 {
		t.Fatal("不同前缀误用了旧计数")
	}
}

func TestTokenMeterRelayPrefixDoesNotMultiplyNewContent(t *testing.T) {
	m := TokenMeter{}
	m.Observe(200, 13800)
	if m.Scale > 2 || m.Offset < 13000 {
		t.Fatalf("%+v", m)
	}
	base := []protocol.Message{{Role: protocol.RoleUser, Content: "new compacted checkpoint"}}
	larger := append(append([]protocol.Message(nil), base...), protocol.Message{Role: protocol.RoleTool, Content: strings.Repeat("tool output ", 1000)})
	if m.Estimate(larger)-m.Estimate(base) > (EstimateMessages(larger)-EstimateMessages(base))*2+1 {
		t.Fatal("relay prefix multiplied")
	}
}

func TestRequiredInputAutomaticallyFitsWorkingBudget(t *testing.T) {
	b := Budget{Window: 1050000, Output: 8192, Working: 25000, Percent: 75}
	for _, n := range []int{24000, 27091, b.InputLimit() - 10, b.InputLimit() + 1} {
		got := b.AccommodateRequiredInput(n)
		if got.WorkingLimit() > b.InputLimit() {
			t.Fatal("model capacity exceeded")
		}
		if n > 25000 && n <= b.InputLimit() && got.WorkingLimit() < n {
			t.Fatal("required input blocked")
		}
		if n < b.Threshold() && got.Working != b.Working {
			t.Fatal("normal budget changed")
		}
		if n > b.InputLimit() && got.Working != b.Working {
			t.Fatal("over-capacity input accepted")
		}
	}
	if b.Working != 25000 {
		t.Fatal("configured budget changed")
	}
}
