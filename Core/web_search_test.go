// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: TestWebSearchPairsServerCallsWithResultsAndKeepsTheFinalBrief; TestWebSearchOnlyOnTheOfficialDeepSeekEntry; TestSearchOnlyTurnsRunAsToolsInParallel
// Impact: python -B scripts/code-atlas.py show Core/web_search_test.go
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
	"sync/atomic"
	"testing"
	"time"
)

func TestWebSearchPairsServerCallsWithResultsAndKeepsTheFinalBrief(t *testing.T) {
	var seen map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "sk-test" || r.URL.Path != "/anthropic/v1/messages" {
			t.Errorf("header or path: %q %q", r.Header.Get("x-api-key"), r.URL.Path)
		}
		data, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(data, &seen)
		_, _ = w.Write([]byte(`{"stop_reason":"end_turn","content":[
			{"type":"text","text":"我先搜一下。"},
			{"type":"server_tool_use","id":"call_a","name":"web_search","input":{"query":"DeepSeek 上下文"}},
			{"type":"server_tool_use","id":"call_b","name":"web_search","input":{"query":"DeepSeek context window"}},
			{"type":"web_search_tool_result","tool_use_id":"call_b","content":[{"type":"web_search_result","title":"B1","url":"https://b.example/1","encrypted_content":"secret","page_age":null}]},
			{"type":"web_search_tool_result","tool_use_id":"call_a","content":[{"type":"web_search_result","title":"A1","url":"https://a.example/1","encrypted_content":"x"},{"type":"web_search_result","title":"bad","url":"javascript:alert(1)"}]},
			{"type":"web_search_tool_result","tool_use_id":"call_c","content":{"type":"web_search_tool_result_error","error_code":"max_uses_exceeded"}},
			{"type":"text","text":"上下文为 1M（a.example）。"}]}`))
	}))
	defer server.Close()
	ctx := context.WithValue(context.Background(), webSearchKey{}, webSearcher{endpoint: server.URL + "/anthropic/v1/messages", key: "sk-test", client: server.Client()})
	r := webSearch(ctx, executionCall("web_search", WebSearchRequest{Query: "DeepSeek 上下文多大", Description: "查上下文"}))
	if !r.OK || r.State != "completed" || r.Answer != "上下文为 1M（a.example）。" {
		t.Fatalf("%+v", r)
	}
	if len(r.Searches) != 3 || r.Searches[0].Query != "DeepSeek 上下文" || r.Searches[0].Results[0].Title != "A1" || len(r.Searches[0].Results) != 1 || r.Searches[1].Results[0].URL != "https://b.example/1" || r.Searches[2].Error != "max_uses_exceeded" {
		t.Fatalf("%+v", r.Searches)
	}
	data, _ := json.Marshal(r)
	if strings.Contains(string(data), "secret") || strings.Contains(string(data), "javascript:") {
		t.Fatal("opaque or unsafe content leaked", string(data))
	}
	tools, _ := seen["tools"].([]any)
	thinking, _ := seen["thinking"].(map[string]any)
	if seen["model"] != ModelFlash || len(tools) != 1 || thinking["type"] != "disabled" || tools[0].(map[string]any)["max_uses"].(float64) != webSearchMaxUses {
		t.Fatalf("request %v", seen)
	}
}

func TestWebSearchOnlyOnTheOfficialDeepSeekEntry(t *testing.T) {
	official := &Settings{BaseURL: DefaultBaseURL + "/v1", APIKey: "sk"}
	if !SupportsWebSearch(official) {
		t.Fatal("official entry must support search")
	}
	for _, s := range []*Settings{nil, {BaseURL: DefaultBaseURL}, {BaseURL: "https://proxy.example/v1", APIKey: "sk"}, {BaseURL: DefaultBaseURL, APIKey: "sk", Adapter: "openai"}} {
		if SupportsWebSearch(s) {
			t.Fatalf("unexpected support %+v", s)
		}
	}
	r := webSearch(context.Background(), executionCall("web_search", WebSearchRequest{Query: "x"}))
	if r.OK || r.Error == nil || r.Error.Code != "search_unavailable" {
		t.Fatalf("%+v", r)
	}
	names := map[string]bool{}
	for _, d := range CodingToolDefinitions(official) {
		names[d.Name] = true
	}
	if !names["web_search"] {
		t.Fatal("web_search definition missing for the official entry")
	}
}

func TestSearchOnlyTurnsRunAsToolsInParallel(t *testing.T) {
	var running, peak int32
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if n := atomic.AddInt32(&running, 1); n > atomic.LoadInt32(&peak) {
			atomic.StoreInt32(&peak, n)
		}
		if atomic.LoadInt32(&running) == 2 {
			close(release)
		}
		select {
		case <-release:
		case <-time.After(3 * time.Second):
		}
		atomic.AddInt32(&running, -1)
		_, _ = w.Write([]byte(`{"content":[{"type":"server_tool_use","id":"s","name":"web_search","input":{"query":"q"}},{"type":"web_search_tool_result","tool_use_id":"s","content":[]},{"type":"text","text":"ok"}]}`))
	}))
	defer server.Close()
	m, err := NewShellManager(t.TempDir(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	ctx := context.WithValue(context.Background(), webSearchKey{}, webSearcher{endpoint: server.URL, key: "k", client: server.Client()})
	one, two := executionCall("web_search", WebSearchRequest{Query: "a"}), executionCall("web_search", WebSearchRequest{Query: "b"})
	one.ID, two.ID = "s1", "s2"
	turn, err := ExecuteToolTurn(ctx, &PlanEngine{}, m, Message{Role: RoleAssistant, ToolCalls: []ToolCall{one, two}}, "search-turn", func(string, any) error { return nil })
	if err != nil || len(turn.Messages) != 3 {
		t.Fatal(err, turn.Messages)
	}
	for _, msg := range turn.Messages[1:] {
		var r WebSearchResult
		if json.Unmarshal([]byte(msg.Content), &r) != nil || !r.OK || r.Answer != "ok" {
			t.Fatalf("search receipt %q", msg.Content)
		}
	}
	if atomic.LoadInt32(&peak) != 2 {
		t.Fatal("independent searches did not run in parallel", peak)
	}
}
