// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: sharedSettingsUIResult; newSharedSettingsUIModel; applySettingsCommand; prepareAPIForm; sharedResultForUI; TestSettingsOnlyUsesSharedCapabilityWithoutTask; TestDumpUsesCurrentTerminalWithoutSideEffects; TestAPISharedDraftKeepsIdentityAndMasksCredential; TestAPICapacityIsReadOnlyAndCompactionStillUsesSharedSave; TestAPIUsesServiceValidationAndReceiptFlow; TestAPIViewportAndLocalCatalogFilter
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/settings_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/contracts/protocol"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
)

// sharedSettingsUIResult is deliberately a small service-shaped fixture. It
// keeps these tests at the capability boundary: the terminal maps JSON and
// does not recreate Desktop's validation or persistence rules.
func sharedSettingsUIResult(action string) protocol.TerminalSettingsResponse {
	result := map[string]any{"ok": true, "version": "fixture-v1"}
	switch action {
	case "connections":
		result["connections"] = []any{map[string]any{"id": "conn-one", "name": "DeepSeek", "provider": "deepseek", "base_url": "https://example.invalid/v1", "has_key": true}}
	case "pool":
		result["matrix_profile"] = "fixture-profile"
		result["active_profile"] = "fixture-profile"
		result["models"] = []any{map[string]any{"id": "fixture-profile", "name": "DeepSeek Chat", "model": "deepseek-chat", "provider": "deepseek", "connection_id": "conn-one", "api_protocol": "responses", "context_window": 65536, "enabled": true}}
	case "onboarding_status":
		result["providers"] = []any{map[string]any{"id": "deepseek", "name": "DeepSeek", "base_url": "https://example.invalid/v1", "api_protocol": "responses"}, map[string]any{"id": "custom", "name": "自定义"}}
	case "connection_draft":
		result["profile_id"] = "fixture-profile"
		result["model_id"] = "fixture-profile"
		result["connection_id"] = "conn-one"
		result["user_slot"] = "main"
		result["provider"] = "deepseek"
		result["base_url"] = "https://example.invalid/v1"
		result["model"] = "deepseek-chat"
		result["api_protocol"] = "responses"
		result["has_key"] = true
		result["fields"] = []any{
			map[string]any{"key": "context_window", "label": "上下文窗口", "type": "integer", "min": 1, "max": 2000000},
			map[string]any{"key": "compact_at_tokens", "label": "自动压缩", "type": "integer", "min": 0, "max": 2000000},
			map[string]any{"key": "max_tokens", "label": "输出上限", "type": "integer", "min": 1, "max": 2000000},
		}
		result["parameters"] = map[string]any{"context_window": 65536, "compact_at_tokens": 0, "max_tokens": 2048}
		result["context_window"] = 65536
		result["compact_at_tokens"] = 0
	case "response_test":
		result["test_id"] = "fixture-proof"
		result["response_received"] = true
		result["tool_roundtrip"] = false
		result["model_id"] = "fixture-profile"
		result["fields"] = []any{map[string]any{"key": "max_tokens", "label": "输出上限", "type": "integer", "min": 1, "max": 2000000}}
		result["parameters"] = map[string]any{"max_tokens": 2048}
	case "catalog", "onboarding_catalog":
		result["models"] = []any{map[string]any{"id": "fixture-model", "name": "Fixture Model", "api_protocol": "responses", "context_window": 65536}}
		result["total"] = 1
	}
	raw, _ := json.Marshal(result)
	return protocol.TerminalSettingsResponse{Version: protocol.TerminalSettingsVersion, Result: raw}
}

func newSharedSettingsUIModel(actions *[]string) *model {
	m := testModel()
	m.opts.Settings = func(_ context.Context, request protocol.TerminalSettingsRequest) (protocol.TerminalSettingsResponse, error) {
		*actions = append(*actions, request.Action)
		return sharedSettingsUIResult(request.Action), nil
	}
	return m
}

func applySettingsCommand(m *model, command tea.Cmd) {
	if command == nil {
		return
	}
	m.Update(command())
}

func prepareAPIForm(m *model) {
	m.apiEpoch++
	m.api = &apiForm{state: apiState{
		main: "fixture-profile", active: "fixture-profile",
		connections: []settingsConnection{{ID: "conn-one", Name: "DeepSeek", Provider: "deepseek", BaseURL: "https://example.invalid/v1", HasKey: true}},
		providers:   []settingsProvider{{ID: "deepseek", Name: "DeepSeek", BaseURL: "https://example.invalid/v1", Protocol: "responses"}},
	}, providerIndex: -1}
	m.fillAPI(sharedResultForUI())
	m.api.pending = false
}

func sharedResultForUI() settingsResult {
	return settingsResult{
		OK: true, Version: "fixture-v1", ProfileID: "fixture-profile", ModelID: "fixture-profile", ConnectionID: "conn-one",
		UserSlot: "main", Provider: "deepseek", BaseURL: "https://example.invalid/v1", Model: "deepseek-chat", Protocol: "responses", HasKey: true,
		Fields: []settingsField{
			{Key: "context_window", Label: "上下文窗口", Type: "integer", Min: json.RawMessage("1"), Max: json.RawMessage("2000000")},
			{Key: "compact_at_tokens", Label: "自动压缩", Type: "integer", Min: json.RawMessage("0"), Max: json.RawMessage("2000000")},
			{Key: "max_tokens", Label: "输出上限", Type: "integer", Min: json.RawMessage("1"), Max: json.RawMessage("2000000")},
		},
		Parameters:    map[string]json.RawMessage{"context_window": json.RawMessage("65536"), "compact_at_tokens": json.RawMessage("0"), "max_tokens": json.RawMessage("2048")},
		ContextWindow: json.RawMessage("65536"), ContextLimit: json.RawMessage("65536"), CompactAt: json.RawMessage("0"),
	}
}

func TestSettingsOnlyUsesSharedCapabilityWithoutTask(t *testing.T) {
	var actions []string
	m := newSharedSettingsUIModel(&actions)
	m.opts.SettingsOnly = true
	opened := 0
	m.opts.Open = func(context.Context, string) (protocol.TerminalSession, error) {
		opened++
		return protocol.TerminalSession{}, nil
	}
	applySettingsCommand(m, m.openAPI())
	if opened != 0 || m.api == nil {
		t.Fatalf("settings entry opened a task or failed to open: opened=%d api=%v", opened, m.api != nil)
	}
	if got, want := strings.Join(actions, ","), "connections,pool,onboarding_status,connection_draft"; got != want {
		t.Fatalf("load did not use the shared settings sequence: got %q want %q", got, want)
	}
	if _, ok := m.apiKey(tea.KeyMsg{Type: tea.KeyEsc})().(tea.QuitMsg); !ok {
		t.Fatal("Escape did not exit settings-only entry")
	}
}

func TestDumpUsesCurrentTerminalWithoutSideEffects(t *testing.T) {
	var out bytes.Buffer
	Dump(&out, "test-version", "fixture-model", 80, 24)
	text := out.String()
	if strings.Contains(text, "\x1b") || !strings.Contains(strings.ToLower(text), "fixture-model") || !strings.Contains(text, "/api") {
		t.Fatalf("invalid terminal dump: %q", text)
	}
}

func TestAPISharedDraftKeepsIdentityAndMasksCredential(t *testing.T) {
	m := testModel()
	prepareAPIForm(m)
	m.api.fields[1].SetValue("secret-NEVER-RENDER")
	m.api.notice = "共享设置已读取"
	view := m.View()
	if strings.Contains(view, "NEVER-RENDER") || strings.Contains(view, "secret-") {
		t.Fatal("API key rendered in cleartext")
	}
	if m.api.fields[0].Value() != "https://example.invalid/v1" || m.api.fields[2].Value() != "deepseek-chat" || m.api.fields[3].Value() != "responses" {
		t.Fatal("shared draft identity was changed while mapping into the form")
	}
	args := m.api.arguments()
	if _, ok := args["api_key"]; !ok {
		t.Fatal("a newly entered key was not forwarded to the shared service")
	}
	if args["connection_id"] != "conn-one" || args["profile_id"] != "fixture-profile" {
		t.Fatal("draft identity was not preserved in settings arguments")
	}
	if m.api.definitions[4].Min == nil || m.api.definitions[4].Max == nil {
		t.Fatal("service field metadata was lost")
	}
}

func TestAPICapacityIsReadOnlyAndCompactionStillUsesSharedSave(t *testing.T) {
	m := testModel()
	prepareAPIForm(m)
	for _, d := range m.api.definitions {
		if d.Key == "context_window" {
			t.Fatal("model capacity was installed as an editable field")
		}
	}
	if m.api.definitions[4].Key != "compact_at_tokens" {
		t.Fatal("the local editor did not retain the compaction trigger")
	}
	m.api.fields[4].SetValue("1234")
	args := m.api.arguments()
	if _, ok := args["context_window"]; ok || args["compact_at_tokens"] != "1234" {
		t.Fatal("editing compaction submitted a capacity edit", args)
	}
	m.api.group = 3
	if view := strings.Join(m.apiRows(10), "\n"); !strings.Contains(view, "上下文容量 65536") {
		t.Fatal("known capacity was not shown as metadata", view)
	}
	m.api.draft.ContextLimit = json.RawMessage("null")
	if view := strings.Join(m.apiRows(10), "\n"); !strings.Contains(view, "上下文容量 未知") {
		t.Fatal("unknown capacity was invented", view)
	}
}

func TestAPIUsesServiceValidationAndReceiptFlow(t *testing.T) {
	var actions []string
	m := newSharedSettingsUIModel(&actions)
	prepareAPIForm(m)
	m.api.draft = settingsResult{}
	m.api.fields[0].SetValue("https://new.invalid/v1")
	m.api.fields[2].SetValue("future-model")
	// The service owns min/max validation. A value beyond the descriptor's
	// old range must still reach response_test instead of being rejected here.
	m.api.fields[4].SetValue("999999999")
	command := m.runAPI("test")
	if command == nil || !m.api.pending {
		t.Fatal("F3 did not submit a shared response_test request")
	}
	applySettingsCommand(m, command)
	if m.api.proof != "fixture-proof" || m.api.group != 4 || m.api.pending {
		t.Fatalf("test receipt was not installed: proof=%q group=%d pending=%v", m.api.proof, m.api.group, m.api.pending)
	}
	if got, want := strings.Join(actions, ","), "response_test"; got != want {
		t.Fatalf("unexpected service operations: got %q want %q", got, want)
	}
}

func TestAPIViewportAndLocalCatalogFilter(t *testing.T) {
	m := testModel()
	prepareAPIForm(m)
	m.api.notice = "操作结果仍应保留"
	for _, size := range [][2]int{{1, 1}, {10, 3}, {18, 5}, {40, 8}, {80, 24}} {
		m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		for group := 0; group < 5; group++ {
			m.api.group, m.api.focus, m.api.picking = group, 0, false
			m.focusAPI()
			view := ansi.Strip(m.View())
			rows := strings.Split(view, "\n")
			if len(rows) != size[1] {
				t.Fatalf("size %v group %d produced %d rows", size, group, len(rows))
			}
			if strings.Contains(view, "NEVER-RENDER") || strings.Contains(view, "secret-") {
				t.Fatal("viewport exposed a credential")
			}
			for _, row := range rows {
				if ansi.StringWidth(row) > size[0] {
					t.Fatalf("size %v group %d overflowed row %q", size, group, row)
				}
			}
		}
	}
	models := make([]settingsModel, 0, 35)
	for i := 0; i < 35; i++ {
		models = append(models, settingsModel{ID: fmt.Sprintf("fixture-%02d", i), Name: fmt.Sprintf("Fixture %02d", i), Protocol: "responses", ContextWindow: json.RawMessage("65536")})
	}
	m.api.pending, m.api.request = true, 1
	m.completeAPI(apiMsg{epoch: m.apiEpoch, request: 1, action: "catalog", result: settingsResult{OK: true, Version: "fixture-v1", Models: models, Total: len(models)}})
	if !m.api.picking || len(m.api.choices) != 35 {
		t.Fatal("cached catalog did not open as a local picker")
	}
	m.apiKey(tea.KeyMsg{Type: tea.KeyEnd})
	if m.api.selected != 34 {
		t.Fatalf("End did not select the last cached model: %d", m.api.selected)
	}
	m.apiKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("fixture-2")})
	if len(m.api.choices) == 0 || !strings.Contains(m.api.choices[0].ID, "fixture-2") {
		t.Fatal("local catalog filter did not match model IDs")
	}
	m.apiKey(tea.KeyMsg{Type: tea.KeyEnter})
	if !strings.Contains(m.api.fields[2].Value(), "fixture-2") {
		t.Fatal("catalog selection did not update the model field")
	}
}
