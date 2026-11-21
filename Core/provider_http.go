// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: WithProviderSession; OpenCode; OpenRouter; ChatReasoningField; NativeOutputLimit; providerHeaders; providerSessionIdentity; withPromptCacheKey
// Impact: python -B scripts/code-atlas.py show Core/provider_http.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"github.com/aieyra/aieyra-os/api/transport"
	"net/http"
	"net/url"
	"strings"
)

func WithProviderSession(ctx context.Context, id string) context.Context {
	return transport.WithSession(ctx, id)
}
func (s *Settings) OpenCode() bool {
	u, err := url.Parse(s.BaseURL)
	return err == nil && u.Hostname() == "opencode.ai"
}
func (s *Settings) OpenRouter() bool {
	u, err := url.Parse(s.BaseURL)
	return err == nil && u.Hostname() == "openrouter.ai"
}
func (s *Settings) ChatReasoningField() string {
	for _, p := range s.APIProfiles {
		if p.ID == s.ActiveProfile {
			return p.ReasoningField
		}
	}
	return ""
}
func (s *Settings) NativeOutputLimit() int {
	if s.MaxTokens > 0 {
		return s.MaxTokens
	}
	for _, p := range s.APIProfiles {
		if p.ID == s.ActiveProfile && p.OutputLimit > 0 {
			return p.OutputLimit
		}
	}
	return 8192
}
func (c *Client) providerHeaders(r *http.Request) { transport.ProviderHeaders(r, c.apiKey) }

// A restored home session gets a new executor ID. Its provider cache identity
// still belongs to the durable conversation; unrelated workers retain theirs.
func providerSessionIdentity(record AgentRecord) string {
	if record.Spec.WorkspaceRole == WorkspaceMatrix && record.LinkSession != "" {
		return record.LinkSession + "/" + WorkspaceMatrix
	}
	return record.ID
}

// 每个角色一把缓存键（最终搬家 R16 §4.3）：同一角色同一会话的请求落到同一缓存分区，
// 角色之间互不挤掉。只给支持 prompt_cache_key 的 GPT 系 Responses 通道带上；其他供应商按前缀自动缓存。
func withPromptCacheKey(ctx context.Context, s *Settings, r *ResponsesRequest) *ResponsesRequest {
	id := transport.SessionID(ctx)
	if id == "" || !s.GenericAdapter() || !(s.OpenCode() || strings.HasPrefix(strings.TrimPrefix(s.Model, "openai/"), "gpt-")) {
		return r
	}
	r.SetPromptCacheKey(transport.PromptCacheKey(ctx))
	return r
}
