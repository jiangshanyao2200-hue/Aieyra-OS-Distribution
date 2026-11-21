// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestAgentProviderMeterFollowsActualChannel; testProviderMeterChannel
// Impact: python -B scripts/code-atlas.py show Core/matrix_provider_meter_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestAgentProviderMeterFollowsActualChannel(t *testing.T) {
	for _, entry := range []string{"agent", "os", "cli"} {
		t.Run(entry, func(t *testing.T) {
			for _, change := range []string{"model", "protocol", "address", "all", "unchanged"} {
				t.Run(change, func(t *testing.T) {
					testProviderMeterChannel(t, entry, change)
				})
			}
		})
	}
}

func testProviderMeterChannel(t *testing.T, entry, change string) {
	t.Helper()
	changeModel := change == "model" || change == "all"
	changeProtocol := change == "protocol" || change == "all"
	changeAddress := change == "address" || change == "all"
	expectedModel := "fixture"
	if changeModel {
		expectedModel = "replacement-fixture"
	}
	expectedPath := "/responses"
	if changeProtocol {
		expectedPath = "/chat/completions"
	}
	type wire struct {
		Origin, Path, Model string
		Calls, Results      int
	}
	var requests atomic.Int32
	var mu sync.Mutex
	var wires []wire
	var config, nextURL string
	handler := func(origin string) http.HandlerFunc {
		return func(rw http.ResponseWriter, req *http.Request) {
			var body map[string]any
			if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
				t.Error(err)
				http.Error(rw, "invalid fixture request", http.StatusBadRequest)
				return
			}
			n := requests.Add(1)
			current := wire{Origin: origin, Path: req.URL.Path}
			current.Model, _ = body["model"].(string)
			if n == 1 {
				if current.Origin != "first" || current.Path != "/responses" || current.Model != "fixture" {
					t.Errorf("unexpected initial channel: %+v", current)
				}
				// 正常配置合同允许同 ID 重新接入；必须在响应完成前落盘，下一轮才会重读。
				s, err := Load(config)
				if err == nil && change != "unchanged" {
					p := &s.APIProfiles[0]
					p.ContextWindow = 32768
					if changeModel {
						p.Model = expectedModel
					}
					if changeProtocol {
						p.Protocol = ProtocolChat
					}
					if changeAddress {
						p.BaseURL = nextURL
						s.ProviderConnections[0].BaseURL = nextURL
					}
					s.applyPoolProfile()
					err = s.Save()
				}
				if err != nil {
					t.Error(err)
					http.Error(rw, "fixture profile update failed", http.StatusInternalServerError)
					return
				}
			} else {
				if n != 2 || current.Model != expectedModel || current.Path != expectedPath || (origin == "next") != changeAddress {
					t.Errorf("unexpected next channel or replay: %+v request=%d", current, n)
				}
				itemsKey := "input"
				if changeProtocol {
					itemsKey = "messages"
				}
				items, _ := body[itemsKey].([]any)
				for _, item := range items {
					m, _ := item.(map[string]any)
					if changeProtocol {
						calls, _ := m["tool_calls"].([]any)
						for _, rawCall := range calls {
							call, _ := rawCall.(map[string]any)
							if call["id"] == "call_meter" {
								current.Calls++
							}
						}
						if m["role"] == "tool" && m["tool_call_id"] == "call_meter" {
							current.Results++
						}
					} else {
						if m["type"] == "function_call" && m["call_id"] == "call_meter" {
							current.Calls++
						}
						if m["type"] == "function_call_output" && m["call_id"] == "call_meter" {
							current.Results++
						}
					}
				}
				if current.Calls != 1 || current.Results != 1 {
					t.Errorf("tool pair lost or duplicated across channel boundary: %+v", current)
				}
			}
			mu.Lock()
			wires = append(wires, current)
			mu.Unlock()
			rw.Header().Set("Content-Type", "application/json")
			if n == 1 {
				output := any(map[string]any{"type": "function_call", "id": "fc_meter", "call_id": "call_meter", "name": "apply_patch", "arguments": `{"patch":"*** Begin Patch\n*** Add File: proof.txt\n+durable\n*** End Patch"}`})
				if entry == "os" {
					output = fixtureReportCall("call_meter", "proof.txt", "durable\n")
				}
				_ = json.NewEncoder(rw).Encode(map[string]any{
					"id": "meter-first", "status": "completed",
					"output": []any{output},
					"usage":  map[string]any{"input_tokens": 64000, "output_tokens": 20},
				})
			} else if changeProtocol {
				_ = json.NewEncoder(rw).Encode(map[string]any{
					"id":      "meter-next",
					"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": "CALIBRATION_VERIFIED"}, "finish_reason": "stop"}},
					"usage":   map[string]any{"prompt_tokens": 80, "completion_tokens": 20},
				})
			} else {
				fixtureAnswer(rw, "meter-next", "CALIBRATION_VERIFIED", nil)
			}
		}
	}
	nextServer := httptest.NewServer(handler("next"))
	t.Cleanup(nextServer.Close)
	nextURL = nextServer.URL
	m, dir := matrixTestManager(t, handler("first"))
	config = m.config
	s, err := Load(config)
	if err != nil {
		t.Fatal(err)
	}
	// 只观察模型和工具事务，避免后台记忆或自动压缩增加维护请求。
	s.MemoryEnabled, s.DreamsEnabled, s.CompactPercent = false, false, 0
	setTestProfileCompact(s, 0)
	if err = s.Save(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	owner := testMatrixOwner
	var record AgentRecord
	var workspace *Workspace
	if entry == "agent" {
		record, err = m.Create(ctx, owner, AgentSpec{RequestID: "meter-task", ModelID: "local-model", Task: "produce proof", Workdir: dir, Tools: []string{"apply_patch"}})
	} else {
		mode := HostOS
		if entry == "cli" {
			mode = HostCLI
		}
		w := modeWorkspace(t, config, dir, mode)
		workspace = w
		m, owner = w.manager, w.state.ID
		if _, err = w.Send("meter-task", "produce proof"); err != nil {
			t.Fatal(err)
		}
		ticker := time.NewTicker(10 * time.Millisecond)
		defer ticker.Stop()
		for record.ID == "" {
			w.mu.Lock()
			record.ID = w.state.Roles[WorkspaceMatrix]
			w.mu.Unlock()
			if record.ID != "" {
				break
			}
			select {
			case <-ticker.C:
			case <-ctx.Done():
				t.Fatal("workspace did not dispatch the original message")
			}
		}
	}
	if err != nil {
		t.Fatal(err)
	}
	record, err = m.Wait(ctx, owner, record.ID, 10000)
	mu.Lock()
	t.Logf("wire=%+v state=%s requests=%d tool_turns=%d context=%+v usage=%+v error=%s", wires, record.State, record.Requests, record.ToolTurns, record.Context, record.Usage, record.Error)
	mu.Unlock()
	proofPath := filepath.Join(dir, "proof.txt")
	if entry == "os" {
		proofPath, err = fixtureReportFile(workspace, "proof.txt")
		if err != nil {
			t.Fatal(err)
		}
	}
	proof, proofErr := os.ReadFile(proofPath)
	if proofErr != nil || string(proof) != "durable\n" || record.ToolTurns != 1 {
		t.Fatalf("real tool did not execute exactly once: proof=%q error=%v turns=%d", proof, proofErr, record.ToolTurns)
	}
	if err != nil || record.State != "completed" || record.Result != "CALIBRATION_VERIFIED" || requests.Load() != 2 || record.Requests != 2 {
		t.Fatalf("next request blocked or replayed: state=%s result=%s error=%s wait=%v requests=%d", record.State, record.Result, record.Error, err, requests.Load())
	}
	if record.Spec.ModelID != "local-model" || len(record.Usage) != 2 || record.Usage[0].Input != 64000 || record.Usage[1].Input != 80 || record.AccountedTokens != 64120 || record.Compression != nil {
		t.Fatal("profile identity, usage or compaction changed unexpectedly")
	}
	if record.Context == nil || record.Context.Tokens > record.Context.InputLimit {
		t.Fatal("completed request exceeds its own input window")
	}
	if change == "unchanged" {
		if record.Context.Tokens < 64000 || record.Context.ModelWindow != 128000 {
			t.Fatal("same channel discarded conservative reported calibration")
		}
	} else if record.Context.Tokens >= 32768 || record.Context.ModelWindow != 32768 || strings.Contains(record.Error, "context budget") {
		t.Fatal("new channel retained old usage calibration")
	}
}
