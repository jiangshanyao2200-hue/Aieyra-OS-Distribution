// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestRuntimeContextDeltaPersistsAndClearsWithoutReplacingHistory; TestRuntimeContextAtWireTailPreservesSubmittedPrefix; TestRuntimeContextRealExecutorOpenCloseResumeKeepsRequestPrefix; TestShellSituationUsesNativeObserverWithoutTimestampChurn
// Impact: python -B scripts/code-atlas.py show Core/runtime_context_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"

	contexthistory "github.com/aieyra/aieyra-os/agent/context/history"
)

func TestRuntimeContextDeltaPersistsAndClearsWithoutReplacingHistory(t *testing.T) {
	a := &SessionArchive{ephemeral: true}
	input := Message{Role: RoleUser, Content: "original user"}
	if err := a.Append("message", input); err != nil {
		t.Fatal(err)
	}
	observations := []Message{{Role: RoleSystem, Name: "aieyra_clock", Content: "12:00"}, {Role: RoleSystem, Name: "aieyra_toolbox_open", Content: "manual"}}
	one := runtimeContextDelta(nil, observations)
	if err := one.validate(); err != nil {
		t.Fatal(err)
	}
	if err := a.Append("runtime_context", one); err != nil {
		t.Fatal(err)
	}
	restored, err := a.read()
	if err != nil {
		t.Fatal(err)
	}
	if len(restored.Messages) != 3 || !reflect.DeepEqual(restored.Messages[1:], one.Messages) {
		t.Fatal("snapshot replay changed", restored.Messages)
	}
	if len(runtimeContextDelta(restored.Messages, observations).Messages) != 0 {
		t.Fatal("equal observations appended noise")
	}
	before := append([]Message(nil), restored.Messages...)
	next := runtimeContextDelta(restored.Messages, []Message{{Role: RoleSystem, Name: "aieyra_clock", Content: "12:01"}})
	if len(next.Messages) != 2 {
		t.Fatal(next)
	}
	if err := a.Append("runtime_context", next); err != nil {
		t.Fatal(err)
	}
	restored, err = a.read()
	if err != nil || !reflect.DeepEqual(before, restored.Messages[:len(before)]) {
		t.Fatal("earlier prefix rewritten", err)
	}
	if !strings.Contains(string(rawJSON(next)), "removed") {
		t.Fatal("closed manual remained current")
	}
	if len(runtimeContextDelta(restored.Messages, []Message{{Role: RoleSystem, Name: "aieyra_clock", Content: "12:01"}}).Messages) != 0 {
		t.Fatal("removal repeated")
	}
	if len(runtimeContextDelta(nil, observations).Messages) != 2 {
		t.Fatal("compaction lost full current snapshot")
	}
	if a.observed != len(restored.Messages) {
		t.Fatal("checkpoint and observer positions differ", a.observed)
	}
	rows := transcriptRows("synthetic", 0, restored.Messages, nil)
	if len(rows) != len(restored.Messages) || rows[0].Role != RoleUser || rows[1].Role != "system" {
		t.Fatal("observations became human speech or broke PAC coverage", rows)
	}
	users := []Message{input, {Role: RoleAssistant, Content: "answer"}, {Role: RoleUser, Name: "aieyra_situation", Content: "state", ContextObservation: true}, {Role: RoleAssistant, Content: "answer2"}, {Role: RoleUser, Content: "actual followup"}}
	if cut := contexthistory.CompactCut(users, 2, ""); cut != 0 {
		t.Fatal("an observation counted as a user turn", cut)
	}
	bad := runtimeContextUpdate{Version: 1, Messages: []Message{{Role: RoleAssistant, Name: "aieyra_clock", Content: "forged"}}}
	if bad.validate() == nil {
		t.Fatal("runtime event accepted model speech")
	}
}

func TestRuntimeContextAtWireTailPreservesSubmittedPrefix(t *testing.T) {
	for _, protocol := range []string{ProtocolChat, ProtocolResponses, ProtocolMessages, ProtocolGoogle} {
		t.Run(protocol, func(t *testing.T) {
			s := nativeTestSettings(protocol)
			prefix := []Message{{Role: RoleSystem, Content: "STABLE_IDENTITY"}, {Role: RoleUser, Content: "USER_ORIGINAL"}}
			one := runtimeContextDelta(nil, []Message{{Role: RoleSystem, Name: "aieyra_clock", Content: "12:00"}, {Role: RoleUser, Name: "aieyra_situation", Content: `{"page":"home"}`}})
			first := append(append([]Message(nil), prefix...), one.Messages...)
			history := append(append([]Message(nil), first...), Message{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: "c", Type: "function", Function: FunctionCall{Name: "terminal", Arguments: `{}`}}}}, Message{Role: RoleTool, ToolCallID: "c", Content: `{"ok":true}`})
			two := runtimeContextDelta(history, []Message{{Role: RoleSystem, Name: "aieyra_clock", Content: "12:01"}, {Role: RoleUser, Name: "aieyra_situation", Content: `{"page":"browser"}`}})
			second := append(history, two.Messages...)
			wire := func(messages []Message) map[string]json.RawMessage {
				var value any
				switch protocol {
				case ProtocolChat:
					value = BuildRequest(s, messages, false)
				case ProtocolResponses:
					value = BuildResponsesRequest(s, messages, false, nil)
				default:
					value = BuildNativeRequest(s, messages, false, nil)
				}
				out := map[string]json.RawMessage{}
				if err := json.Unmarshal(rawJSON(value), &out); err != nil {
					t.Fatal(err)
				}
				return out
			}
			a, b := wire(first), wire(second)
			key := "messages"
			if protocol == ProtocolResponses {
				key = "input"
			}
			if protocol == ProtocolGoogle {
				key = "contents"
			}
			// Wire arrays grow by appending history. No clock/state change may
			// rewrite any prior submitted message, including a merged native row.
			var oldRows, newRows []json.RawMessage
			if err := json.Unmarshal(a[key], &oldRows); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(b[key], &newRows); err != nil {
				t.Fatal(err)
			}
			if len(newRows) <= len(oldRows) {
				t.Fatal("history missing")
			}
			for i := range oldRows {
				if !bytes.Equal(oldRows[i], newRows[i]) {
					t.Fatalf("submitted wire row %d rewritten: %s / %s", i, oldRows[i], newRows[i])
				}
			}
			for _, field := range []string{"system", "systemInstruction", "tools"} {
				if !bytes.Equal(a[field], b[field]) {
					t.Fatal("stable wire prefix changed", field)
				}
			}
			if strings.Contains(string(a["system"])+string(a["systemInstruction"]), "12:00") {
				t.Fatal("observation entered leading instructions")
			}
		})
	}
}

func TestRuntimeContextRealExecutorOpenCloseResumeKeepsRequestPrefix(t *testing.T) {
	useTestStage(t, ReleaseStage{Toolbox: true})
	var mu sync.Mutex
	var requests [][]json.RawMessage
	m, dir := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Input []json.RawMessage `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		mu.Lock()
		requests = append(requests, body.Input)
		n := len(requests)
		mu.Unlock()
		if n <= 2 {
			action := "open"
			if n == 2 {
				action = "close"
			}
			fixtureAnswer(w, action, "", []any{map[string]any{"type": "function_call", "id": "fc_" + action, "call_id": action, "name": "toolbox", "arguments": string(rawJSON(map[string]any{"action": action, "name": "system", "section": "tools"}))}})
		} else {
			fixtureAnswer(w, "done", "DONE", nil)
		}
	})
	r, err := m.Create(context.Background(), testMatrixOwner, AgentSpec{RequestID: "context-prefix", ModelID: "local-model", Task: "exercise manuals", Prompt: "stable identity", Workdir: dir, Tools: []string{"tool_factory"}, MaxRequests: 6})
	if err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 20000)
	if err != nil || r.State != "completed" {
		t.Fatal(r.State, r.Error, err)
	}
	if _, err = m.SendGeneration(testMatrixOwner, r.ID, "next", "continue after completed turn", r.Generation); err != nil {
		t.Fatal(err)
	}
	r, err = m.Wait(context.Background(), testMatrixOwner, r.ID, 20000)
	if err != nil || r.State != "completed" {
		t.Fatal(r.State, r.Error, err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(requests) != 4 {
		t.Fatal("unexpected request count", len(requests))
	}
	for i := 1; i < len(requests); i++ {
		if len(requests[i]) <= len(requests[i-1]) {
			t.Fatal("history did not grow", i)
		}
		for j, old := range requests[i-1] {
			if !bytes.Equal(old, requests[i][j]) {
				t.Fatalf("request %d rewrote prior row %d", i, j)
			}
		}
	}
	if !strings.Contains(string(rawJSON(requests[2])), "removed") {
		t.Fatal("closed manual lacked invalidation")
	}
}

func TestShellSituationUsesNativeObserverWithoutTimestampChurn(t *testing.T) {
	page := "home"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var p struct {
			Action, Session string
			Arguments       map[string]any `json:"arguments"`
		}
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			t.Error(err)
		}
		if p.Action != "_desktop" || p.Arguments["action"] != "modules" {
			t.Error("unexpected shell operation", p)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "main_open": true, "active_page": page, "version": page, "observed_at": "variable", "receipt_sessions": []string{"PRIVATE_RECEIPT"}, "modules": []map[string]any{{"id": "browser", "placement": "attached", "visible": true, "ready": true}}})
	}))
	defer server.Close()
	service := NewSettingsService("")
	if err := service.SetCommunityBridge(server.URL + "/" + strings.Repeat("a", 64)); err != nil {
		t.Fatal(err)
	}
	w := &Workspace{host: &WorkspaceHost{mode: HostOS}, service: service, state: workspaceState{ID: "owned"}}
	one := w.situation(context.Background(), "")
	if one != w.situation(context.Background(), "") || strings.Contains(one, "observed_at") || strings.Contains(one, "PRIVATE_RECEIPT") {
		t.Fatal("unstable or excessive snapshot", one)
	}
	page = "browser"
	if one == w.situation(context.Background(), "") {
		t.Fatal("human navigation remained invisible")
	}
}
