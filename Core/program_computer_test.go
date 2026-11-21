// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestComputerSpecialistDirectSessionsAndReopen
// Impact: python -B scripts/code-atlas.py show Core/program_computer_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"net/http"
	"slices"
	"sync/atomic"
	"testing"
)

func TestComputerSpecialistDirectSessionsAndReopen(t *testing.T) {
	var requests atomic.Int32
	m, _ := matrixTestManager(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		fixtureAnswer(w, "computer", "COMPUTER_USER_RESULT", nil)
	})
	h := NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	call := func(args map[string]any) any {
		t.Helper()
		out, err := h.conversationCall(context.Background(), rawJSON(args))
		if err != nil {
			t.Fatal(args["action"], err)
		}
		return out
	}
	id := programContactID("computer")
	detail := call(map[string]any{"action": "contact", "id": id}).(map[string]any)
	if detail["embedded"] != false || detail["model_inherited"] != true || len(detail["sessions"].([]map[string]any)) != 0 {
		t.Fatal("computer has no direct empty-state entry", detail)
	}
	first := call(map[string]any{"action": "session_create", "contact_id": id, "request_id": "computer-first"}).(map[string]any)["id"].(string)
	second := call(map[string]any{"action": "session_create", "contact_id": id, "request_id": "computer-second"}).(map[string]any)["id"].(string)
	if first == second || requests.Load() != 0 {
		t.Fatal("opening started work or reused an independent context")
	}
	cm, err := h.conversationManager()
	if err != nil {
		t.Fatal(err)
	}
	r, err := cm.Send(cm.owner, first, "computer-user", "Handle this explicit desktop task")
	if err != nil {
		t.Fatal(err)
	}
	r, err = cm.Wait(context.Background(), cm.owner, r.ID, 10000)
	if err != nil || r.Result != "COMPUTER_USER_RESULT" || !slices.Contains(r.Spec.Tools, "computer") || requests.Load() != 1 {
		t.Fatal(r.State, r.Error, err)
	}
	call(map[string]any{"action": "session_delete", "id": second, "request_id": "delete-computer-second"})
	if _, err = h.conversationCall(context.Background(), rawJSON(map[string]any{"action": "session_create", "contact_id": programContactID("browser"), "request_id": "clone-native-browser"})); err == nil {
		t.Fatal("embedded browser escaped its surface")
	}
	h.Close()
	h = NewWorkspaceHost(m.config, "", "")
	defer h.Close()
	detail = call(map[string]any{"action": "contact", "id": id}).(map[string]any)
	sessions := detail["sessions"].([]map[string]any)
	if len(sessions) != 1 || sessions[0]["id"] != first || requests.Load() != 1 {
		t.Fatal("reopen replayed or lost a computer conversation", detail)
	}
}
