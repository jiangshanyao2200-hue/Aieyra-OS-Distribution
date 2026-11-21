// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: settingsConnection; settingsProvider; settingsOption; settingsField; settingsModel; settingsResult; apiState; settingsCapability; callSettings; parameterText
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/settings_data.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/aieyra/aieyra-os/contracts/protocol"
)

// These are presentation mappings of shared-service JSON, not configuration
// schemas. Validation, defaults and model identity stay in Desktop.
type settingsConnection struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Provider string `json:"provider"`
	BaseURL  string `json:"base_url"`
	HasKey   bool   `json:"has_key"`
	UserSlot string `json:"user_slot"`
}
type settingsProvider struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	BaseURL  string `json:"base_url"`
	Protocol string `json:"api_protocol"`
}
type settingsOption struct {
	Value json.RawMessage `json:"value"`
	Label string          `json:"label"`
}
type settingsField struct {
	Key, Label, Type, Placeholder string
	Options                       []settingsOption
	Values                        []json.RawMessage
	Min, Max                      json.RawMessage
}
type settingsModel struct {
	ID, Name, Model, Provider string
	ConnectionID              string          `json:"connection_id"`
	BaseURL                   string          `json:"base_url"`
	Protocol                  string          `json:"api_protocol"`
	ContextWindow             json.RawMessage `json:"context_window"`
	CompactAt                 json.RawMessage `json:"compact_at_tokens"`
	ContextSource             string          `json:"context_window_source"`
	OutputLimit               json.RawMessage `json:"output_limit"`
	Enabled                   *bool
	ReferenceOnly             bool  `json:"reference_only"`
	CatalogVision             *bool `json:"catalog_vision"`
	CatalogTool               *bool `json:"catalog_tool_calls"`
	Available                 *bool
	Summary                   string `json:"summary_zh"`
	Tier                      string
}
type settingsResult struct {
	OK               bool                       `json:"ok"`
	Version          string                     `json:"version"`
	Code             string                     `json:"code"`
	Errors           []string                   `json:"errors"`
	Connections      []settingsConnection       `json:"connections"`
	Providers        []settingsProvider         `json:"providers"`
	Models           []settingsModel            `json:"models"`
	Main             string                     `json:"matrix_profile"`
	Active           string                     `json:"active_profile"`
	Subconscious     string                     `json:"subconscious_profile"`
	ProfileID        string                     `json:"profile_id"`
	ModelID          string                     `json:"model_id"`
	ConnectionID     string                     `json:"connection_id"`
	UserSlot         string                     `json:"user_slot"`
	Provider         string                     `json:"provider"`
	BaseURL          string                     `json:"base_url"`
	Model            string                     `json:"model"`
	Protocol         string                     `json:"api_protocol"`
	HasKey           bool                       `json:"has_key"`
	Parameters       map[string]json.RawMessage `json:"parameters"`
	Fields           []settingsField            `json:"fields"`
	ParameterSpecs   []settingsField            `json:"parameter_specs"`
	ContextFields    []settingsField            `json:"context_fields"`
	ContextWindow    json.RawMessage            `json:"context_window"`
	ContextLimit     json.RawMessage            `json:"context_limit"`
	CompactAt        json.RawMessage            `json:"compact_at_tokens"`
	TestID           string                     `json:"test_id"`
	ResponseReceived bool                       `json:"response_received"`
	ToolRoundtrip    bool                       `json:"tool_roundtrip"`
	Reply            string                     `json:"reply"`
	Notice           string                     `json:"notice"`
	Warning          string                     `json:"warning"`
	Offset           int                        `json:"offset"`
	Total            int                        `json:"total"`
}

type apiState struct {
	connections                []settingsConnection
	models                     []settingsModel
	providers                  []settingsProvider
	main, subconscious, active string
}

type settingsCapability = func(context.Context, protocol.TerminalSettingsRequest) (protocol.TerminalSettingsResponse, error)

func callSettings(ctx context.Context, call settingsCapability, action string, args any) (settingsResult, error) {
	var out settingsResult
	raw, err := json.Marshal(args)
	if err != nil {
		return out, err
	}
	if string(raw) == "null" {
		raw = []byte("{}")
	}
	r, err := call(ctx, protocol.TerminalSettingsRequest{Version: protocol.TerminalSettingsVersion, Action: action, Arguments: raw})
	if err != nil {
		return out, err
	}
	if r.Version != protocol.TerminalSettingsVersion {
		return out, fmt.Errorf("不支持的设置接口版本 %d", r.Version)
	}
	if err := json.Unmarshal(r.Result, &out); err != nil {
		return out, fmt.Errorf("共享设置返回了无法读取的结果")
	}
	if !out.OK {
		message := strings.Join(out.Errors, "；")
		if message == "" {
			message = out.Code
		}
		if message == "" {
			message = "共享设置操作未完成"
		}
		return out, fmt.Errorf("%s", message)
	}
	return out, nil
}

func parameterText(value json.RawMessage) string {
	if len(value) == 0 || string(value) == "null" {
		return ""
	}
	var text string
	if json.Unmarshal(value, &text) == nil {
		return text
	}
	var lines []string
	if json.Unmarshal(value, &lines) == nil {
		return strings.Join(lines, "\n")
	}
	return string(value)
}
