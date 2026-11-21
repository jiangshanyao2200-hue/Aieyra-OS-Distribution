// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/transport/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestRedirectDoesNotReplayCredentialsOrBody; TestSessionPartitionsAreStableAndHeadersAreScoped; TestHTTPErrorClassificationSurvivesWrapping
// Impact: python -B scripts/code-atlas.py show API/transport/client_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package transport

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestRedirectDoesNotReplayCredentialsOrBody(t *testing.T) {
	var received atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { received.Add(1) }))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture-key" {
			t.Error("source did not receive credentials")
		}
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer source.Close()
	client := NewClient(time.Second)
	defer client.CloseIdleConnections()
	req, _ := http.NewRequest(http.MethodPost, source.URL, strings.NewReader(`{"private":"fixture"}`))
	ProviderHeaders(req, "fixture-key")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusTemporaryRedirect || received.Load() != 0 {
		t.Fatal("redirect replayed provider request")
	}
}

func TestSessionPartitionsAreStableAndHeadersAreScoped(t *testing.T) {
	ctx := WithSession(context.Background(), "session/role-a")
	a := PromptCacheKey(ctx)
	if a == "" || a != PromptCacheKey(WithSession(context.Background(), "session/role-a")) || a == PromptCacheKey(WithSession(ctx, "session/role-b")) || strings.Contains(a, "session/") {
		t.Fatal("cache partition lost identity or exposed session")
	}
	if PromptCacheKey(context.Background()) != "" {
		t.Fatal("invented a session")
	}
	for _, host := range []string{"opencode.ai", "opencode.ai.attacker.invalid", "other.invalid"} {
		r, _ := http.NewRequestWithContext(ctx, http.MethodPost, "https://"+host+"/v1", nil)
		ProviderHeaders(r, "fixture-key")
		if (r.Header.Get("x-opencode-session") != "") != (host == "opencode.ai") {
			t.Fatalf("session header scope: %s", host)
		}
	}
	r, _ := http.NewRequestWithContext(WithSession(ctx, "bad\r\nheader"), http.MethodPost, "https://opencode.ai/v1", nil)
	ProviderHeaders(r, "fixture-key")
	if r.Header.Get("x-opencode-session") != "" {
		t.Fatal("accepted header injection")
	}
}

func TestHTTPErrorClassificationSurvivesWrapping(t *testing.T) {
	for _, tc := range []struct {
		body, category string
		status         int
	}{
		{`{"error":{"message":"busy","code":"overloaded"}}`, "http_503", 503},
		{`{"error":{"message":"insufficient balance","code":"insufficient_quota"}}`, "", 429},
		{`{"error":{"code":"insufficient_quota"}}`, "", 429},
		{`{"code":"ACCOUNTS_COOLING_DOWN"}`, "", 429},
		{`{"error":"denied"}`, "", 403},
		{`{"message":"rate limit","code":"slow"}`, "http_429", 429},
	} {
		r := &http.Response{StatusCode: tc.status, Header: http.Header{"Retry-After": []string{"2"}}, Body: io.NopCloser(strings.NewReader(tc.body))}
		err := fmt.Errorf("model: %w", ParseAPIError(r))
		var api *APIError
		if !errors.As(err, &api) || api.RetryAfter != 2*time.Second || TransientRequestError(err) != tc.category {
			t.Fatalf("classification: %v", err)
		}
	}
	if TransientRequestError(context.Canceled) != "" || TransientRequestError(context.DeadlineExceeded) != "timeout" {
		t.Fatal("cancellation classification")
	}
}
