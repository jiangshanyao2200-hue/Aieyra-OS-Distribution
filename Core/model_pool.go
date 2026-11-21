// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ProviderConnection; ParameterSpec; validateRequestSettings; rejectedModelStream; cloneOptions; activePoolProfile; ValidatePoolRequest; validModelOption; numberOption; applyPoolProfile
// Impact: python -B scripts/code-atlas.py show Core/model_pool.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/api/catalog"
	"github.com/aieyra/aieyra-os/api/parameters"
	"strings"
)

type ProviderConnection struct {
	Enabled        *bool    `json:"enabled,omitempty"`
	ID             string   `json:"id"`
	Provider       string   `json:"provider"`
	BaseURL        string   `json:"base_url"`
	APIKey         string   `json:"api_key"`
	APIKeyHistory  []string `json:"api_key_history"`
	RequestTimeout int      `json:"request_timeout_seconds"`
}
type ParameterSpec = parameters.Spec

// 在调用线程验证当前池状态；已在途的请求使用各自快照，不读取热更新后的指针。
func (c *Client) validateRequestSettings(s *Settings) error {
	if !sameAdapter(c.adapterSelection, s.apiAdapterSelection()) {
		return fmt.Errorf("API适配包已更新，请重新建立请求客户端")
	}
	if s.defaultsErr != nil {
		return s.defaultsErr
	}
	if err := validateRuntimeResources(); err != nil {
		return err
	}
	if err := s.ValidatePoolRequest(); err != nil {
		return err
	}
	if s.ModelPoolVersion != 1 && c.poolModel == "" {
		return nil
	}
	if s.ModelPoolVersion != 1 || NormalizeBaseURL(s.BaseURL) != c.baseURL || s.Protocol() != c.protocol || strings.TrimSpace(s.APIKey) != c.apiKey || c.poolModel != s.Model {
		return fmt.Errorf("模型或连接已更新，请重新建立请求客户端")
	}
	return nil
}
func rejectedModelStream(err error) <-chan Event {
	out := make(chan Event, 1)
	out <- Event{Kind: EventError, Err: err}
	close(out)
	return out
}

func cloneOptions(o map[string]any) map[string]any {
	if o == nil {
		return nil
	}
	b, _ := json.Marshal(o)
	var out map[string]any
	_ = json.Unmarshal(b, &out)
	return out
}
func (s *Settings) activePoolProfile() *APIProfile {
	for i := range s.APIProfiles {
		if s.APIProfiles[i].ID == s.ActiveProfile {
			return &s.APIProfiles[i]
		}
	}
	return nil
}
func (s *Settings) ValidatePoolRequest() error {
	if kind := catalog.MuseKind(s.BaseURL, s.Model); kind != "" {
		if kind != "chat" {
			return fmt.Errorf("Muse 媒体型号需要专用的图片或视频入口，不能用于聊天请求")
		}
		if s.Protocol() != ProtocolChat {
			return fmt.Errorf("Muse Spark 当前使用 Chat Completions 协议")
		}
	}
	if s.ModelPoolVersion != 1 {
		return nil
	}
	p := s.activePoolProfile()
	if p == nil || p.Enabled != nil && !*p.Enabled {
		return fmt.Errorf("请先在模型池启用并选择一个模型")
	}
	if p.Kind != "" && p.Kind != "chat" {
		return fmt.Errorf("媒体模型不能担任对话角色")
	}
	if p.Model != s.Model || NormalizeBaseURL(p.BaseURL) != NormalizeBaseURL(s.BaseURL) || p.Protocol != s.Protocol() || p.Adapter != s.Adapter {
		return fmt.Errorf("当前请求与模型池中的配置不一致，请重新选择模型")
	}
	// A saved chat configuration can be used before an explicit connection
	// test. Capability evidence stays unchanged; the actual request reports
	// any provider error without requiring a paid probe during model setup.
	found := false
	for _, c := range s.ProviderConnections {
		if c.ID == p.ConnectionID && NormalizeBaseURL(c.BaseURL) == NormalizeBaseURL(p.BaseURL) {
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("模型的供应商连接不存在，请在设置中重新配置")
	}
	if err := validateCatalogContext(s, p); err != nil {
		return err
	}
	if err := validateCatalogThinking(s, p); err != nil {
		return err
	}
	paths := []string{}
	keys := map[string]bool{}
	for _, f := range p.ParameterSpecs {
		if keys[f.Key] {
			return fmt.Errorf("参数规格重复")
		}
		keys[f.Key] = true
		if len(f.WirePath) == 0 {
			continue
		}
		if !validProfileParameterPath(p, f) {
			return fmt.Errorf("参数 %s 映射无效", f.Key)
		}
		path := strings.Join(f.WirePath, ".")
		for _, prior := range paths {
			if prior == path || strings.HasPrefix(prior, path+".") || strings.HasPrefix(path, prior+".") {
				return fmt.Errorf("参数映射重复")
			}
		}
		paths = append(paths, path)
	}
	for key, value := range s.ModelOptions {
		if samplingParameter(key) {
			continue
		}
		if rule, ok := catalogRule(p); ok && key == "reasoning_budget" && rule.IgnoreBudget {
			continue
		}
		var def *ParameterSpec
		for i := range p.ParameterSpecs {
			if p.ParameterSpecs[i].Key == key {
				def = &p.ParameterSpecs[i]
				break
			}
		}
		if def == nil || !validModelOption(*def, value) {
			return fmt.Errorf("模型参数 %s 不受支持或超出范围", key)
		}
	}
	if p.OutputLimit > 0 && s.MaxTokens > p.OutputLimit {
		return fmt.Errorf("最大输出超过该模型的 %d 令牌限制", p.OutputLimit)
	}
	if _, has := s.ModelOptions["reasoning_budget"]; has {
		rule, _ := catalogRule(p)
		if _, other := s.ModelOptions["reasoning_effort"]; other && !rule.IgnoreBudget {
			return fmt.Errorf("思考预算和思考强度只能设置一种")
		}
	}
	return nil
}
func validModelOption(f ParameterSpec, value any) bool { return parameters.ValidValue(f, value) }
func numberOption(value any) (float64, bool)           { return parameters.Number(value) }

// 连接与池内参数是持久化来源；顶层值只作为本次请求的兼容快照。
func (s *Settings) applyPoolProfile() {
	if s.ModelPoolVersion != 1 {
		return
	}
	for i := range s.APIProfiles {
		upgradeKnownProfile(&s.APIProfiles[i])
		enrichCatalogProfile(&s.APIProfiles[i])
		migrateProfileCompact(s, &s.APIProfiles[i])
	}
	s.clearInvalidSubconsciousProfile()
	p := s.activePoolProfile()
	if p == nil || p.Enabled != nil && !*p.Enabled {
		s.APIKey = ""
		return
	}
	values := Defaults()
	_ = json.Unmarshal(p.Parameters, values)
	s.MaxTokens = values.MaxTokens
	s.Temperature = values.Temperature
	s.TopP = values.TopP
	s.ThinkingType = values.ThinkingType
	s.ReasoningEffort = values.ReasoningEffort
	s.ResponseFormat = values.ResponseFormat
	s.Stream = values.Stream
	s.IncludeUsage = values.IncludeUsage
	s.UserID = values.UserID
	s.ModelOptions = cloneOptions(values.ModelOptions)
	s.Model = p.Model
	s.BaseURL = p.BaseURL
	s.APIProtocol = p.Protocol
	s.Adapter = p.Adapter
	s.ModelContextWindow = p.ContextWindow
	if p.CompactAtTokens != nil {
		compact := *p.CompactAtTokens
		s.CompactAtTokens = &compact
	}
	s.ModelVision = SupportsToolImages(s)
	s.APIKey = ""
	s.envAPIKey = false
	for _, c := range s.ProviderConnections {
		if c.ID == p.ConnectionID && NormalizeBaseURL(c.BaseURL) == NormalizeBaseURL(p.BaseURL) {
			s.APIKey = c.APIKey
			s.APIKeyHistory = append([]string(nil), c.APIKeyHistory...)
			s.RequestTimeout = c.RequestTimeout
			break
		}
	}
	s.applyRuntimeCredential()
}
