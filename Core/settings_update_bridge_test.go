// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestUpdateBridgeUsesTrustedRouteOnly; TestRetiredFeedbackCannotReachAnyNetworkRoute
// Impact: python -B scripts/code-atlas.py show Core/settings_update_bridge_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUpdateBridgeUsesTrustedRouteOnly(t *testing.T) {
	var received map[string]json.RawMessage
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"phase":"login_required"}`))
	}))
	defer server.Close()
	s := NewSettingsService("")
	if err := s.SetCommunityBridge(server.URL + "/" + strings.Repeat("a", 64)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Community(context.Background(), json.RawMessage(`{"action":"_updates","arguments":{"action":"handoff"}}`)); err == nil {
		t.Fatal("Public sharing route accepted trusted update operation")
	}
	if received != nil {
		t.Fatal("Rejected request reached the host")
	}
	if _, err := s.CallTool(context.Background(), "updates", "fixture", json.RawMessage(`{"action":"status"}`)); err != nil {
		t.Fatal(err)
	}
	if string(received["action"]) != `"_updates"` || string(received["arguments"]) != `{"action":"status"}` {
		t.Fatalf("Unexpected trusted route: %v", received)
	}
}

func TestRetiredFeedbackCannotReachAnyNetworkRoute(t *testing.T) {
	var received map[string]json.RawMessage
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"items":[]}`))
	}))
	defer server.Close()
	s := NewSettingsService("")
	if err := s.SetCommunityBridge(server.URL + "/" + strings.Repeat("b", 64)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Community(context.Background(), json.RawMessage(`{"action":"_feedback","arguments":{"action":"queue"}}`)); err == nil {
		t.Fatal("Public sharing reached private feedback")
	}
	if received != nil {
		t.Fatal("Rejected request reached host")
	}
	session := strings.Repeat("c", 32)
	if _, err := s.CallTool(context.Background(), "feedback", session, json.RawMessage(`{"action":"list"}`)); err == nil {
		t.Fatal("Retired feedback route remained active")
	}
	if received != nil {
		t.Fatal("Retired feedback reached host")
	}
}
