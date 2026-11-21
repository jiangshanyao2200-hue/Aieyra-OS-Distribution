// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestOSPACMigratesContinuityWithoutPerTurnMaintenance
// Impact: python -B scripts/code-atlas.py show Core/workspace_continuity_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// 记忆系统 M-A：回答后不再额外调用模型重写连续记忆；旧连续记忆迁成第一段 fast memory，
// 放在已提交对话之后的动态区；这一轮的原文写进深层记忆。
func TestOSPACMigratesContinuityWithoutPerTurnMaintenance(t *testing.T) {
	var requests atomic.Int32
	var input atomic.Value
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&body)
		requests.Add(1)
		input.Store(string(body["input"]))
		fixtureAnswer(rw, "final", "readable final answer", nil)
	})
	w := modeWorkspace(t, m.config, dir, HostOS)
	w.service = NewSettingsService(m.config)
	t.Cleanup(w.service.Close)
	before, err := w.readContinuity(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	old := string(rawJSON(CompactSummary{Goals: []string{"old semantic continuity"}, Constraints: []string{"keep amber diagrams"}}))
	if _, err = w.memory(context.Background(), map[string]any{"action": "continuity_commit", "request_id": "seed", "content": old, "expected_epoch": before.Epoch, "expected_version": before.Version}); err != nil {
		t.Fatal(err)
	}
	w.mu.Lock()
	r, err := w.dispatchLocked(WorkspaceMatrix, workspaceID(), "new task")
	w.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	r, err = w.manager.Wait(context.Background(), w.state.ID, r.ID, 10000)
	if err != nil || r.State != "completed" || r.Result != "readable final answer" {
		t.Fatalf("answer lost: %+v %v", r, err)
	}
	if requests.Load() != 1 || r.Requests != 1 || len(r.Usage) != 1 {
		t.Fatalf("per-turn continuity request still sent: requests=%d usage=%+v", requests.Load(), r.Usage)
	}
	sent, _ := input.Load().(string)
	block := strings.Index(sent, "分层永久记忆PAC目录")
	task := strings.Index(sent, "new task")
	if block < 0 || !strings.Contains(sent, "old semantic continuity") || !strings.Contains(sent, "keep amber diagrams") || task < 0 || block <= task {
		snap, _ := w.readPAC(context.Background())
		t.Fatalf("PAC missing or before conversation: block=%d task=%d header=%q snapshot=%+v", block, task, runtimePrompt("Matrix/记忆/PAC目录.txt"), snap)
	}
	if at := strings.Index(sent, "检索出的表层记忆"); at >= 0 && at < task {
		t.Fatal("query-dependent surface still precedes the conversation")
	}
	w.flushTranscript(3 * time.Second)
	raw, err := w.memory(context.Background(), map[string]any{"action": "transcript_pending", "exclude_prefix": "another-launch/"})
	var pending struct {
		Key  string `json:"key"`
		Rows []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"rows"`
	}
	if err != nil || json.Unmarshal(raw, &pending) != nil || !strings.HasPrefix(pending.Key, w.state.ID+"/") {
		t.Fatalf("transcript not stored: %s %v", raw, err)
	}
	// Runtime observations retain archive positions as system data. They must
	// never become user speech or replace either original conversation row.
	conversation := pending.Rows[:0]
	for _, row := range pending.Rows {
		if row.Role != RoleSystem {
			conversation = append(conversation, row)
		}
	}
	if len(conversation) != 2 || conversation[0].Role != RoleUser || conversation[0].Content != "new task" || conversation[1].Role != RoleAssistant || conversation[1].Content != "readable final answer" {
		t.Fatalf("transcript rows wrong: %+v", pending.Rows)
	}
}
