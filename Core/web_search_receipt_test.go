// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestNativeSearchRejectsFailedOrUnfinishedToolReceipts; TestNativeSearchCompletedEmptyResultIsStillARealSearch; TestNativeSearchToolLevelUnsupportedUsesFallbackOnlyWhenExplicit; TestSearchCitationKeepsTheWholeValidatedURL
// Impact: python -B scripts/code-atlas.py show Core/web_search_receipt_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNativeSearchRejectsFailedOrUnfinishedToolReceipts(t *testing.T) {
	for _, tc := range []struct{ name, kind, body string }{
		{"anthropic-error", "anthropic", `{"content":[{"type":"server_tool_use","id":"s","name":"web_search","input":{"query":"q"}},{"type":"web_search_tool_result","tool_use_id":"s","content":{"type":"web_search_tool_result_error","error_code":"too_many_requests"}},{"type":"text","text":"an ungrounded answer"}]}`},
		{"anthropic-unfinished", "anthropic", `{"stop_reason":"max_tokens","content":[{"type":"server_tool_use","id":"s","name":"web_search","input":{"query":"q"}},{"type":"text","text":"search was requested"}]}`},
		{"openai-failed", "openai", `{"status":"completed","output":[{"type":"web_search_call","status":"failed","action":{"sources":[]}},{"type":"message","content":[{"type":"output_text","text":"an ungrounded answer"}]}]}`},
		{"openai-unfinished", "openai", `{"status":"incomplete","output":[{"type":"web_search_call","status":"in_progress","action":{"sources":[]}}]}`},
		{"qwen-invalid-sources", "qwen", `{"output":{"choices":[{"message":{"content":"answer"},"finish_reason":"stop"}],"search_info":{"search_results":[{"title":"unsafe","url":"javascript:alert(1)"}]}}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, tc.body) }))
			defer srv.Close()
			fallback := false
			s := webSearcher{kind: tc.kind, endpoint: srv.URL, client: srv.Client(), fallback: func(context.Context, string) (WebSearchResult, error) {
				fallback = true
				return WebSearchResult{}, nil
			}}
			ctx := context.WithValue(context.Background(), webSearchKey{}, s)
			r := webSearch(ctx, executionCall("web_search", WebSearchRequest{Query: "q"}))
			if r.OK || r.State == "completed" || r.Error == nil || fallback {
				t.Fatalf("failed/unfinished search counted as success or silently replaced: %+v fallback=%v", r, fallback)
			}
		})
	}
}

func TestNativeSearchCompletedEmptyResultIsStillARealSearch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"content":[{"type":"server_tool_use","id":"s","name":"web_search","input":{"query":"q"}},{"type":"web_search_tool_result","tool_use_id":"s","content":[]},{"type":"text","text":"No matching pages found."}]}`)
	}))
	defer srv.Close()
	s := webSearcher{kind: "anthropic", endpoint: srv.URL, client: srv.Client()}
	r, err := s.search(context.Background(), "q")
	if err != nil || len(r.Searches) != 1 || len(r.Searches[0].Results) != 0 {
		t.Fatalf("an acknowledged empty query must remain distinct from a failed query: %+v %v", r, err)
	}
}

func TestNativeSearchToolLevelUnsupportedUsesFallbackOnlyWhenExplicit(t *testing.T) {
	for _, code := range []string{"unsupported_web_search", "web_search_not_supported", "too_many_requests", "unavailable", "invalid_input"} {
		t.Run(code, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprintf(w, `{"content":[{"type":"web_search_tool_result","tool_use_id":"s","content":{"type":"web_search_tool_result_error","error_code":%q}}]}`, code)
			}))
			defer srv.Close()
			called := false
			s := webSearcher{kind: "anthropic", endpoint: srv.URL, client: srv.Client(), fallback: func(context.Context, string) (WebSearchResult, error) {
				called = true
				return WebSearchResult{Provider: "ddgs"}, nil
			}}
			r, err := s.search(context.Background(), "q")
			want := code == "unsupported_web_search" || code == "web_search_not_supported"
			if called != want || (err == nil) != want || want && r.FallbackReason != "native_search_unsupported" {
				t.Fatalf("wrong fallback decision: called=%v result=%+v err=%v", called, r, err)
			}
		})
	}
}

func TestSearchCitationKeepsTheWholeValidatedURL(t *testing.T) {
	address := "https://official.example/" + strings.Repeat("long-path/", 90) + "page?version=3.13#source"
	body := fmt.Sprintf(`{"content":[{"type":"server_tool_use","id":"s","name":"web_search","input":{"query":"q"}},{"type":"web_search_tool_result","tool_use_id":"s","content":[{"type":"web_search_result","title":"Official","url":%q}]}]}`, address)
	var r WebSearchResult
	if err := parseWebSearch([]byte(body), &r); err != nil || len(r.Searches) != 1 || len(r.Searches[0].Results) != 1 || r.Searches[0].Results[0].URL != address {
		t.Fatalf("validated citation was shortened into a different URL: %+v %v", r, err)
	}
}
