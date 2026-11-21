// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: SnapshotActiveProfile; APIProfile; GenericAdapter; ProviderIdentity; ModelName
// Impact: python -B scripts/code-atlas.py show Core/provider.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/api/adapter"
	"strings"
)

// 兼容终端配置页也要保持活动配置身份；新接口仍由共享服务探测后接入。
func (s *Settings) SnapshotActiveProfile() error {
	if s.ActiveProfile == "" {
		return nil
	}
	for i := range s.APIProfiles {
		p := &s.APIProfiles[i]
		if p.ID != s.ActiveProfile {
			continue
		}
		if p.Model != s.Model || NormalizeBaseURL(p.BaseURL) != NormalizeBaseURL(s.BaseURL) || p.Protocol != s.Protocol() || p.Adapter != s.Adapter {
			return fmt.Errorf("当前模型配置身份已改变，请从原生设置选择模型；新接口使用工具箱探测后保存")
		}
		if !s.envAPIKey {
			if s.ModelPoolVersion == 1 {
				for j := range s.ProviderConnections {
					if s.ProviderConnections[j].ID == p.ConnectionID {
						s.ProviderConnections[j].APIKey = s.APIKey
						s.ProviderConnections[j].APIKeyHistory = append([]string(nil), s.APIKeyHistory...)
						s.ProviderConnections[j].RequestTimeout = s.RequestTimeout
					}
				}
				p.APIKey, p.APIKeyHistory = "", nil
			} else {
				p.APIKey, p.APIKeyHistory = s.APIKey, append([]string(nil), s.APIKeyHistory...)
			}
		}
		p.Parameters, _ = json.Marshal(map[string]any{"max_tokens": s.MaxTokens, "temperature": s.Temperature, "top_p": s.TopP, "thinking_type": s.ThinkingType, "reasoning_effort": s.ReasoningEffort, "response_format": s.ResponseFormat, "stream": s.StreamEnabled(), "stream_include_usage": s.IncludeUsage, "user_id": s.UserID, "model_options": s.ModelOptions})
		return nil
	}
	return fmt.Errorf("当前模型配置不存在，请重新读取设置")
}

// 配置清单由共享设置服务维护；CORE 只读取当前活动配置的请求快照。
type APIProfile struct {
	Kind                string             `json:"kind,omitempty"`
	AdapterPackage      *adapter.Selection `json:"adapter_package,omitempty"`
	ConnectionID        string             `json:"connection_id,omitempty"`
	Enabled             *bool              `json:"enabled,omitempty"`
	Free                *bool              `json:"free,omitempty"`
	FreeSource          string             `json:"free_source,omitempty"`
	PopularityRank      int                `json:"popularity_rank,omitempty"`
	Reasoning           bool               `json:"reasoning,omitempty"`
	ParameterSpecs      []ParameterSpec    `json:"parameter_specs,omitempty"`
	SupportedParameters []string           `json:"supported_parameters,omitempty"`
	Provider            string             `json:"provider,omitempty"`
	OutputLimit         int                `json:"output_limit,omitempty"`
	ReasoningField      string             `json:"reasoning_field,omitempty"`
	ID                  string             `json:"id"`
	Name                string             `json:"name"`
	BaseURL             string             `json:"base_url"`
	APIKey              string             `json:"api_key"`
	Model               string             `json:"model"`
	Protocol            string             `json:"api_protocol"`
	Adapter             string             `json:"adapter"`
	ContextWindow       int                `json:"context_window"`
	ContextWindowLimit  int                `json:"context_window_limit,omitempty"`
	CompactAtTokens     *int               `json:"compact_at_tokens,omitempty"`
	ContextWindowSource string             `json:"context_window_source,omitempty"`
	ToolCalls           bool               `json:"tool_calls"`
	ResponseVerified    bool               `json:"response_verified,omitempty"`
	Vision              bool               `json:"vision"`
	APIKeyHistory       []string           `json:"api_key_history,omitempty"`
	Parameters          json.RawMessage    `json:"parameters,omitempty"`
	VerifiedOptions     json.RawMessage    `json:"verified_options,omitempty"`
}

func (s *Settings) GenericAdapter() bool { return s.Adapter == "openai" }
func (s *Settings) ProviderIdentity() string {
	identity := NormalizeBaseURL(s.BaseURL) + "|" + s.Protocol() + "|" + s.Model
	if selected := s.apiAdapterSelection(); selected != nil {
		identity += "|adapter:" + selected.ID + "@" + selected.Digest
	}
	return identity
}
func (s *Settings) ModelName() string {
	if s.ModelPoolVersion == 1 && s.ActiveProfile == "" {
		if s.Language == "en-US" {
			return "No model selected"
		}
		return "未选择模型"
	}
	for _, p := range s.APIProfiles {
		if p.ID == s.ActiveProfile && p.Name != "" {
			return p.Name
		}
	}
	if m, ok := LookupModel(s.Model); ok {
		return m.Name
	}
	return strings.TrimSpace(s.Model)
}
