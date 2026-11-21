// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestBrowserWorkspaceIdentityBeforeFirstTurn; TestEmbeddedBrowserRoutingAndCancellation; TestEmbeddedBrowserRegistrationRejectsNonlocalEndpoints
// Impact: python -B scripts/code-atlas.py show Core/settings_browser_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestBrowserWorkspaceIdentityBeforeFirstTurn(t *testing.T) {
	w := &Workspace{state: workspaceState{ID: "workspace-one"}}
	main := context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{w, WorkspaceMatrix})
	if got := browserSession(main, "agent-generation"); got != "workspace-one" {
		t.Fatalf("main browser identity %q", got)
	}
	other := context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{w, "conversation"})
	if got := browserSession(other, "other-agent"); got != "other-agent" {
		t.Fatalf("independent agent inherited workspace browser: %q", got)
	}
	if got := browserSession(context.Background(), "standalone"); got != "standalone" {
		t.Fatalf("standalone browser identity %q", got)
	}
}

func TestEmbeddedBrowserRoutingAndCancellation(t *testing.T) {
	secret := "/" + strings.Repeat("a", 64)
	started, cancelled := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != secret {
			t.Errorf("unexpected capability path")
			return
		}
		data, _ := io.ReadAll(r.Body)
		var request struct {
			Owner     string `json:"owner"`
			Arguments struct {
				Action string `json:"action"`
			} `json:"arguments"`
		}
		if err := json.Unmarshal(data, &request); err != nil || request.Owner != "owner-one" {
			t.Errorf("owner lost: %s", data)
			return
		}
		if request.Arguments.Action == "wait" {
			close(started)
			<-r.Context().Done()
			close(cancelled)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true,"tabs":[]}`))
	}))
	defer server.Close()
	s := NewSettingsService("unused-config")
	if err := s.SetBrowserBridge(server.URL + secret); err != nil {
		t.Fatal(err)
	}
	result, err := s.CallTool(context.Background(), "browser", "owner-one", json.RawMessage(`{"action":"tabs"}`))
	if err != nil || string(result) != `{"ok":true,"tabs":[]}` {
		t.Fatalf("embedded route: %s %v", result, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := s.CallTool(ctx, "browser", "owner-one", json.RawMessage(`{"action":"wait"}`))
		done <- err
	}()
	<-started
	cancel()
	if err := <-done; err == nil || !strings.Contains(err.Error(), "outcome unknown") {
		t.Fatalf("missing interruption receipt: %v", err)
	}
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("HTTP cancellation not forwarded")
	}
}

func TestEmbeddedBrowserRegistrationRejectsNonlocalEndpoints(t *testing.T) {
	s := NewSettingsService("unused-config")
	for _, raw := range []string{"https://127.0.0.1:123/" + strings.Repeat("a", 64), "http://example.com:123/" + strings.Repeat("a", 64), "http://127.0.0.1:123/short", "http://user@127.0.0.1:123/" + strings.Repeat("a", 64)} {
		if err := s.SetBrowserBridge(raw); err == nil {
			t.Errorf("accepted %s", raw)
		}
	}
}
