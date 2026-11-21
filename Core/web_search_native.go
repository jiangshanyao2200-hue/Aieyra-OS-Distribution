// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: webSearchMaxUses; webSearcher; searchConfig; nativeSearchKind; newWebSearcher; adapter; search; searchBody
// Impact: python -B scripts/code-atlas.py show Core/web_search_native.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	searchapi "github.com/aieyra/aieyra-os/api/search"
	"net/http"
)

const webSearchMaxUses = searchapi.MaxUses

// Host connection snapshot. Protocol implementation belongs to API/search.
type webSearcher struct {
	multimodal                            bool
	kind, model, endpoint, responses, key string
	fallback                              func(context.Context, string) (WebSearchResult, error)
	client                                *http.Client
}

func searchConfig(s *Settings) searchapi.Config {
	if s == nil {
		return searchapi.Config{}
	}
	return searchapi.Config{BaseURL: s.BaseURL, APIKey: s.APIKey, Model: s.Model, Protocol: s.Protocol(), Native: !s.GenericAdapter(), Vision: s.ModelVision, System: webSearchSystem()}
}
func nativeSearchKind(s *Settings) string { return searchapi.Kind(searchConfig(s)) }
func newWebSearcher(s *Settings) webSearcher {
	c := searchapi.New(searchConfig(s))
	w := webSearcher{multimodal: c.Multimodal, kind: c.Kind, model: c.Model, endpoint: c.Endpoint, responses: c.Responses, key: c.Key, client: c.Client}
	if localSearchAvailable() {
		w.fallback = localWebSearch
	}
	return w
}
func (w webSearcher) adapter() searchapi.Client {
	return searchapi.Client{Multimodal: w.multimodal, Kind: w.kind, Model: w.model, Endpoint: w.endpoint, Responses: w.responses, Key: w.key, Client: w.client, Fallback: w.fallback, System: webSearchSystem()}
}
func (w webSearcher) search(ctx context.Context, q string) (WebSearchResult, error) {
	return w.adapter().Search(ctx, q)
}
func (w webSearcher) searchBody(q string) map[string]any { return w.adapter().Body(q) }
