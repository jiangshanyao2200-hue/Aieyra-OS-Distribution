// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestCLIModelRequestRetrievesSharedOSMemory
// Impact: python -B scripts/code-atlas.py show Core/workspace_memory_prompt_test.go
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
)

func TestCLIModelRequestRetrievesSharedOSMemory(t *testing.T) {
	previous := baseToolMode
	baseToolMode = true
	t.Cleanup(func() { baseToolMode = previous })
	const preference = "Shared memory preference: use amber diagrams for telescope reports."
	var calls atomic.Int32
	m, dir := matrixTestManager(t, func(rw http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if calls.Add(1) == 1 {
			input := string(body["input"])
			containsText := func(text string) bool {
				encoded := string(rawJSON(text))
				return strings.Contains(input, encoded[1:len(encoded)-1])
			}
			for _, want := range []string{preference, memoryContract()} {
				if !containsText(want) {
					t.Errorf("CLI model request omitted shared memory: %q", want)
				}
			}
			if containsText(memorySettingsContract()) {
				t.Error("CLI received desktop-only settings contract")
			}
			fixtureAnswer(rw, "answer", "Amber telescope report ready.", nil)
			return
		}
		fixtureAnswer(rw, "continuity", startupFixtureSummary(t, body["input"]), nil)
	})
	osWorkspace := modeWorkspace(t, m.config, dir, HostOS)
	osWorkspace.service = NewSettingsService(m.config)
	t.Cleanup(osWorkspace.service.Close)
	raw, err := osWorkspace.memory(context.Background(), map[string]any{
		"action": "record", "scope": "global", "kind": "preference", "title": "telescope reports",
		"content": preference, "source": "explicit synthetic user preference", "request_id": "shared-preference",
	})
	var result struct{ OK bool }
	if err != nil || json.Unmarshal(raw, &result) != nil || !result.OK {
		t.Fatal("OS memory seed failed", string(raw), err)
	}
	w := modeWorkspace(t, m.config, dir, HostCLI)
	w.host.SetTerminal()
	w.service = NewSettingsService(m.config)
	t.Cleanup(w.service.Close)
	w.mu.Lock()
	record, err := w.dispatchLocked(WorkspaceMatrix, workspaceID(), "Prepare telescope reports using my saved preference")
	w.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	record, err = w.manager.Wait(context.Background(), w.state.ID, record.ID, 10000)
	if err != nil || record.State != "completed" || calls.Load() < 1 {
		t.Fatal("CLI request failed", record.State, record.Error, err)
	}
}
