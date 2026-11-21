// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestNativeSearchProtocolsAndCitations; TestNativeSearchFallbackOnlyForExplicitUnsupported; TestNativeSearchDoesNotInventGroundingOrTrustRelayName; TestQwenMultimodalSearchStreamRequiresCompleteSourceEvidence; TestQwenNativeWithoutSourcesUsesResponsesReceipt
// Impact: python -B scripts/code-atlas.py show Core/web_search_native_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNativeSearchProtocolsAndCitations(t *testing.T) {
	cases := []struct {
		kind, header, response string
		check                  func(map[string]any) bool
	}{
		{"openai", "Authorization", `{"status":"completed","output":[{"type":"web_search_call","status":"completed","action":{"sources":[{"type":"url","url":"https://official.example/a"}]}},{"type":"message","content":[{"type":"output_text","text":"answer","annotations":[{"type":"url_citation","title":"Official","url":"https://official.example/a"}]}]}]}`, func(b map[string]any) bool { return b["store"] == false && b["tool_choice"] == "required" }},
		{"gemini", "x-goog-api-key", `{"candidates":[{"content":{"parts":[{"text":"answer"}]},"groundingMetadata":{"webSearchQueries":["q"],"groundingChunks":[{"web":{"title":"Official","uri":"https://official.example/a"}}]}}]}`, func(b map[string]any) bool { return b["contents"] != nil && b["tools"] != nil }},
		{"qwen", "Authorization", `{"output":{"choices":[{"message":{"content":"answer"},"finish_reason":"stop"}],"search_info":{"search_results":[{"title":"Official","url":"https://official.example/a"}]}}}`, func(b map[string]any) bool {
			p, ok := b["parameters"].(map[string]any)
			return ok && p["enable_search"] == true && b["input"] != nil
		}},
		{"anthropic", "x-api-key", `{"content":[{"type":"server_tool_use","id":"s","input":{"query":"q"}},{"type":"web_search_tool_result","tool_use_id":"s","content":[{"type":"web_search_result","title":"Official","url":"https://official.example/a"}]},{"type":"text","text":"answer"}]}`, func(b map[string]any) bool { return b["tools"] != nil && b["thinking"] == nil }},
	}
	for _, tc := range cases {
		t.Run(tc.kind, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if !strings.Contains(r.Header.Get(tc.header), "key") {
					t.Error("missing provider auth")
				}
				data, _ := io.ReadAll(r.Body)
				var b map[string]any
				_ = json.Unmarshal(data, &b)
				if !tc.check(b) || b["model"] != nil && b["model"] != "selected-model" {
					t.Errorf("bad body %s", data)
				}
				fmt.Fprint(w, tc.response)
			}))
			defer srv.Close()
			ctx := context.WithValue(context.Background(), webSearchKey{}, webSearcher{kind: tc.kind, endpoint: srv.URL, key: "key", model: "selected-model", client: srv.Client()})
			r := webSearch(ctx, executionCall("web_search", WebSearchRequest{Query: "q"}))
			if !r.OK || r.Answer != "answer" || r.RetrievedAt == "" || r.Provider != tc.kind || len(r.Searches) != 1 || len(r.Searches[0].Results) != 1 || r.Searches[0].Results[0].URL != "https://official.example/a" {
				t.Fatalf("bad receipt %+v", r)
			}
		})
	}
}

func TestNativeSearchFallbackOnlyForExplicitUnsupported(t *testing.T) {
	for _, tc := range []struct {
		status   int
		body     string
		fallback bool
	}{
		{400, `{"error":{"message":"web_search is not supported by this model"}}`, true},
		{422, `{"error":{"code":"unsupported_web_search"}}`, true},
		{400, `{"message":"enable_search is not supported"}`, true},
		{401, `{"error":{"message":"unsupported web_search: wrong key"}}`, false},
		{429, `{"error":{"code":"unsupported_web_search"}}`, false},
		{500, `{"error":{"code":"unsupported_web_search"}}`, false},
		{400, `{"error":{"message":"invalid max_tokens"}}`, false},
		{404, `{"error":{"message":"model not found"}}`, false},
	} {
		t.Run(fmt.Sprint(tc.status, tc.body), func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tc.status); fmt.Fprint(w, tc.body) }))
			defer srv.Close()
			called := false
			s := webSearcher{kind: "openai", endpoint: srv.URL, client: srv.Client(), fallback: func(ctx context.Context, q string) (WebSearchResult, error) {
				called = true
				return WebSearchResult{Provider: "ddgs"}, nil
			}}
			r, err := s.search(context.Background(), "q")
			if called != tc.fallback || (err == nil) != tc.fallback {
				t.Fatalf("called=%v err=%v", called, err)
			}
			if called && r.FallbackReason != "native_search_unsupported" {
				t.Fatal("missing fallback provenance")
			}
		})
	}
}

func TestNativeSearchDoesNotInventGroundingOrTrustRelayName(t *testing.T) {
	for _, base := range []string{"https://api.openai.com.evil.example/v1", "http://api.openai.com/v1", "https://api.anthropic.com.evil.example/v1", "https://relay.example/v1"} {
		if nativeSearchKind(&Settings{BaseURL: base, APIKey: "key", Model: "gpt-5"}) != "" {
			t.Fatal("recognized unknown origin", base)
		}
	}
	s := &Settings{BaseURL: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", APIKey: "key", Model: "qwen-plus", APIProtocol: ProtocolChat}
	w := newWebSearcher(s)
	if w.kind != "qwen" || !strings.Contains(w.endpoint, "workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/text-generation/generation") {
		t.Fatal(w.kind, w.endpoint)
	}
	for _, parse := range []func([]byte, *WebSearchResult) error{parseOpenAISearch, parseGeminiSearch, parseQwenSearch} {
		if parse([]byte(`{}`), &WebSearchResult{}) == nil {
			t.Fatal("no search evidence accepted")
		}
	}
	for _, u := range []string{"javascript:alert(1)", "https://user:secret@example.com/a", "https:///missing"} {
		if safeSearchURL(u) {
			t.Fatal("unsafe source", u)
		}
	}
}

func TestQwenMultimodalSearchStreamRequiresCompleteSourceEvidence(t *testing.T) {
	s := &Settings{BaseURL: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", APIKey: "key", Model: "qwen3.8-max", APIProtocol: ProtocolChat}
	w := newWebSearcher(s)
	if !w.multimodal || !strings.Contains(w.endpoint, "multimodal-generation/generation") {
		t.Fatal("multimodal model used text endpoint")
	}
	b := w.searchBody("q")
	params := b["parameters"].(map[string]any)
	if params["incremental_output"] != true {
		t.Fatal("multimodal search must stream")
	}
	stream := `data: {"output":{"search_info":{"search_results":[{"title":"Official","url":"https://official.example/a"}]},"choices":[{"message":{"content":[{"text":"first "}]},"finish_reason":"null"}]}}

data: {"output":{"choices":[{"message":{"content":[{"text":"answer"}]},"finish_reason":"stop"}]}}

`
	var r WebSearchResult
	if err := parseQwenSearch([]byte(stream), &r); err != nil || r.Answer != "first answer" || len(r.Searches) != 1 {
		t.Fatal(r, err)
	}
	partial := strings.Split(stream, "data: ")[1]
	if err := parseQwenSearch([]byte("data: "+partial), &WebSearchResult{}); err == nil {
		t.Fatal("partial stream counted complete")
	}
}

func TestQwenNativeWithoutSourcesUsesResponsesReceipt(t *testing.T) {
	for _, withSources := range []bool{true, false} {
		calls := []string{}
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls = append(calls, r.URL.Path)
			if r.URL.Path == "/responses" {
				sources := `[]`
				if withSources {
					sources = `[{"type":"url","url":"https://official.example/a"}]`
				}
				fmt.Fprintf(w, `{"status":"completed","output":[{"type":"web_search_call","status":"completed","action":{"sources":%s}},{"type":"message","content":[{"type":"output_text","text":"cited"}]}]}`, sources)
				return
			}
			io.WriteString(w, `{"output":{"choices":[{"message":{"content":"uncited"},"finish_reason":"stop"}]}}`)
		}))
		s := webSearcher{kind: "qwen", endpoint: srv.URL + "/native", responses: srv.URL + "/responses", key: "key", model: "qwen3.8-max", client: srv.Client()}
		r, err := s.search(context.Background(), "q")
		srv.Close()
		if len(calls) != 2 || calls[1] != "/responses" {
			t.Fatalf("calls %v", calls)
		}
		if withSources && (err != nil || r.Answer != "cited" || len(r.Searches) != 1 || r.Searches[0].Results[0].URL != "https://official.example/a") {
			t.Fatalf("responses receipt: %+v %v", r, err)
		}
		if !withSources && (err == nil || !strings.Contains(err.Error(), "没有返回搜索来源")) {
			t.Fatalf("no sources must still fail: %+v %v", r, err)
		}
	}
}
