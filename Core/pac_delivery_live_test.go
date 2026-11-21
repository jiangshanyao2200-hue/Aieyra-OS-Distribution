// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: livePACPaths; TestLivePACCurrentQwenSearchAndToolRoundTrip; TestLivePACLocalSearchFallback
// Impact: python -B scripts/code-atlas.py show Core/pac_delivery_live_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

//go:build live

package CORE

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Opt-in synthetic acceptance. No personal messages, memory, local files or
// credentials appear in provider prompts or receipts. No configuration writes.
func livePACPaths(t *testing.T) (string, string, string) {
	t.Helper()
	if os.Getenv("AIEYRA_REAL_MODEL_ACCEPTANCE") != "1" {
		t.Skip("explicit opt-in required")
	}
	source, root, out := os.Getenv("AIEYRA_REAL_CONFIG"), os.Getenv("AIEYRA_PAC_ROOT"), os.Getenv("AIEYRA_PAC_LIVE_OUT")
	if !filepath.IsAbs(source) || !filepath.IsAbs(root) || !filepath.IsAbs(out) {
		t.Fatal("explicit absolute paths required")
	}
	t.Setenv("AIEYRA_RESOURCE_ROOT", root)
	if err := os.MkdirAll(out, 0700); err != nil {
		t.Fatal(err)
	}
	return source, root, out
}

func TestLivePACCurrentQwenSearchAndToolRoundTrip(t *testing.T) {
	source, _, out := livePACPaths(t)
	s, err := Load(source)
	if err != nil {
		t.Fatal("cannot load selected model")
	}
	if !strings.HasPrefix(s.Model, "qwen") || !verifiedBailianEndpoint(s.BaseURL) || s.Protocol() != ProtocolChat {
		t.Fatal("current enabled Qwen official chat profile required")
	}
	if err = s.ValidatePoolRequest(); err != nil {
		t.Fatal("selected model pool invalid")
	}
	receipt := map[string]any{"model": s.Model, "at": time.Now().UTC().Format(time.RFC3339), "requests": 0}
	defer func() {
		b, _ := json.MarshalIndent(receipt, "", "  ")
		_ = os.WriteFile(filepath.Join(out, "qwen-current.json"), b, 0600)
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	search := newWebSearcher(s)
	search.fallback = nil
	started := time.Now()
	result := webSearch(context.WithValue(ctx, webSearchKey{}, search), executionCall("web_search", WebSearchRequest{Query: "Python 3.13 官方文档"}))
	receipt["requests"] = 1
	receipt["search_elapsed_ms"] = time.Since(started).Milliseconds()
	receipt["search"] = result
	if !result.OK {
		receipt["search_error"] = result.Error
		t.Errorf("native search failed: %v", result.Error)
	}
	if os.Getenv("AIEYRA_PAC_SEARCH_ONLY") == "1" {
		return
	}
	s = s.Clone()
	s.MaxTokens = 512
	s.ThinkingType = "disabled"
	s.SetStream(true)
	client := New(s)
	const nonce = "pac-delivery-nonce-42"
	const value = "verified-pac-result-91"
	defs := []ToolDefinition{{Type: "function", Name: "verify_pac", Description: "Return the nonce exactly to obtain the separate result.", Parameters: schemaObject(map[string]any{"nonce": schemaString()}, "nonce")}}
	history := []Message{{Role: RoleUser, Content: "Call verify_pac with nonce " + nonce + ". After the tool result, reply only with its value. This is a synthetic protocol test."}}
	for turn := 0; turn < 2; turn++ {
		var response *Message
		var usage *Usage
		for event := range client.StreamChatTools(ctx, s, history, defs) {
			if event.Err != nil {
				receipt["tools_error"] = "request did not complete"
				t.Fatal("tool roundtrip request failed")
			}
			if event.Kind == EventResponse {
				response = event.Message
			}
			if event.Usage != nil {
				usage = event.Usage
			}
		}
		receipt["requests"] = turn + 2
		if response == nil {
			t.Fatal("no completed response")
		}
		if turn == 0 {
			receipt["tool_calls"] = len(response.ToolCalls)
			receipt["first_usage"] = usage
			if len(response.ToolCalls) != 1 || response.ToolCalls[0].Function.Name != "verify_pac" {
				t.Fatal("expected one real function call")
			}
			var args struct{ Nonce string }
			if json.Unmarshal([]byte(response.ToolCalls[0].Function.Arguments), &args) != nil || args.Nonce != nonce {
				t.Fatal("nonce mismatch")
			}
			history = append(history, *response, Message{Role: RoleTool, ToolCallID: response.ToolCalls[0].ID, Content: value})
		} else {
			receipt["second_usage"] = usage
			receipt["tool_roundtrip_ok"] = strings.TrimSpace(response.Content) == value && len(response.ToolCalls) == 0
			if receipt["tool_roundtrip_ok"] != true {
				t.Fatal("tool result not reflected in final response")
			}
		}
	}
}

func TestLivePACLocalSearchFallback(t *testing.T) {
	_, _, out := livePACPaths(t)
	s := &Settings{BaseURL: "https://unsupported.invalid", Model: "synthetic-local-only"}
	started := time.Now()
	query := strings.TrimSpace(os.Getenv("AIEYRA_PAC_SEARCH_QUERY"))
	if query == "" {
		query = "Python documentation"
	}
	r := webSearch(WithWebSearch(context.Background(), s), executionCall("web_search", WebSearchRequest{Query: query}))
	b, _ := json.MarshalIndent(map[string]any{"elapsed_ms": time.Since(started).Milliseconds(), "result": r}, "", "  ")
	_ = os.WriteFile(filepath.Join(out, "local-fallback.json"), b, 0600)
	if !r.OK || r.Provider != "ddgs" || r.FallbackReason != "native_search_unavailable" {
		t.Fatalf("local fallback failed: %+v", r)
	}
	if len(r.Searches) == 0 || len(r.Searches[0].Results) == 0 {
		t.Fatal("search completed without matches; retained evidence")
	}
}
