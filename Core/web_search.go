// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: WebSearchRequest; WebSearchHit; WebSearchRound; WebSearchResult; webSearchKey; webSearchSystem; SupportsWebSearch; WithWebSearch; WebSearchToolDefinition; webSearchResultFromCall; webSearch
// Impact: python -B scripts/code-atlas.py show Core/web_search.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	searchtool "github.com/aieyra/aieyra-os/tool/base/official/web_search"
	contract "github.com/aieyra/aieyra-os/tool/base/official/web_search/contract"
)

type WebSearchRequest = contract.Request
type WebSearchHit = contract.Hit
type WebSearchRound = contract.Round
type WebSearchResult = contract.Result
type webSearchKey struct{}

func webSearchSystem() string { return runtimePrompt("Matrix/辅助指令/网络搜索.txt") }
func SupportsWebSearch(s *Settings) bool {
	return s != nil && (nativeSearchKind(s) != "" || localSearchAvailable())
}
func WithWebSearch(ctx context.Context, s *Settings) context.Context {
	if !SupportsWebSearch(s) {
		return ctx
	}
	return context.WithValue(ctx, webSearchKey{}, newWebSearcher(s))
}
func WebSearchToolDefinition() ToolDefinition {
	d := searchtool.Definition()
	d.Description = runtimePrompt("Matrix/工具说明/联网查询用途.txt") + runtimePrompt("Matrix/工具说明/联网查询方式.txt") + runtimePrompt("Matrix/工具说明/联网查询结果.txt")
	return d
}
func webSearchResultFromCall(call ToolCall) WebSearchResult {
	var req WebSearchRequest
	_ = json.Unmarshal([]byte(call.Function.Arguments), &req)
	return WebSearchResult{State: "queued", Query: req.Query, Description: req.Description}
}
func webSearch(ctx context.Context, call ToolCall) WebSearchResult {
	if err := admitOfficialToolCall(ctx, call); err != nil {
		return WebSearchResult{State: "rejected", Error: &contract.Error{Code: "tool_package_disabled", Message: err.Error()}}
	}
	var req WebSearchRequest
	if err := decodeShellArgs(call.Function.Arguments, &req); err != nil {
		return WebSearchResult{State: "rejected", Error: &contract.Error{Code: "invalid_arguments", Message: err.Error()}}
	}
	var backend searchtool.Search
	selected, ok := ctx.Value(webSearchKey{}).(webSearcher)
	if ok {
		backend = selected.search
	}
	r := searchtool.Execute(ctx, req, backend)
	if r.Error != nil {
		r.Error.Message = redactSecretEncodings(r.Error.Message, []string{selected.key})
	}
	return r
}
