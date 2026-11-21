// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestStartupGreetingSurvivesIdleTitleAndResize; TestPendingHumanUsesCurrentAgentAndGeneration
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/startup_scope_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
)

func TestStartupGreetingSurvivesIdleTitleAndResize(t *testing.T) {
	m := testModel()
	var data snapshot
	data.Greeting.State = "online"
	data.Greeting.Text = "STARTUP_READY"
	m.applySnapshot(pollMsg{data: data})
	for _, size := range [][2]int{{100, 30}, {40, 12}, {120, 40}} {
		m.width, m.height = size[0], size[1]
		m.layout()
		view := ansi.Strip(m.View())
		if !strings.Contains(view, "STARTUP_READY") || m.taskStarted {
			t.Fatalf("startup greeting lost at %v: %q", size, view)
		}
	}
	data.Greeting.Text = ""
	m.applySnapshot(pollMsg{data: data})
	if !strings.Contains(ansi.Strip(m.View()), "AIEYRA") {
		t.Fatal("empty startup lost its fallback title")
	}
}

func TestPendingHumanUsesCurrentAgentAndGeneration(t *testing.T) {
	m := testModel()
	m.taskStarted, m.taskGeneration = true, 7
	if err := json.Unmarshal([]byte(`{"roles":[
		{"id":"child","state":"waiting_user","generation":6,"human_requests":[
			{"id":"old-role","agent_id":"child","state":"waiting_user","generation":6}]},
		{"id":"child","state":"waiting_user","generation":7,"human_requests":[
			{"id":"foreign","agent_id":"sibling","state":"waiting_user","generation":7},
			{"id":"old-human","agent_id":"child","state":"waiting_user","generation":6},
			{"id":"answered","agent_id":"child","state":"answered","generation":7},
			{"id":"current","agent_id":"child","state":"waiting_user","generation":7}]}
	]}`), &m.snapshot); err != nil {
		t.Fatal(err)
	}
	if got := m.pendingHuman(); got == nil || got.ID != "current" {
		t.Fatalf("wrong decision: %+v", got)
	}
	m.snapshot.Roles[1].Humans = m.snapshot.Roles[1].Humans[:3]
	if got := m.pendingHuman(); got != nil {
		t.Fatalf("unrelated decision offered: %+v", got)
	}
}
