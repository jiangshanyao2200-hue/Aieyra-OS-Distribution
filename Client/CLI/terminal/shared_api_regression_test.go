// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/CLI/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: TestAPISharedMainAndExactProfileRemainIndependentAfterSave; TestAPIMixedReadRevisionsDoNotBlessStaleRoles; TestAPIRemoteCatalogEndAndFilteredEndKeepLastSelection; TestAPIPasteCannotCrossFieldSchemaInSameEditor; TestAPIListPastePreservesLinesTabsAndLiteralBackslashes; TestAPICatalogRefreshRequiresSupportedExplicitShortcut; TestAPIMutatedBudgetInvalidatesReceiptAndConflictDoesNotRetry
// Impact: python -B scripts/code-atlas.py show Client/CLI/terminal/shared_api_regression_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package terminal

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/aieyra/aieyra-os/contracts/protocol"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
)

func TestAPISharedMainAndExactProfileRemainIndependentAfterSave(t *testing.T) {
	m := testModel()
	prepareAPIForm(m)
	m.opts.Settings = func(_ context.Context, request protocol.TerminalSettingsRequest) (protocol.TerminalSettingsResponse, error) {
		response := sharedSettingsUIResult(request.Action)
		var result map[string]any
		_ = json.Unmarshal(response.Result, &result)
		switch request.Action {
		case "pool":
			result["matrix_profile"], result["active_profile"], result["subconscious_profile"] = "matrix-profile", "active-profile", "active-profile"
		case "connection_draft":
			var args map[string]any
			_ = json.Unmarshal(request.Arguments, &args)
			id := "matrix-profile"
			if args["id"] != nil {
				id = args["id"].(string)
			}
			result["profile_id"] = id
		}
		response.Result, _ = json.Marshal(result)
		return response, nil
	}
	applySettingsCommand(m, m.loadAPI())
	if m.api.state.main != "matrix-profile" || m.api.draft.ProfileID != "matrix-profile" || !m.api.mainRole {
		t.Fatal("main did not come from the no-argument shared draft")
	}
	applySettingsCommand(m, m.requestAPI("draft", map[string]any{"id": "active-profile"}))
	if m.api.mainRole || !m.api.subRole || m.api.draft.ProfileID != "active-profile" {
		t.Fatal("active profile was incorrectly marked as main")
	}
	m.api.pending, m.api.request = true, 25
	command := m.completeAPI(apiMsg{epoch: m.apiEpoch, request: 25, action: "update", result: settingsResult{OK: true, ModelID: "active-profile"}})
	applySettingsCommand(m, command)
	if m.api.draft.ProfileID != "active-profile" || m.api.mainRole || !m.api.subRole || m.api.state.main != "matrix-profile" {
		t.Fatal("save/reload lost selected ID or independent roles")
	}
}

func TestAPIMixedReadRevisionsDoNotBlessStaleRoles(t *testing.T) {
	m := testModel()
	prepareAPIForm(m)
	m.opts.Settings = func(_ context.Context, request protocol.TerminalSettingsRequest) (protocol.TerminalSettingsResponse, error) {
		response := sharedSettingsUIResult(request.Action)
		if request.Action == "connection_draft" {
			response.Result = []byte(`{"ok":true,"version":"fixture-v2","profile_id":"fixture-profile"}`)
		}
		return response, nil
	}
	applySettingsCommand(m, m.loadAPI())
	if m.api.version != "fixture-v1" || !strings.Contains(m.api.notice, "F5") {
		t.Fatal("mixed revision was accepted")
	}
	applySettingsCommand(m, m.requestAPI("draft", nil))
	if m.api.version != "fixture-v1" || !strings.Contains(m.api.notice, "F5") {
		t.Fatal("stale role mapping was accepted")
	}
}

func TestAPIRemoteCatalogEndAndFilteredEndKeepLastSelection(t *testing.T) {
	m := testModel()
	prepareAPIForm(m)
	var queries []string
	m.opts.Settings = func(_ context.Context, r protocol.TerminalSettingsRequest) (protocol.TerminalSettingsResponse, error) {
		var args struct {
			Offset, Limit int
			Query         string
		}
		_ = json.Unmarshal(r.Arguments, &args)
		queries = append(queries, args.Query)
		var all []settingsModel
		for i := 0; i < 35; i++ {
			id := fmt.Sprintf("fixture-%02d", i)
			if strings.Contains(id, args.Query) {
				all = append(all, settingsModel{ID: id})
			}
		}
		result := settingsResult{OK: true, Version: "fixture-v1", ConnectionID: "conn-one", Offset: args.Offset, Total: len(all), Models: all[args.Offset:min(len(all), args.Offset+args.Limit)]}
		raw, _ := json.Marshal(result)
		return protocol.TerminalSettingsResponse{Version: 1, Result: raw}, nil
	}
	applySettingsCommand(m, m.apiCatalog(false, 0))
	applySettingsCommand(m, m.apiKey(tea.KeyMsg{Type: tea.KeyEnd}))
	if m.api.offset+m.api.selected != 34 || m.api.choices[m.api.selected].ID != "fixture-34" {
		t.Fatal("End did not select model 35/35")
	}
	applySettingsCommand(m, m.apiKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("fixture-2")}))
	applySettingsCommand(m, m.apiKey(tea.KeyMsg{Type: tea.KeyEnd}))
	if m.api.total != 10 || m.api.selected != 9 || m.api.choices[m.api.selected].ID != "fixture-29" || queries[len(queries)-1] != "fixture-2" {
		t.Fatal("filtered End changed the query or selection")
	}
}

func TestAPIPasteCannotCrossFieldSchemaInSameEditor(t *testing.T) {
	m := testModel()
	prepareAPIForm(m)
	old := m.api.schema
	m.installAPIParameters(settingsResult{Fields: []settingsField{{Key: "temperature", Label: "温度", Type: "number"}}, Parameters: map[string]json.RawMessage{"temperature": json.RawMessage("0.5")}})
	m.Update(apiPasteMsg{epoch: m.apiEpoch, schema: old, index: 4, text: "stale stop sequence"})
	if m.api.fields[4].Value() != "0.5" {
		t.Fatal("old clipboard overwrote a different parameter")
	}
	m.Update(apiPasteMsg{epoch: m.apiEpoch, schema: m.api.schema, index: 4, text: "0.6"})
	if m.api.fields[4].Value() != "0.6" {
		t.Fatal("current clipboard was lost")
	}
	old = m.api.schema
	m.fillAPI(sharedResultForUI())
	m.Update(apiPasteMsg{epoch: m.apiEpoch, schema: old, index: 0, text: "stale endpoint"})
	if m.api.fields[0].Value() != "https://example.invalid/v1" {
		t.Fatal("old clipboard crossed profile reload")
	}
}

func TestAPIListPastePreservesLinesTabsAndLiteralBackslashes(t *testing.T) {
	m := testModel()
	prepareAPIForm(m)
	r := sharedResultForUI()
	r.Fields = append(r.Fields, settingsField{Key: "stop", Label: "停止词", Type: "strings"})
	r.Parameters["stop"] = json.RawMessage(`["old","line"]`)
	m.installAPIParameters(r)
	stopIndex := -1
	for i, d := range m.api.definitions {
		if d.Key == "stop" {
			stopIndex = i
		}
	}
	if stopIndex < 4 {
		t.Fatal("shared string parameter was not installed")
	}
	m.api.group, m.api.focus = 3, stopIndex-4
	m.focusAPI()
	m.api.proof = "old-receipt"
	input := "中文 👩‍💻 é\r\nsecond\titem\nC:\\example\\literal\\n"
	m.apiKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(input), Paste: true})
	if m.api.proof != "" {
		t.Fatal("paste reused old receipt")
	}
	args := m.api.arguments()
	want := []string{"中文 👩‍💻 é", "second\titem", `C:\example\literal\n`}
	if !reflect.DeepEqual(args["parameters"].(map[string]any)["stop"], want) {
		t.Fatalf("stop sequence changed: %#v", args["parameters"])
	}
	for _, width := range []int{1, 18, 40, 100} {
		view, caret := apiFieldView(m.api.fields[stopIndex], width)
		if strings.ContainsAny(view, "\r\n\t") || ansi.StringWidth(view) > width || caret >= width {
			t.Fatalf("unsafe single-row display width %d caret %d: %q", width, caret, view)
		}
	}
	var sent map[string]any
	m.opts.Settings = func(_ context.Context, r protocol.TerminalSettingsRequest) (protocol.TerminalSettingsResponse, error) {
		_ = json.Unmarshal(r.Arguments, &sent)
		return sharedSettingsUIResult(r.Action), nil
	}
	applySettingsCommand(m, m.runAPI("test"))
	if _, ok := sent["auto_protocol"]; ok {
		t.Fatal("terminal silently enabled protocol probing")
	}
	encoded, _ := json.Marshal(sent["parameters"].(map[string]any)["stop"])
	expected, _ := json.Marshal(want)
	if string(encoded) != string(expected) {
		t.Fatal("list parameters changed across capability boundary")
	}
}

func TestAPICatalogRefreshRequiresSupportedExplicitShortcut(t *testing.T) {
	m := testModel()
	prepareAPIForm(m)
	var refreshes []bool
	m.opts.Settings = func(_ context.Context, r protocol.TerminalSettingsRequest) (protocol.TerminalSettingsResponse, error) {
		var args map[string]any
		_ = json.Unmarshal(r.Arguments, &args)
		if r.Action != "catalog" {
			t.Fatal("unexpected refresh method", r.Action)
		}
		refreshes = append(refreshes, args["refresh"] == true)
		return sharedSettingsUIResult(r.Action), nil
	}
	applySettingsCommand(m, m.apiKey(tea.KeyMsg{Type: tea.KeyF2}))
	m.api.picking = false
	applySettingsCommand(m, m.apiKey(tea.KeyMsg{Type: tea.KeyF2, Alt: true}))
	if !reflect.DeepEqual(refreshes, []bool{false, true}) {
		t.Fatal("network intent lost", refreshes)
	}
	m.api.picking = false
	m.api.fields[1].SetValue("synthetic-draft-key")
	if cmd := m.apiKey(tea.KeyMsg{Type: tea.KeyF2}); cmd != nil {
		t.Fatal("unverified new key fetched a directory without explicit refresh")
	}
}

func TestAPIMutatedBudgetInvalidatesReceiptAndConflictDoesNotRetry(t *testing.T) {
	m := testModel()
	prepareAPIForm(m)
	m.api.draft.ProfileID = "" // A new identity needs a fresh response receipt.
	m.api.group, m.api.focus, m.api.proof = 3, 0, "old-receipt"
	m.focusAPI()
	m.apiKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("96000"), Paste: true})
	if m.api.proof != "" || m.runAPI("save") != nil {
		t.Fatal("a changed budget reused the old receipt")
	}
	m.api.fields[1].SetValue("synthetic-ui-conflict-key")
	m.api.proof = "new-receipt"
	var actions []string
	m.opts.Settings = func(_ context.Context, r protocol.TerminalSettingsRequest) (protocol.TerminalSettingsResponse, error) {
		actions = append(actions, r.Action)
		return protocol.TerminalSettingsResponse{Version: 1, Result: []byte(`{"ok":false,"code":"version_conflict","errors":["synthetic-ui-conflict-key 配置已变化"]}`)}, nil
	}
	applySettingsCommand(m, m.runAPI("save"))
	if !reflect.DeepEqual(actions, []string{"response_save"}) || m.api.proof != "" || !strings.Contains(m.api.notice, "F5") || strings.Contains(m.api.notice, "synthetic-ui-conflict-key") {
		t.Fatal("conflict retried, retained proof or exposed a draft key", actions, m.api.notice)
	}
	if m.api.fields[4].Value() != "96000" || m.runAPI("save") != nil || len(actions) != 1 {
		t.Fatal("conflict discarded the draft or silently retried it")
	}
}
