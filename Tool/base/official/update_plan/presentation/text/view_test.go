package text

import (
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/tool/base/official/update_plan/contract"
)

func TestSummaryDistinguishesAcceptanceFromCompletion(t *testing.T) {
	clean := func(s string) string { return strings.Join(strings.Fields(s), " ") }
	p := &contract.PlanState{Objective: "交付\n并验收", Status: "awaiting_acceptance", Phases: []contract.PlanPhase{{Steps: []contract.PlanStep{{Text: "文件已读回", Status: contract.PlanCompleted}}}}}
	if got := Summary(p, clean); !strings.Contains(got, "交付 并验收") {
		t.Fatalf("awaiting acceptance disappeared: %q", got)
	}
	for _, status := range []string{"complete", "completed", "cancelled"} {
		p.Status = status
		if got := Summary(p, clean); got != "" {
			t.Fatalf("terminal plan %s still shown as pending: %q", status, got)
		}
	}
}
