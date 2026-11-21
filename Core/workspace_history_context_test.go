// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestManagedHistoryColdReopenKeepsReceiptsAndDoesNotDuplicateMemory; TestManagedHistoryRetainsOriginalsBeyondChatTail
// Impact: python -B scripts/code-atlas.py show Core/workspace_history_context_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestManagedHistoryColdReopenKeepsReceiptsAndDoesNotDuplicateMemory(t *testing.T) {
	calls := 0
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			fixtureAnswer(w, "receipt", "", []any{fixtureReportCall("call-receipt", "managed-history", "managed-history")})
			return
		}
		fixtureAnswer(w, "reply", "managed final reply", nil)
	})
	open := func() (*Workspace, *SettingsService) {
		s := NewSettingsService(m.config)
		h := NewWorkspaceHost(m.config, "", "")
		if err := h.SetMode(HostOS); err != nil {
			t.Fatal(err)
		}
		w, err := newWorkspace(m.config, "", dir, "", s, h)
		if err != nil {
			s.Close()
			t.Fatal(err)
		}
		t.Cleanup(func() { w.Close(); h.Close(); s.Close() })
		return w, s
	}
	w, service := open()
	contextTestAction(t, w, "new", map[string]any{"auto_memory": true})
	contextTestTurn(t, w, "managed original")
	w.flushTranscript(3 * time.Second)
	proof, err := w.memory(context.Background(), map[string]any{"action": "transcript_history", "exclude_prefix": "unrelated/", "limit": 50})
	if err != nil || !strings.Contains(string(proof), "managed original") {
		t.Fatalf("test did not persist an actual transcript: %s %v", proof, err)
	}
	var transcript struct{ Rows []memoryHistoryRow }
	if err = json.Unmarshal(proof, &transcript); err != nil || len(transcript.Rows) == 0 {
		t.Fatal("missing memory proof", err)
	}
	row := transcript.Rows[0]
	staleMemory := fmt.Sprintf("memory:%s:%012d", row.Session, row.Pos)
	read := func(current *Workspace) historyEntry {
		t.Helper()
		value, err := current.historyPage(rawJSON(map[string]any{"segment": current.state.HistorySegment, "all_history": true, "limit": 50}))
		if err != nil {
			t.Fatal(err)
		}
		result := value.(map[string]any)
		if result["warning"] != "" {
			t.Fatal(result["warning"])
		}
		var tool historyEntry
		originals, replies := 0, 0
		for _, row := range result["entries"].([]historyEntry) {
			if strings.HasPrefix(row.ID, "memory:") {
				t.Fatal("managed archive was duplicated by memory projection", row.ID)
			}
			if row.Text == "managed original" {
				originals++
			}
			if row.Text == "managed final reply" {
				replies++
			}
			if row.Kind == "tool" {
				tool = row
			}
		}
		if originals != 1 || replies != 1 || tool.ID == "" {
			t.Fatal("missing original/response/receipt", originals, replies, tool.ID)
		}
		v, e := current.historyReceipt(rawJSON(map[string]any{"agent_id": tool.Agent, "id": tool.Call, "all_history": true}))
		if e != nil || !strings.Contains(string(rawJSON(v)), "managed-history") {
			t.Fatal("original tool receipt unavailable", e)
		}
		return tool
	}
	before := read(w)
	for _, id := range []string{w.state.Roles[WorkspaceMatrix], workspaceID()} {
		_, e := w.historyReceipt(rawJSON(map[string]any{"agent_id": id, "id": before.Call}))
		if (e == nil) != (id == w.state.Roles[WorkspaceMatrix]) {
			t.Fatal("current activity alias or foreign identity boundary failed", e)
		}
	}
	w.Close()
	w.host.Close()
	service.Close()
	reopened, _ := open()
	after := read(reopened)
	if before.ID != after.ID || before.Agent != after.Agent || before.Call != after.Call {
		t.Fatal("cold reopening changed durable tool identity", before.ID, after.ID)
	}
	contextTestAction(t, reopened, "new", nil)
	if _, err = reopened.historyReceipt(rawJSON(map[string]any{"agent_id": after.Agent, "id": after.Call})); err == nil {
		t.Fatal("another managed conversation exposed the previous tool receipt")
	}
	if _, err = reopened.historyReceipt(rawJSON(map[string]any{"entry_id": staleMemory, "all_history": true})); err == nil {
		t.Fatal("another managed conversation exposed a stale project memory entry")
	}
	if calls != 2 {
		t.Fatal("history replayed a model request", calls)
	}
}

func TestManagedHistoryRetainsOriginalsBeyondChatTail(t *testing.T) {
	calls := 0
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		fixtureAnswer(w, "history", "identical assistant reply", nil)
	})
	w := modeWorkspace(t, m.config, dir, HostOS)
	id := contextTestAction(t, w, "new", nil)["session_id"].(string)
	want := map[string]int{}
	for n := 0; n < 54; n++ {
		text := fmt.Sprintf("original %d", n)
		if n < 2 {
			text = "identical user original"
		}
		if n == 2 {
			text += strings.Repeat("完整长原文🙂", 3200)
		}
		want[text]++
		request := fmt.Sprintf("managed-history-%d", n)
		if _, err := w.Send(request, text); err != nil {
			t.Fatal(err)
		}
		finished := false
		deadline := time.Now().Add(10 * time.Second)
		for time.Now().Before(deadline) {
			w.mu.Lock()
			for _, message := range w.state.Messages {
				if message.ID == request && message.State == "completed" {
					finished = w.contextIdleLocked() == nil
				}
			}
			w.mu.Unlock()
			if finished {
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		if !finished {
			t.Fatal("real user send did not complete", n)
		}
	}
	verify := func(current *Workspace, expected map[string]int) {
		t.Helper()
		current.mu.Lock()
		segment := current.state.HistorySegment
		current.mu.Unlock()
		before := ""
		seen := map[string]bool{}
		users := map[string]int{}
		replies := 0
		for page := 0; page < 30; page++ {
			value, err := current.historyPage(rawJSON(map[string]any{"segment": segment, "all_history": true, "limit": 17, "before": before}))
			if err != nil {
				t.Fatal(err)
			}
			result := value.(map[string]any)
			if result["warning"] != "" {
				t.Fatal(result["warning"])
			}
			for _, row := range result["entries"].([]historyEntry) {
				if seen[row.ID] {
					t.Fatal("duplicate paged identity", row.ID)
				}
				seen[row.ID] = true
				text := row.Text
				if row.TextMore {
					text = ""
					offset := 0
					for {
						part, e := current.historyReceipt(rawJSON(map[string]any{"segment": segment, "all_history": true, "entry_id": row.ID, "input_offset": offset}))
						if e != nil {
							t.Fatal(e)
						}
						p := part.(map[string]any)
						text += p["input"].(string)
						offset = p["next_input"].(int)
						if offset == 0 {
							break
						}
					}
				}
				if row.Role == "user" {
					users[text]++
				}
				if text == "identical assistant reply" {
					replies++
				}
				if strings.Contains(text, "INTERNAL_EDIT_MUST_NOT_APPEAR") {
					t.Fatal("edited model context exposed as a user submission")
				}
			}
			if result["has_more"] == false {
				break
			}
			before = result["before"].(string)
			if page == 29 {
				t.Fatal("history paging did not terminate")
			}
		}
		if string(rawJSON(users)) != string(rawJSON(expected)) {
			t.Fatalf("history lost or duplicated originals: got %d distinct, expected %d", len(users), len(expected))
		}
		total := 0
		for _, n := range expected {
			total += n
		}
		if replies != total {
			t.Fatalf("assistant replies %d, expected %d", replies, total)
		}
	}
	verify(w, want)
	w.mu.Lock()
	tail := chatInputs(w.state.Messages)
	w.mu.Unlock()
	if tail != workspaceChatTurns {
		t.Fatal("test did not cross real chat retention", tail)
	}
	contextTestAction(t, w, "memory", map[string]any{"auto_memory": true}) // Copies the archive; no duplicate history.
	verify(w, want)
	contextTestAction(t, w, "edit", map[string]any{"text": "INTERNAL_EDIT_MUST_NOT_APPEAR"})
	verify(w, want)
	contextTestAction(t, w, "new", nil)
	verify(w, map[string]int{})
	contextTestAction(t, w, "switch", map[string]any{"id": id})
	verify(w, want)
	w.Close()
	w.host.Close()
	reopened := modeWorkspace(t, m.config, dir, HostOS)
	verify(reopened, want)
	if calls != 54 {
		t.Fatal("history observation or reopening replayed requests", calls)
	}
}
