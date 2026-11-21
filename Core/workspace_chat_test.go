// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: chatFixture; chatInputs; TestOSChatRetentionCountsSubmissions; TestOSChatRetentionProtectsOutstandingRequests; TestOSChatSnapshotSeparatesLongProcessFromChat; TestOSChatRetiredRequestDoesNotReplay; TestOSChatEnqueueAndCompletionRetentionBoundaries
// Impact: python -B scripts/code-atlas.py show Core/workspace_chat_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"fmt"
	"net/http"
	"testing"
)

func chatFixture(n int) []workspaceMessage {
	var rows []workspaceMessage
	for i := 1; i <= n; i++ {
		id := fmt.Sprintf("u%d", i)
		rows = append(rows,
			workspaceMessage{ID: id, From: "user", To: WorkspaceMatrix, Text: "private " + id, State: "completed", Generation: i},
			workspaceMessage{ID: fmt.Sprintf("a%d", i), TurnID: id, From: WorkspaceMatrix, To: "user", Text: "answer " + id, State: "completed", Generation: i})
	}
	return rows
}

func chatInputs(rows []workspaceMessage) int {
	n := 0
	for _, m := range rows {
		if workspaceChatInput(m) {
			n++
		}
	}
	return n
}

func TestOSChatRetentionCountsSubmissions(t *testing.T) {
	for _, n := range []int{19, 20, 21} {
		t.Run(fmt.Sprint(n), func(t *testing.T) {
			w := &Workspace{host: &WorkspaceHost{mode: HostOS}, state: workspaceState{Messages: chatFixture(n)}}
			// Steering messages may all be delivered in the same generation.
			for i := range w.state.Messages {
				w.state.Messages[i].Generation = 7
			}
			w.state.Messages[4].State = "cancelled"
			w.state.Messages[6].State = "failed"
			w.retainChatLocked()
			if got := chatInputs(w.state.Messages); got != min(20, n) {
				t.Fatalf("inputs %d", got)
			}
			if len(w.state.Messages) != min(20, n)*2 {
				t.Fatal("reply detached from its submission")
			}
			first := "u1"
			if n == 21 {
				first = "u2"
			}
			if w.state.Messages[0].ID != first {
				t.Fatal(w.state.Messages[0])
			}
			if n == 21 {
				old := w.retiredMessages["u1"]
				if old.Message.Text != "" || old.TextHash == "" || old.Message.State != "completed" {
					t.Fatal(old)
				}
			}
		})
	}
}

func TestOSChatRetentionProtectsOutstandingRequests(t *testing.T) {
	for _, state := range []string{"queued", "context", "delivered", "waiting_human", "waiting_user", "running", "cancelling"} {
		t.Run(state, func(t *testing.T) {
			w := &Workspace{host: &WorkspaceHost{mode: HostOS}, state: workspaceState{Messages: chatFixture(25)}}
			w.state.Messages[0].State = state
			w.retainChatLocked()
			if chatInputs(w.state.Messages) != 21 || w.state.Messages[0].ID != "u1" {
				t.Fatal("lost active input")
			}
			w.state.Messages[0].State = "cancelled"
			w.retainChatLocked()
			if chatInputs(w.state.Messages) != 20 || w.state.Messages[0].ID != "u6" {
				t.Fatal("settled input was not released")
			}
		})
	}
}

func TestOSChatSnapshotSeparatesLongProcessFromChat(t *testing.T) {
	w := &Workspace{host: &WorkspaceHost{mode: HostOS}, state: workspaceState{Messages: chatFixture(21)}}
	for i := 0; i < 350; i++ {
		w.state.Messages = append(w.state.Messages, workspaceMessage{ID: fmt.Sprintf("c%d", i), From: WorkspaceMatrix, To: "user", State: "commentary", Generation: 21, Text: "process"})
	}
	w.retainChatLocked()
	rows := w.snapshotMessagesLocked()
	if chatInputs(rows) != 20 || len(rows) != 240 {
		t.Fatalf("snapshot chat %d total %d", chatInputs(rows), len(rows))
	}
	if len(w.state.Messages) != 390 {
		t.Fatal("process records were deleted by chat retention")
	}
	if rows[0].ID != "u2" || rows[len(rows)-1].ID != "c349" {
		t.Fatal("order changed")
	}
	for _, mode := range []HostMode{HostCLI, HostLegacy} {
		w := &Workspace{host: &WorkspaceHost{mode: mode}, state: workspaceState{Messages: chatFixture(120)}}
		w.retainChatLocked()
		if len(w.state.Messages) != 240 || len(w.snapshotMessagesLocked()) != 200 {
			t.Fatal("changed legacy or CLI contract")
		}
	}
}

func TestOSChatRetiredRequestDoesNotReplay(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("retired request reached provider") })
	w := modeWorkspace(t, m.config, dir, HostOS)
	w.mu.Lock()
	w.state.Messages = chatFixture(21)
	w.retainChatLocked()
	w.mu.Unlock()
	old, err := w.Send("u1", "private u1")
	if err != nil || old.State != "completed" || old.Text != "" {
		t.Fatal(old, err)
	}
	if _, err = w.Send("u1", "different"); err == nil {
		t.Fatal("reused id accepted different body")
	}
	status, err := w.controlStatus("u1")
	if err != nil || status.(map[string]any)["chat_retained"] != false {
		t.Fatal(status, err)
	}
	if _, err = w.controlCancel("u1"); err == nil {
		t.Fatal("retired cancel accepted")
	}
	if len(w.manager.List(w.state.ID)) != 0 {
		t.Fatal("retired request created a job")
	}
}

func TestOSChatEnqueueAndCompletionRetentionBoundaries(t *testing.T) {
	m, dir := matrixTestManager(t, func(http.ResponseWriter, *http.Request) { t.Error("context-only request reached provider") })
	w := modeWorkspace(t, m.config, dir, HostOS)
	w.mu.Lock()
	w.state.Messages = chatFixture(20)
	w.mu.Unlock()
	if _, err := w.enqueueState("user", WorkspaceMatrix, "new", "next", "context"); err != nil {
		t.Fatal(err)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if chatInputs(w.state.Messages) != 20 || w.state.Messages[0].ID != "u2" {
		t.Fatal("enqueue did not retain 20")
	}
	for i := range w.state.Messages {
		if w.state.Messages[i].ID == "new" {
			w.state.Messages[i].State = "delivered"
			w.state.Messages[i].Generation = 21
		}
	}
	if err := w.recordOutputLocked(WorkspaceMatrix, "final", "completed", 21); err != nil {
		t.Fatal(err)
	}
	last := w.state.Messages[len(w.state.Messages)-1]
	if last.TurnID != "new" || last.State != "completed" {
		t.Fatal(last)
	}
	if chatInputs(w.snapshotMessagesLocked()) != 20 {
		t.Fatal("refresh lost chat")
	}
}
