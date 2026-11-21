// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestReopenedGreetingKeepsMessageBoundaryAcrossGenerationReuse; TestGreetingAnchorSkipsInvisibleFailuresAndWithdrawals; TestGreetingBeforeAnyMessageHasExplicitEmptyBoundary
// Impact: python -B scripts/code-atlas.py show Core/workspace_greeting_scope_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"testing"
)

func TestReopenedGreetingKeepsMessageBoundaryAcrossGenerationReuse(t *testing.T) {
	w := &Workspace{
		host: &WorkspaceHost{mode: HostOS, recentReopen: true, reopenStamp: shutdownStamp{Greeting: "previous greeting", GreetingAfter: 1}},
		state: workspaceState{Messages: []workspaceMessage{
			{ID: "old-user", From: "user", To: WorkspaceMatrix, Generation: 1, State: "completed"},
			{ID: "old-answer", From: WorkspaceMatrix, To: "user", Generation: 1, State: "completed", Text: "previous response"},
		}},
	}
	if !w.resumeRecentReopen(1) || w.greeting.AfterMessageID != "old-answer" {
		t.Fatal("greeting did not bind the retained message boundary", w.greeting)
	}
	for _, generation := range []int{0, 1} {
		w.state.Messages = append(w.state.Messages, workspaceMessage{ID: "new-user", From: "user", To: WorkspaceMatrix, Generation: generation})
		if w.greeting.AfterMessageID != "old-answer" {
			t.Fatal("new input displaced the old greeting", w.greeting)
		}
	}
}

func TestGreetingAnchorSkipsInvisibleFailuresAndWithdrawals(t *testing.T) {
	w := &Workspace{state: workspaceState{Messages: []workspaceMessage{
		{ID: "visible-user", From: "user", To: WorkspaceMatrix, State: "completed", Text: "hello"},
	}}}
	for _, state := range []string{"failed", "cancelled", "timed_out", "interrupted", "persistence_failed", "commentary"} {
		w.state.Messages = append(w.state.Messages, workspaceMessage{ID: state, From: WorkspaceMatrix, To: "user", State: state, Text: "not displayed in chat"})
	}
	w.state.Messages = append(w.state.Messages,
		workspaceMessage{ID: "empty-answer", From: WorkspaceMatrix, To: "user", State: "completed", Text: "  "},
		workspaceMessage{ID: "withdrawn-user", From: "user", To: WorkspaceMatrix, State: "withdrawn", Text: "withdrawn"},
	)
	if got := w.greetingAnchorLocked(); got != "visible-user" {
		t.Fatalf("greeting anchored to invisible row %q", got)
	}
}

func TestGreetingBeforeAnyMessageHasExplicitEmptyBoundary(t *testing.T) {
	data, err := json.Marshal(WorkspaceGreeting{State: "online", Text: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(data, &body); err != nil {
		t.Fatal(err)
	}
	if value, ok := body["after_message_id"]; !ok || value != "" {
		t.Fatal("an empty authoritative boundary must differ from a legacy generation-only response", string(data))
	}
}
