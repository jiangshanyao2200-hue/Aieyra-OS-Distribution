// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Contracts/search/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: WebSearchRequest; WebSearchHit; WebSearchRound; WebSearchResult; Error
// Impact: python -B scripts/code-atlas.py show Contracts/search/result.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package search

type WebSearchRequest struct {
	Query       string `json:"query"`
	Description string `json:"description,omitempty"`
}

type WebSearchHit struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	PageAge string `json:"page_age,omitempty"`
	Snippet string `json:"snippet,omitempty"`
}

type WebSearchRound struct {
	Query   string         `json:"query"`
	Results []WebSearchHit `json:"results,omitempty"`
	Total   int            `json:"total,omitempty"`
	Error   string         `json:"error,omitempty"`
}

type WebSearchResult struct {
	Provider       string           `json:"provider,omitempty"`
	RetrievedAt    string           `json:"retrieved_at,omitempty"`
	FallbackReason string           `json:"fallback_reason,omitempty"`
	OK             bool             `json:"ok"`
	State          string           `json:"state"`
	Query          string           `json:"query"`
	Description    string           `json:"description,omitempty"`
	Searches       []WebSearchRound `json:"searches,omitempty"`
	Answer         string           `json:"answer,omitempty"`
	Truncated      bool             `json:"truncated,omitempty"`
	Error          *Error           `json:"error,omitempty"`
}

type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
