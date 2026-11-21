// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWorkspaceStreamSeparatesRestoredInstancesWithEqualGenerations; TestWorkspaceOutputPreservesInstanceAndSubmittedTurn; TestWorkspaceLiveBodyKeepsInputOwnerAcrossSupplementCompaction
// Impact: python -B scripts/code-atlas.py show Core/workspace_instance_scope_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import "testing"

func TestWorkspaceStreamSeparatesRestoredInstancesWithEqualGenerations(t *testing.T) {
	w := &Workspace{state: workspaceState{Roles: map[string]string{WorkspaceMatrix: "old-instance"}}, live: map[string]WorkspaceLive{}}
	w.taskRequestStart(WorkspaceMatrix, 1, true, "old-instance")
	w.taskStream(WorkspaceMatrix, 1, Event{Kind: EventDelta, Text: "old body"}, "old-instance")
	w.state.Roles[WorkspaceMatrix] = "new-instance"
	w.taskRequestStart(WorkspaceMatrix, 1, true, "new-instance")
	if live := w.live[WorkspaceMatrix]; live.Text != "" || live.AgentID != "new-instance" || !live.NewBody {
		t.Fatal("restored instance inherited the previous body", live)
	}
	before := w.live[WorkspaceMatrix]
	w.taskRequestStart(WorkspaceMatrix, 1, true, "old-instance")
	w.taskStream(WorkspaceMatrix, 1, Event{Kind: EventDelta, Text: "late old body"}, "old-instance")
	if live := w.live[WorkspaceMatrix]; live.Revision != before.Revision || live.Text != "" {
		t.Fatal("old equal-generation callback mutated the new request", live)
	}
	w.taskStream(WorkspaceMatrix, 1, Event{Kind: EventDelta, Text: "current body"}, "new-instance")
	if live := w.live[WorkspaceMatrix]; live.Text != "current body" || live.AgentID != "new-instance" {
		t.Fatal(live)
	}
}

func TestWorkspaceOutputPreservesInstanceAndSubmittedTurn(t *testing.T) {
	w, _ := testWorkspace(t, nil)
	w.mu.Lock()
	defer w.mu.Unlock()
	w.state.Roles[WorkspaceMatrix] = "new-instance"
	w.state.Messages = []workspaceMessage{
		{ID: "current-user", From: "user", To: WorkspaceMatrix, Text: "current", State: "delivered", Generation: 1, AgentID: "new-instance"},
		{ID: "old-user", From: "user", To: WorkspaceMatrix, Text: "old", State: "delivered", Generation: 1, AgentID: "old-instance"},
	}
	if err := w.recordOutputLocked(WorkspaceMatrix, "new output", "commentary", 1); err != nil {
		t.Fatal(err)
	}
	output := w.state.Messages[len(w.state.Messages)-1]
	if output.AgentID != "new-instance" || output.TurnID != "current-user" {
		t.Fatal("output associated with a different instance", output)
	}
}

func TestWorkspaceLiveBodyKeepsInputOwnerAcrossSupplementCompaction(t *testing.T) {
	w := &Workspace{state: workspaceState{Roles: map[string]string{WorkspaceMatrix: "instance"}, Messages: []workspaceMessage{{ID: "first", From: "user", To: WorkspaceMatrix, Generation: 1, AgentID: "instance", State: "delivered"}}}, live: map[string]WorkspaceLive{}}
	w.taskRequestStart(WorkspaceMatrix, 1, true, "instance")
	w.taskStream(WorkspaceMatrix, 1, Event{Kind: EventDelta, Text: "first reply"}, "instance")
	w.state.Messages = append(w.state.Messages, workspaceMessage{ID: "supplement", From: "user", To: WorkspaceMatrix, Generation: 1, AgentID: "instance", State: "delivered"})
	w.compactionStart(WorkspaceMatrix)
	if live := w.live[WorkspaceMatrix]; live.TurnID != "first" || live.Text != "first reply" {
		t.Fatalf("compaction changed body owner: %#v", live)
	}
	w.taskRequestStart(WorkspaceMatrix, 1, true, "instance")
	if live := w.live[WorkspaceMatrix]; live.TurnID != "supplement" || live.Text != "" || !live.NewBody {
		t.Fatalf("new input borrowed prior body: %#v", live)
	}
	w.taskStream(WorkspaceMatrix, 1, Event{Kind: EventRetry}, "instance")
	w.taskStream(WorkspaceMatrix, 1, Event{Kind: EventDelta, Text: "second reply"}, "instance")
	if live := w.live[WorkspaceMatrix]; live.TurnID != "supplement" || live.Text != "second reply" {
		t.Fatalf("retry lost input owner: %#v", live)
	}
}
