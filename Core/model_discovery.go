// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: ModelsToolDefinition; discoverModels; containsImageProfile; modelConfigurationReady
// Impact: python -B scripts/code-atlas.py show Core/model_discovery.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"encoding/json"
	"fmt"
	"github.com/aieyra/aieyra-os/api/catalog"
	"net/url"
	"os"
	"strings"
)

func ModelsToolDefinition() ToolDefinition {
	return ToolDefinition{Type: "function", Name: "models", Description: runtimePrompt("Matrix/工具说明/模型池.txt"), Parameters: schemaObject(map[string]any{"action": schemaEnum("list"), "category": schemaEnum("all", "chat", "image", "video")})}
}

// Only public fields are projected: credentials and option blobs stay in config.
func discoverModels(config string, raw json.RawMessage) (any, error) {
	var a struct {
		Action   string `json:"action"`
		Category string `json:"category"`
	}
	if json.Unmarshal(raw, &a) != nil {
		return nil, fmt.Errorf("模型查询参数无效")
	}
	if a.Action != "" && a.Action != "list" {
		return nil, fmt.Errorf("models 仅支持 list")
	}
	if a.Category == "" {
		a.Category = "all"
	}
	if a.Category != "all" && a.Category != "chat" && a.Category != "image" && a.Category != "video" {
		return nil, fmt.Errorf("category 应为 all、chat、image 或 video")
	}
	s, err := Load(config)
	if err != nil {
		return nil, fmt.Errorf("模型池暂时无法读取")
	}
	profiles, enabled := readImageGenKeys(config)
	images := map[string]bool{}
	videos := map[string]bool{}
	for _, id := range profiles {
		images[id] = true
	}
	var extra struct {
		Profiles []struct {
			ID   string `json:"id"`
			Kind string `json:"kind"`
		} `json:"api_profiles"`
	}
	data, _ := os.ReadFile(config)
	_ = json.Unmarshal(data, &extra)
	for _, p := range extra.Profiles {
		if p.Kind == "video" {
			videos[p.ID] = true
		}
		if p.Kind == "image" {
			images[p.ID] = true
		}
	}
	rows := []map[string]any{}
	for _, p := range s.APIProfiles {
		category := "chat"
		if images[p.ID] {
			category = "image"
		}
		base := p.BaseURL
		for _, c := range s.ProviderConnections {
			if c.ID == p.ConnectionID && base == "" {
				base = c.BaseURL
			}
		}
		if videos[p.ID] || catalog.MuseKind(base, p.Model) == "video" {
			category = "video"
		}
		if a.Category != "all" && category != a.Category {
			continue
		}
		host := ""
		if u, e := url.Parse(base); e == nil {
			host = u.Hostname()
		}
		available, reason, connectionEnabled := modelConfigurationReady(s, p)
		if category == "image" {
			choice := resolveImageGenSettings(s, profiles, enabled, p.ID)
			available, reason = choice.Ready, choice.Reason
		}
		if category == "video" {
			_, _, e := videoChoice(config, p.ID)
			available = e == nil
			if e != nil {
				reason = e.Error()
			}
		}
		rows = append(rows, map[string]any{"available": available, "unavailable_reason": reason, "connection_enabled": connectionEnabled, "readiness_evidence": "saved_configuration", "id": p.ID, "name": p.Name, "model": p.Model, "category": category, "enabled": p.Enabled == nil || *p.Enabled, "active": p.ID == s.ActiveProfile, "provider": p.Provider, "protocol": p.Protocol, "endpoint_host": host, "context_window": p.ContextWindow, "capabilities": map[string]any{"tool_calls_configured": p.ToolCalls, "response_verified": p.ResponseVerified, "vision_configured": p.Vision, "image_selected": containsImageProfile(profiles, p.ID), "video_selected": p.ID == defaultVideoProfile(config), "evidence": "saved_configuration"}})
	}
	return map[string]any{"ok": true, "models": rows, "image_generation_enabled": enabled}, nil
}
func containsImageProfile(profiles []string, id string) bool {
	for _, p := range profiles {
		if p == id {
			return true
		}
	}
	return false
}

// Configuration readiness is not proof of provider support or network health.
func modelConfigurationReady(s *Settings, p APIProfile) (bool, string, bool) {
	var connection *ProviderConnection
	for i := range s.ProviderConnections {
		if s.ProviderConnections[i].ID == p.ConnectionID {
			connection = &s.ProviderConnections[i]
			break
		}
	}
	on := connection != nil && (connection.Enabled == nil || *connection.Enabled)
	if p.Enabled != nil && !*p.Enabled {
		return false, "模型已停用", on
	}
	if connection == nil {
		return false, "模型连接不存在，请在设置中重新选择连接", false
	}
	if !on {
		return false, "模型连接已停用", false
	}
	base := strings.TrimSpace(p.BaseURL)
	if base == "" {
		base = connection.BaseURL
	} else if NormalizeBaseURL(base) != NormalizeBaseURL(connection.BaseURL) {
		return false, "模型地址与连接地址不一致", on
	}
	u, err := url.Parse(base)
	if err != nil || u.Hostname() == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" {
		return false, "模型连接地址无效", on
	}
	if strings.TrimSpace(p.Model) == "" {
		return false, "模型型号未填写", on
	}
	if strings.TrimSpace(connection.APIKey) == "" {
		return false, "模型连接缺少密钥", on
	}
	return true, "", on
}
