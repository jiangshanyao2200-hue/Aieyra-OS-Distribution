// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: apiAdapterCall; testBoundAPIAdapter
// Impact: python -B scripts/code-atlas.py show Core/settings_api_adapter.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/aieyra/aieyra-os/api/adapter"
)

func (service *SettingsService) apiAdapterCall(ctx context.Context, action string, args json.RawMessage) (json.RawMessage, error) {
	var p struct {
		ID        string `json:"id"`
		ProfileID string `json:"profile_id"`
		Digest    string `json:"expected_digest"`
		Version   string `json:"expected_version"`
	}
	if err := json.Unmarshal(args, &p); err != nil {
		return nil, err
	}
	s, err := Load(service.config)
	if err != nil {
		return nil, err
	}
	var profile *APIProfile
	for i := range s.APIProfiles {
		if s.APIProfiles[i].ID == p.ProfileID {
			profile = &s.APIProfiles[i]
			break
		}
	}
	if profile == nil {
		return nil, fmt.Errorf("模型池中没有此模型")
	}
	var selection *adapter.Selection
	switch action {
	case "api_adapter_apply":
		selection = &adapter.Selection{ID: p.ID, Digest: p.Digest}
		definition, err := resolveAPIAdapter(ctx, service.config, selection)
		if err != nil {
			return nil, err
		}
		if definition.Protocol != profile.Protocol {
			return nil, fmt.Errorf("API适配包与模型协议不兼容")
		}
	case "api_adapter_reset":
	default:
		return nil, fmt.Errorf("未知API适配操作")
	}
	return service.callMethod(ctx, "system:settings", "", "model_adapter_update", rawJSON(map[string]any{"id": p.ProfileID, "selection": selection, "expected_version": p.Version}))
}

// Bound model diagnostics use the same Go request path as actual tasks. A
// settings-only client must never silently test the unadapted endpoint instead.
func (service *SettingsService) testBoundAPIAdapter(ctx context.Context, args json.RawMessage) (json.RawMessage, bool, error) {
	var p struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(args, &p); err != nil {
		return nil, true, err
	}
	s, err := Load(service.config)
	if err != nil {
		return nil, true, err
	}
	s.ActiveProfile = p.ID
	s.applyPoolProfile()
	if s.apiAdapterSelection() == nil {
		return nil, false, nil
	}
	if err := s.ValidatePoolRequest(); err != nil {
		return nil, true, err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if s.MaxTokens == 0 || s.MaxTokens > 4096 {
		s.MaxTokens = 4096
	}
	if budget, ok := s.ModelOptions["reasoning_budget"].(float64); ok && budget > 3840 {
		return nil, true, fmt.Errorf("当前思考预算超过短测试上限")
	}
	client := New(s)
	started := time.Now()
	_, usage, err := client.Complete(ctx, s, []Message{{Role: "user", Content: "Reply with OK in one short sentence."}})
	if err != nil {
		if s.APIKey != "" {
			err = fmt.Errorf("%s", strings.ReplaceAll(err.Error(), s.APIKey, "[redacted]"))
		}
		return nil, true, err
	}
	return rawJSON(map[string]any{"ok": true, "result": map[string]any{"ok": true, "model": s.Model, "elapsedMs": time.Since(started).Milliseconds(), "adapter": s.apiAdapterSelection(), "usage": usage}}), true, nil
}
