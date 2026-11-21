// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestPACAutomaticCompactionTemporaryFailureKeepsOriginalWork
// Impact: python -B scripts/code-atlas.py show Core/workspace_pac_recovery_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
)

func TestPACAutomaticCompactionTemporaryFailureKeepsOriginalWork(t *testing.T) {
	var mu sync.Mutex
	models, compact := 0, 0
	last := ""
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, r *http.Request) {
		var body struct {
			Tools []json.RawMessage `json:"tools"`
			Input []json.RawMessage `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		mu.Lock()
		defer mu.Unlock()
		if len(body.Input) > 0 && strings.Contains(string(body.Input[len(body.Input)-1]), "【工作上下文封存】") {
			compact++
			rw.Header().Set("Content-Type", "application/json")
			rw.WriteHeader(http.StatusServiceUnavailable)
			_, _ = rw.Write([]byte(`{"error":{"code":"service_unavailable","message":"temporary summary outage"}}`))
			return
		}
		models++
		last = string(rawJSON(body))
		if models == 1 {
			fixtureSizedAnswer(rw, body, "work", "", []any{
				map[string]any{"type": "message", "id": "observation", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": "PAC_ORIGINAL_OBSERVATION " + strings.Repeat("bounded progress ", 4000)}}},
				map[string]any{"type": "function_call", "id": "fc-write", "call_id": "call-write", "name": "report", "arguments": string(rawJSON(map[string]any{"action": "report", "format": "md", "title": "once.txt", "content": "completed once\n"}))},
			})
		} else {
			fixtureSizedAnswer(rw, body, "done", "ORIGINAL_WORK_COMPLETED", nil)
		}
	})
	s, err := Load(m.config)
	if err != nil {
		t.Fatal(err)
	}
	s.ContextWorkingTokens = 8192
	s.CompactPercent = 75
	compactAt := 6144
	for i := range s.APIProfiles {
		s.APIProfiles[i].CompactAtTokens = &compactAt
	}
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	w := modeWorkspace(t, m.config, dir, HostOS)
	w.service = NewSettingsService(m.config)
	t.Cleanup(w.service.Close)
	w.mu.Lock()
	r, err := w.dispatchLocked(WorkspaceMatrix, workspaceID(), "PAC_ORIGINAL_TASK: finish the file once")
	w.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	r, err = w.manager.Wait(context.Background(), w.state.ID, r.ID, 25000)
	if err != nil || r.State != "completed" || r.Result != "ORIGINAL_WORK_COMPLETED" {
		t.Fatalf("state=%s error=%s wait=%v", r.State, r.Error, err)
	}
	mu.Lock()
	defer mu.Unlock()
	if models != 2 || compact != 3 || r.ToolTurns != 1 || r.Compression != nil {
		t.Fatalf("unexpected recovery work: model=%d compact=%d turns=%d compression=%v", models, compact, r.ToolTurns, r.Compression)
	}
	if !strings.Contains(last, "PAC_ORIGINAL_OBSERVATION") || !strings.Contains(last, "PAC_ORIGINAL_TASK") {
		t.Fatal("failed compaction lost exact original context")
	}
	assertFixtureReport(t, w, "once.txt", "completed once\n")
	snapshot, e := w.readPAC(context.Background())
	if e != nil || len(snapshot.Packets) != 0 {
		t.Fatal("failed compaction persisted a packet", e)
	}
	raw, _ := workspaceCompactArchive(t, w, r.ID)
	if !bytes.Contains(raw, []byte(`"kind":"compaction_deferred"`)) {
		t.Fatal("missing durable deferred receipt")
	}
	workspaceCompactUsage(t, r, models, compact)
}
