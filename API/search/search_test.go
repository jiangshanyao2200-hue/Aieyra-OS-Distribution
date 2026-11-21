// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: API/search/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestSearchTransportSourcesAndIsolation; TestFallbackRequiresExplicitUnsupportedAndRedactsErrors; TestSearchRedirectAndCancellationNeverFallback; TestSearchRequiresActualCompletionEvidence
// Impact: python -B scripts/code-atlas.py show API/search/search_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package search

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aieyra/aieyra-os/contracts/protocol"
)

func TestSearchTransportSourcesAndIsolation(t *testing.T) {
	const exact = "https://example.invalid/a%2Fb?q=one%20two&x=2#part"
	for _, tc := range []struct{ kind, base, protocol, header, response string }{
		{"openai", "https://api.openai.com/v1", protocol.ProtocolResponses, "Authorization", `{"status":"completed","output":[{"type":"web_search_call","status":"completed","action":{"sources":[{"url":"` + exact + `"},{"url":"` + exact + `"},{"url":"javascript:alert(1)"}]}},{"content":[{"type":"output_text","text":"answer"}]}]}`},
		{"anthropic", "https://api.anthropic.com/v1", protocol.ProtocolMessages, "x-api-key", `{"content":[{"type":"server_tool_use","id":"s","input":{"query":"q"}},{"type":"web_search_tool_result","tool_use_id":"s","content":[{"type":"web_search_result","url":"` + exact + `"}]},{"type":"text","text":"answer"}]}`},
		{"gemini", "https://generativelanguage.googleapis.com/v1beta", protocol.ProtocolGoogle, "x-goog-api-key", `{"candidates":[{"content":{"parts":[{"text":"private thought","thought":true},{"text":"answer"}]},"groundingMetadata":{"webSearchQueries":["q"],"groundingChunks":[{"web":{"uri":"` + exact + `"}}]}}]}`},
		{"qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1", protocol.ProtocolChat, "Authorization", `{"output":{"choices":[{"message":{"content":"answer"},"finish_reason":"stop"}],"search_info":{"search_results":[{"url":"` + exact + `"}]}}}`},
	} {
		t.Run(tc.kind, func(t *testing.T) {
			c := New(Config{BaseURL: tc.base, Protocol: tc.protocol, APIKey: "fixture-key", Model: "selected-model", System: "search-only"})
			if c.Kind != tc.kind {
				t.Fatal(c.Kind)
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if !strings.Contains(r.Header.Get(tc.header), "fixture-key") {
					t.Error("missing selected credential")
				}
				var body map[string]any
				if json.NewDecoder(r.Body).Decode(&body) != nil {
					t.Error("bad JSON")
				}
				if tc.kind != "gemini" && body["model"] != "selected-model" {
					t.Error("selected model lost")
				}
				fmt.Fprint(w, tc.response)
			}))
			defer server.Close()
			c.Endpoint = server.URL
			got, err := c.Search(context.Background(), "q")
			if err != nil || got.Answer != "answer" || got.Provider != tc.kind || len(got.Searches) != 1 || len(got.Searches[0].Results) != 1 || got.Searches[0].Results[0].URL != exact {
				t.Fatalf("%+v %v", got, err)
			}
		})
	}
	for _, base := range []string{"https://api.openai.com.evil.invalid/v1", "http://api.openai.com/v1", "https://user:@api.openai.com/v1", "https://api.openai.com:444/v1", "https://api.openai.com/v1?redirect=other"} {
		if Kind(Config{BaseURL: base, Protocol: protocol.ProtocolResponses, APIKey: "fixture-key"}) != "" {
			t.Fatal("untrusted origin admitted", base)
		}
	}
}

func TestFallbackRequiresExplicitUnsupportedAndRedactsErrors(t *testing.T) {
	for _, tc := range []struct {
		status   int
		body     string
		fallback bool
	}{
		{400, `{"error":{"message":"web_search is not supported"}}`, true},
		{422, `{"error":{"code":"unsupported_web_search"}}`, true},
		{401, `{"error":{"code":"unsupported_web_search","message":"fixture-secret"}}`, false},
		{429, `{"error":{"code":"unsupported_web_search","message":"fixture-secret"}}`, false},
		{500, `{"error":{"code":"unsupported_web_search","message":"fixture-secret"}}`, false},
		{400, `{"error":{"message":"invalid model fixture-secret"}}`, false},
	} {
		t.Run(fmt.Sprint(tc.status, tc.fallback), func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tc.status); fmt.Fprint(w, tc.body) }))
			defer s.Close()
			calls := 0
			c := New(Config{})
			c.Kind = "openai"
			c.Endpoint = s.URL
			c.Key = "fixture-secret"
			c.Fallback = func(context.Context, string) (WebSearchResult, error) {
				calls++
				return WebSearchResult{Provider: "ddgs"}, nil
			}
			r, err := c.Search(context.Background(), "q")
			if (calls == 1) != tc.fallback || (err == nil) != tc.fallback {
				t.Fatalf("fallback %d: %v", calls, err)
			}
			if err != nil && strings.Contains(err.Error(), c.Key) {
				t.Fatal("credential in diagnostic")
			}
			if tc.fallback && r.FallbackReason != "native_search_unsupported" {
				t.Fatal(r)
			}
		})
	}
}

func TestSearchRedirectAndCancellationNeverFallback(t *testing.T) {
	redirected := 0
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected++ }))
	defer target.Close()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer s.Close()
	c := New(Config{})
	c.Kind = "openai"
	c.Endpoint = s.URL
	c.Key = "fixture-secret"
	c.Fallback = func(context.Context, string) (WebSearchResult, error) {
		t.Error("unexpected fallback")
		return WebSearchResult{}, nil
	}
	if _, err := c.Search(context.Background(), "q"); err == nil || redirected != 0 {
		t.Fatal("redirect followed", err, redirected)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := c.Search(ctx, "q"); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	entered := make(chan struct{})
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		close(entered)
		<-r.Context().Done()
	}))
	defer slow.Close()
	c.Endpoint = slow.URL
	ctx, cancel = context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := c.Search(ctx, "q"); done <- err }()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("request did not start")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cancel did not release request")
	}
}

func TestSearchRequiresActualCompletionEvidence(t *testing.T) {
	for _, parse := range []func([]byte, *WebSearchResult) error{ParseOpenAI, ParseAnthropic, ParseGemini, ParseQwen} {
		if parse([]byte(`{"answer":"ordinary answer"}`), &WebSearchResult{}) == nil {
			t.Fatal("ordinary answer treated as a search")
		}
	}
	for _, raw := range []string{"https://user:secret@example.com/", "https:///missing", "https://example.invalid/" + strings.Repeat("a", 2000)} {
		if SafeURL(raw) {
			t.Fatal("invalid URL accepted")
		}
	}
	var r WebSearchResult
	if err := ParseAnthropic([]byte(`{"content":[{"type":"server_tool_use","id":"one","input":{"query":"q"}},{"type":"web_search_tool_result","tool_use_id":"one","content":[]}]}`), &r); err != nil || len(r.Searches) != 1 {
		t.Fatal("acknowledged empty search lost", r, err)
	}
}
