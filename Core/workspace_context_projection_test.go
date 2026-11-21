// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ordinaryChatSnapshot; ordinaryChatTurn; TestWorkspaceSnapshotKeepsOrdinaryChatWhileCompactionRemainsEffective; TestWorkspaceSnapshotIgnoresLegacyContextVersionAndKeepsMessageCursor
// Impact: python -B scripts/code-atlas.py show Core/workspace_context_projection_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
)

func ordinaryChatSnapshot(t *testing.T, w *Workspace) map[string]any {
	t.Helper()
	v, err := w.Snapshot(0)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := v.(map[string]any)
	if _, exists := snapshot["context_projection"]; exists {
		t.Fatal("ordinary chat exposes the internal model context")
	}
	return snapshot
}

func ordinaryChatTurn(t *testing.T, w *Workspace, text string) {
	t.Helper()
	result := workspaceCompactSend(t, w, workspaceID(), text)
	if result.State != "completed" {
		t.Fatalf("ordinary chat send failed: %s %s", result.State, result.Error)
	}
	// Snapshot reconciles completed execution into the public chat log.
	ordinaryChatSnapshot(t, w)
}

func TestWorkspaceSnapshotKeepsOrdinaryChatWhileCompactionRemainsEffective(t *testing.T) {
	var mu sync.Mutex
	var wires []string
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		mu.Lock()
		wires = append(wires, string(rawJSON(body)))
		mu.Unlock()
		fixtureAnswer(w, "ordinary-chat", "ORDINARY_REPLY", nil)
	})
	w := modeWorkspace(t, m.config, dir, HostOS)
	contextTestAction(t, w, "new", nil)
	ordinaryChatTurn(t, w, "ORDINARY_OLD_USER")
	ordinaryChatTurn(t, w, "ORDINARY_KEPT_USER")
	before := ordinaryChatSnapshot(t, w)
	chat := string(rawJSON(before["messages"]))
	for _, text := range []string{"ORDINARY_OLD_USER", "ORDINARY_KEPT_USER", "ORDINARY_REPLY"} {
		if !strings.Contains(chat, text) {
			t.Fatal("ordinary chat lost an original message", text)
		}
	}
	w.mu.Lock()
	a, err := w.contextArchiveLocked()
	w.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	const summary = "INTERNAL_COMPACT_SUMMARY"
	if err = a.Append("checkpoint", &Checkpoint{Covered: 2, Summary: CompactSummary{Goals: []string{summary}}}); err != nil {
		t.Fatal(err)
	}
	compacted := ordinaryChatSnapshot(t, w)
	if string(rawJSON(compacted["messages"])) != chat || strings.Contains(string(rawJSON(compacted)), summary) {
		t.Fatal("committed model compaction replaced ordinary chat with internal context")
	}
	ordinaryChatTurn(t, w, "ORDINARY_AFTER_COMPACT")
	mu.Lock()
	wire := wires[len(wires)-1]
	calls := len(wires)
	mu.Unlock()
	if strings.Contains(wire, "ORDINARY_OLD_USER") || !strings.Contains(wire, summary) || !strings.Contains(wire, "ORDINARY_KEPT_USER") || !strings.Contains(wire, "ORDINARY_AFTER_COMPACT") {
		t.Fatal("the next model request did not retain the effective compacted context")
	}
	current := ordinaryChatSnapshot(t, w)
	currentChat := string(rawJSON(current["messages"]))
	if !strings.Contains(currentChat, "ORDINARY_OLD_USER") || !strings.Contains(currentChat, "ORDINARY_AFTER_COMPACT") || strings.Contains(string(rawJSON(current)), summary) {
		t.Fatal("ordinary chat diverged from original messages after a compacted request")
	}
	w.Close()
	reopened := modeWorkspace(t, m.config, dir, HostOS)
	after := ordinaryChatSnapshot(t, reopened)
	if string(rawJSON(after["messages"])) != currentChat || strings.Contains(string(rawJSON(after)), summary) {
		t.Fatal("reopening restored internal model context as ordinary chat")
	}
	reopened.mu.Lock()
	a, err = reopened.contextArchiveLocked()
	reopened.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	restored, err := a.read()
	if err != nil {
		t.Fatal(err)
	}
	if restored.Checkpoint == nil || restored.Checkpoint.Covered != 2 || !strings.Contains(string(rawJSON(restored.Checkpoint)), summary) {
		t.Fatal("the internal checkpoint did not survive reopening")
	}
	if !strings.Contains(string(rawJSON(restored.Messages)), "ORDINARY_OLD_USER") {
		t.Fatal("compaction discarded the original archive history")
	}
	mu.Lock()
	gotCalls := len(wires)
	mu.Unlock()
	if gotCalls != calls {
		t.Fatal("observing or reopening ordinary chat called a model")
	}
}

func TestWorkspaceSnapshotIgnoresLegacyContextVersionAndKeepsMessageCursor(t *testing.T) {
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		fixtureAnswer(w, "legacy-cursor", "CURSOR_REPLY", nil)
	})
	w := modeWorkspace(t, m.config, dir, HostOS)
	contextTestAction(t, w, "new", nil)
	ordinaryChatTurn(t, w, "CURSOR_USER")
	before := ordinaryChatSnapshot(t, w)
	args := map[string]any{"context_version": "retired-context-version", "revision": before["revision"], "cursor": before["cursor"]}
	v, err := w.Call(context.Background(), "workspace.snapshot", rawJSON(args))
	if err != nil {
		t.Fatal("old clients must be able to send the retired display cursor", err)
	}
	snapshot := v.(map[string]any)
	if _, exists := snapshot["context_projection"]; exists {
		t.Fatal("legacy cursor restored the internal display projection")
	}
	if snapshot["messages_unchanged"] != true || len(snapshot["messages"].([]workspaceMessage)) != 0 || snapshot["revision"] != before["revision"] {
		t.Fatal("legacy cursor interfered with ordinary message revision tracking")
	}
	args["revision"] = uint64(0)
	v, err = w.Call(context.Background(), "workspace.snapshot", rawJSON(args))
	if err != nil {
		t.Fatal(err)
	}
	if snapshot = v.(map[string]any); snapshot["messages_unchanged"] != false || string(rawJSON(snapshot["messages"])) != string(rawJSON(before["messages"])) {
		t.Fatal("legacy cursor prevented a normal full chat refresh")
	}
}
