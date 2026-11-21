// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestFastMemoryAppendRangeIdempotency; TestPACRuntimeInvalidSummaryAndNarrowWindow
// Impact: python -B scripts/code-atlas.py show Core/workspace_subconscious_regression_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func TestFastMemoryAppendRangeIdempotency(t *testing.T) {
	s, err := openMemoryStore(filepath.Join(t.TempDir(), "memory", "eyra.sqlite"), nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	first := fastCall(t, s, memoryRow{"action": "fast_append", "key": "k", "first_pos": 0, "last_pos": 3, "content": "original", "source": "subconscious"})
	before := fastCall(t, s, memoryRow{"action": "fast_snapshot"})
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, e := s.Call(context.Background(), memoryRow{"action": "fast_append", "key": "k", "first_pos": 1, "last_pos": 5, "content": "late fallback", "source": "compact"}, "global", "test")
			if e != nil {
				t.Error(e)
				return
			}
			out := r.(memoryRow)
			if memInt(out["id"]) != memInt(first["id"]) || out["deduplicated"] != true {
				t.Errorf("duplicate result: %v", out)
			}
		}()
	}
	wg.Wait()
	after := fastCall(t, s, memoryRow{"action": "fast_snapshot"})
	if len(after["segments"].([]any)) != 1 || after["version"] != before["version"] {
		t.Fatalf("duplicate changed memory: %v", after)
	}
	fastCall(t, s, memoryRow{"action": "fast_append", "key": "k", "first_pos": 4, "last_pos": 5, "content": "adjacent", "source": "compact"})
	fastCall(t, s, memoryRow{"action": "fast_append", "key": "other", "first_pos": 0, "last_pos": 3, "content": "other session", "source": "compact"})
	fastCall(t, s, memoryRow{"action": "fast_organize", "retire": []any{first["id"]}, "pinned": "- retired"})
	replaced := fastCall(t, s, memoryRow{"action": "fast_append", "key": "k", "first_pos": 0, "last_pos": 3, "content": "new active", "source": "compact"})
	if memInt(replaced["id"]) == memInt(first["id"]) {
		t.Fatal("retired segment blocked a new active segment")
	}
}

// Main Eyra handles invalid summaries and narrow windows; original context is
// retained on the failed attempt, with no independent model or wait timer.
func TestPACRuntimeInvalidSummaryAndNarrowWindow(t *testing.T) {
	for _, scenario := range []string{"invalid-summary", "narrow-window"} {
		t.Run(scenario, func(t *testing.T) {
			var steps, compactions, subRequests atomic.Int32
			m, dir := matrixTestManager(t, func(rw http.ResponseWriter, r *http.Request) {
				var body struct {
					Tools []json.RawMessage `json:"tools"`
					Model string            `json:"model"`
					Input []json.RawMessage `json:"input"`
				}
				_ = json.NewDecoder(r.Body).Decode(&body)
				if body.Model == "fixture-sub" {
					subRequests.Add(1)
					t.Error("retired model called")
					fixtureSizedAnswer(rw, body, "sub", "unexpected", nil)
					return
				}
				if len(body.Input) > 0 && strings.Contains(string(body.Input[len(body.Input)-1]), "【工作上下文封存】") {
					n := compactions.Add(1)
					if scenario == "invalid-summary" && n == 1 {
						fixtureSizedAnswer(rw, body, "bad", "", nil)
						return
					}
					fixtureSizedAnswer(rw, body, "summary", "经过：前面的已验证步骤完成；剩余步骤仍需继续，不得重复已经写好的文件。", nil)
					return
				}
				n := steps.Add(1)
				if n > 8 {
					fixtureSizedAnswer(rw, body, "done", "DONE", nil)
					return
				}
				fixtureSizedAnswer(rw, body, fmt.Sprintf("step%d", n), "", []any{
					map[string]any{"type": "message", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": strings.Repeat("bounded progress ", 4000)}}},
					map[string]any{"type": "function_call", "id": fmt.Sprintf("fc%d", n), "call_id": fmt.Sprintf("c%d", n), "name": "report", "arguments": string(rawJSON(map[string]any{"action": "report", "format": "md", "title": fmt.Sprintf("fallback%d.txt", n), "content": "once\n"}))},
				})
			})
			subconsciousConfig(t, m, 128000)
			if scenario == "narrow-window" {
				s, _ := Load(m.config)
				s.APIProfiles[0].ContextWindow = 50000
				if err := s.Save(); err != nil {
					t.Fatal(err)
				}
			}
			w := modeWorkspace(t, m.config, dir, HostOS)
			w.service = NewSettingsService(m.config)
			t.Cleanup(w.service.Close)
			w.mu.Lock()
			record, err := w.dispatchLocked(WorkspaceMatrix, workspaceID(), "complete all eight steps")
			w.mu.Unlock()
			if err != nil {
				t.Fatal(err)
			}
			record, err = w.manager.Wait(context.Background(), w.state.ID, record.ID, 40000)
			if err != nil || record.State != "completed" || record.Result != "DONE" {
				t.Fatalf("runtime failed: %s %s %v", record.State, record.Error, err)
			}
			if subRequests.Load() != 0 || compactions.Load() == 0 || scenario == "invalid-summary" && compactions.Load() < 2 {
				t.Fatal("main compaction did not recover", compactions.Load())
			}
			snap, err := w.readPAC(context.Background())
			if err != nil || len(snap.Packets) == 0 {
				t.Fatal("PAC missing", snap, err)
			}
			if record.Compression == nil || record.Compression.AfterTokens >= record.Compression.BeforeTokens {
				t.Fatal("context not reduced", record.Compression)
			}
		})
	}
}
