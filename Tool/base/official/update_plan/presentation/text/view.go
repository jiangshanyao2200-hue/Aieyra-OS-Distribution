package text

import (
	"strings"

	"github.com/aieyra/aieyra-os/tool/base/official/update_plan/contract"
)

// Summary and Detail format existing state. The client supplies terminal sanitizers.
func Summary(p *contract.PlanState, oneLine func(string) string) string {
	if p == nil || p.Status == "complete" || p.Status == "completed" || p.Status == "cancelled" {
		return ""
	}
	for _, ph := range p.Phases {
		for _, s := range ph.Steps {
			if s.Status == "in_progress" || s.Status == "running" {
				return "◌ " + oneLine(s.Text) + "  · Alt+P"
			}
		}
	}
	if p.Objective != "" {
		return "○ " + oneLine(p.Objective) + "  · Alt+P"
	}
	return ""
}

func Detail(p *contract.PlanState, oneLine, safeText func(string) string, state func(string) (string, string)) string {
	if p == nil {
		return ""
	}
	var text strings.Builder
	text.WriteString(oneLine(p.Objective) + "\n")
	for _, ph := range p.Phases {
		for _, s := range ph.Steps {
			icon, _ := state(s.Status)
			text.WriteString(icon + " " + safeText(s.Text) + "\n")
		}
	}
	return text.String()
}
