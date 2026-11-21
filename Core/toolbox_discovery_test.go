// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: discoveryQueryCall; discoveryQueryFixture; TestToolboxDiscoveryOpenQuerySameResponseAndReplay; TestToolboxDiscoveryFailedBoundaryDoesNotDispatchQuery; TestToolboxDiscoveryUsesActualCallerPermissions; TestToolboxDiscoveryKeepsHiddenStageAndCLIHidden; TestToolboxDiscoveryDisabledImagesRetainBatchQueries; TestToolboxDiscoveryPreservesInputAndWriteGuards; TestToolboxDiscoveryKeepsManualOverridesOutOfReceipts; TestToolboxDiscoveryMetadataIsIndependentAndBounded; TestToolboxDiscoveryDoesNotRepeatSchemasInSystemCatalogue
// Impact: python -B scripts/code-atlas.py show Core/toolbox_discovery_test.go
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

package CORE

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	toolboxowner "github.com/aieyra/aieyra-os/tool/toolbox"
)

func discoveryQueryCall(id, name string, arguments map[string]any) ToolCall {
	return ToolCall{ID: id, Type: "function", Function: FunctionCall{Name: "toolbox", Arguments: string(rawJSON(map[string]any{"action": "call", "name": name, "arguments": arguments}))}}
}

// The real Core SettingsService transport reaches a controlled host endpoint;
// no model, Electron process, private profile or external provider is used.
func discoveryQueryFixture(t *testing.T) (context.Context, *ToolboxState, *atomic.Int32) {
	t.Helper()
	useTestStage(t, ReleaseStage{Toolbox: true})
	calls := &atomic.Int32{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var request struct {
			Method  string `json:"method"`
			Payload struct {
				Session   string `json:"session_id"`
				Arguments struct {
					Action string `json:"action"`
				} `json:"arguments"`
			} `json:"payload"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		if request.Method != "agent:browser" || request.Payload.Session != "discovery-owner" || request.Payload.Arguments.Action != "tabs" {
			t.Error("query lost original service, owner or input", request)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"tabs":[{"tab_id":"owned-tab"}]}`))
	}))
	t.Cleanup(server.Close)
	service := &SettingsService{config: filepath.Join(t.TempDir(), "config.json"), endpoint: server.URL + "/private/renderer/index.html"}
	state := &ToolboxState{}
	ctx := WithToolPermissions(WithSettingsService(context.Background(), service, "discovery-owner"), []string{"browser"})
	return WithToolbox(ctx, state, ""), state, calls
}

func TestToolboxDiscoveryOpenQuerySameResponseAndReplay(t *testing.T) {
	ctx, state, calls := discoveryQueryFixture(t)
	if !strings.Contains(toolboxDiscoveryText(ctx), `"enum":["tabs"]`) || calls.Load() != 0 {
		t.Fatal("query unavailable before open, or discovery dispatched it")
	}
	response := Message{Role: RoleAssistant, ToolCalls: []ToolCall{
		toolboxCall("explicit-open", "open", "browser"),
		discoveryQueryCall("explicit-query", "browser", map[string]any{"action": "tabs"}),
	}}
	engine := &PlanEngine{}
	var events []string
	turn, err := ExecuteToolTurn(ctx, engine, nil, response, "discovery-once", func(kind string, _ any) error {
		if kind == "tool_progress" && len(events) == 1 && calls.Load() != 0 {
			t.Error("query dispatched before the open receipt committed")
		}
		events = append(events, kind)
		return nil
	})
	if err != nil || calls.Load() != 1 || !state.Open["browser"] || !reflect.DeepEqual(events, []string{"tool_intent", "tool_progress", "tool_progress", "tool_turn"}) {
		t.Fatal("explicit sequence did not commit once", err, calls.Load(), events)
	}
	if len(turn.Messages) != 3 || turn.Messages[1].ToolCallID != "explicit-open" || turn.Messages[2].ToolCallID != "explicit-query" || !strings.Contains(turn.Messages[2].Content, "owned-tab") {
		t.Fatal("query identity or complete result lost", turn)
	}
	again, err := ExecuteToolTurn(ctx, engine, nil, response, "discovery-once", func(string, any) error { t.Error("replay wrote another event"); return nil })
	if err != nil || !again.Replayed || calls.Load() != 1 || !reflect.DeepEqual(turn.Messages, again.Messages) {
		t.Fatal("replay changed the receipt or redispatched", err, calls.Load())
	}
}

func TestToolboxDiscoveryFailedBoundaryDoesNotDispatchQuery(t *testing.T) {
	for _, failure := range []string{"open", "tool_intent", "tool_progress"} {
		t.Run(failure, func(t *testing.T) {
			ctx, state, calls := discoveryQueryFixture(t)
			if failure == "open" {
				ctx = WithToolPermissions(ctx, nil)
			}
			response := Message{Role: RoleAssistant, ToolCalls: []ToolCall{
				toolboxCall("open", "open", "browser"), discoveryQueryCall("query", "browser", map[string]any{"action": "tabs"}),
			}}
			turn, err := ExecuteToolTurn(ctx, &PlanEngine{}, nil, response, "failed-boundary", func(kind string, _ any) error {
				if kind == failure {
					return errors.New("injected persistence failure")
				}
				return nil
			})
			if calls.Load() != 0 {
				t.Fatal("failed boundary dispatched query", calls.Load())
			}
			if failure != "open" && err == nil {
				t.Fatal("persistence failure not propagated")
			}
			if failure == "open" {
				if err != nil || state.Open["browser"] || len(turn.Messages) != 3 {
					t.Fatal("failed open changed state", err, turn)
				}
				for _, message := range turn.Messages[1:] {
					var result ToolboxResult
					if json.Unmarshal([]byte(message.Content), &result) != nil || result.OK || result.Error == nil {
						t.Fatal("failed open/query receipt lost", message)
					}
				}
			}
		})
	}
}

func TestToolboxDiscoveryUsesActualCallerPermissions(t *testing.T) {
	useTestStage(t, ReleaseStage{Toolbox: true, TeamCollaboration: true})
	w := &Workspace{host: &WorkspaceHost{mode: HostOS}}
	ctx := WithToolPermissions(context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{w, WorkspaceExecution}), []string{"browser"})
	defs := FilterToolDefinitions(ctx, []ToolDefinition{ToolboxDefinition()})
	if len(defs) != 1 || defs[0].Name != "toolbox" || !strings.Contains(defs[0].Description, "browser:") {
		t.Fatal("granted capability missing", defs)
	}
	state := &ToolboxState{}
	listed := state.Execute(ctx, "", toolboxCall("list", "list", ""))
	for _, text := range []string{string(rawJSON(defs)), listed.Output, teamToolboxCatalog(ctx)} {
		if !strings.Contains(text, "browser") {
			t.Fatal("query inputs missing")
		}
		for _, denied := range []string{"image_gen", "settings", "software_api", "server", "notes", "tool_factory"} {
			if strings.Contains(text, denied+":") {
				t.Fatal("Matrix capability leaked to helper", denied)
			}
		}
	}
	if !reflect.DeepEqual(teamToolboxNames(ctx), []string{"browser"}) || state.Execute(ctx, "", toolboxCall("denied", "open", "settings")).OK {
		t.Fatal("list and dispatch permissions diverged")
	}
	for _, role := range []string{WorkspaceMatrix, WorkspaceExecution} {
		actual := WithToolPermissions(context.WithValue(ctx, workspaceContextKey{}, workspaceContext{w, role}), []string{"software_api"})
		rows := toolboxDiscovery(actual)
		if len(rows) != 1 || (len(rows[0].Queries) > 0) != (role == WorkspaceMatrix) {
			t.Fatal("desktop query schema ignored caller role", role, rows)
		}
	}
}

func TestToolboxDiscoveryKeepsHiddenStageAndCLIHidden(t *testing.T) {
	for _, hidden := range []string{"stage", "cli", "host"} {
		t.Run(hidden, func(t *testing.T) {
			useTestStage(t, ReleaseStage{Toolbox: hidden != "stage"})
			old := baseToolMode
			baseToolMode = hidden == "cli"
			t.Cleanup(func() { baseToolMode = old })
			w := &Workspace{host: &WorkspaceHost{mode: HostCLI, terminal: true}}
			permissions := toolboxowner.Names()
			if hidden == "host" {
				permissions = []string{"notes", "server", "link"}
			}
			ctx := WithToolPermissions(context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{w, WorkspaceMatrix}), permissions)
			if toolboxAvailable(ctx) || len(toolboxDiscovery(ctx)) != 0 || workspaceToolboxCatalog(ctx) != "" {
				t.Fatal("hidden capability reappeared", hidden)
			}
			for _, def := range FilterToolDefinitions(ctx, []ToolDefinition{ToolboxDefinition()}) {
				if def.Name == "toolbox" {
					t.Fatal("hidden toolbox schema reappeared", hidden)
				}
			}
		})
	}
}

func TestToolboxDiscoveryDisabledImagesRetainBatchQueries(t *testing.T) {
	useTestStage(t, ReleaseStage{Toolbox: true})
	config := imageGenTestConfig(t, "https://unused.example", false)
	state := &ToolboxState{}
	ctx := WithToolbox(WithToolPermissions(context.Background(), []string{"image_gen"}), state, config)
	ctx = context.WithValue(ctx, officialToolAdmissionKey{}, map[string]bool{})
	rows := toolboxDiscovery(ctx)
	if len(rows) != 1 || !rows[0].Recovery || len(rows[0].Queries) != 3 || !toolboxAvailable(ctx) {
		t.Fatal("disabled batches lost discovery", rows)
	}
	if strings.Contains(toolboxDiscoveryText(ctx), "highest-quality") || !strings.Contains(toolboxDiscoveryText(ctx), "new operations unavailable") {
		t.Fatal("disabled package advertised generation")
	}
	if !state.Execute(ctx, config, toolboxCall("open", "open", "image_gen")).OK {
		t.Fatal("disabled package cannot open recovery manual")
	}
	listed := state.Execute(ctx, config, discoveryQueryCall("list", "image_gen", map[string]any{"action": "list"}))
	if !listed.OK {
		t.Fatal("disabled package lost owned batch query", listed.Error)
	}
	for _, action := range []string{"status", "recover"} {
		if err := admitOfficialToolCall(ctx, ToolCall{Function: FunctionCall{Name: "image_gen", Arguments: string(rawJSON(map[string]any{"action": action, "batch_id": "existing"}))}}); err != nil {
			t.Fatal("existing continuation rejected", action, err)
		}
	}
	generated := state.Execute(ctx, config, discoveryQueryCall("new", "image_gen", map[string]any{"action": "generate", "prompt": "must not run"}))
	if generated.OK || generated.Error == nil || !strings.Contains(generated.Error.Message, "tool_package_disabled") {
		t.Fatal("discovery enabled new paid operation", generated)
	}
}

func TestToolboxDiscoveryPreservesInputAndWriteGuards(t *testing.T) {
	ctx, state, calls := discoveryQueryFixture(t)
	if !state.Execute(ctx, "", toolboxCall("open", "open", "browser")).OK {
		t.Fatal("open failed")
	}
	missing := ToolCall{ID: "missing", Function: FunctionCall{Name: "toolbox", Arguments: `{"action":"call","name":"browser"}`}}
	if r := state.Execute(ctx, "", missing); r.OK || r.Error == nil || r.Error.Code != "invalid_toolbox_arguments" {
		t.Fatal("discovery supplied omitted arguments", r)
	}
	service, _ := ctx.Value(settingsServiceKey{}).(settingsServiceContext)
	w := &Workspace{host: &WorkspaceHost{mode: HostOS}, service: service.client}
	ctx = WithToolPermissions(context.WithValue(ctx, workspaceContextKey{}, workspaceContext{w, WorkspaceMatrix}), []string{"notes", "server"})
	if state.Execute(ctx, "", toolboxCall("retired-notes", "open", "notes")).OK {
		t.Fatal("retired notes became available")
	}
	for _, name := range []string{"server"} {
		if !state.Execute(ctx, "", toolboxCall("open-"+name, "open", name)).OK {
			t.Fatal("open failed", name)
		}
		r := state.Execute(ctx, "", discoveryQueryCall("write-"+name, name, map[string]any{"action": "remove", "path": "example.txt", "id": "owned"}))
		if r.OK || r.Error == nil || !strings.Contains(r.Error.Message, "confirmed=true") {
			t.Fatal("write confirmation bypassed", name, r)
		}
	}
	if calls.Load() != 0 {
		t.Fatal("rejected input or write reached service", calls.Load())
	}
}

func TestToolboxDiscoveryKeepsManualOverridesOutOfReceipts(t *testing.T) {
	useTestStage(t, ReleaseStage{Toolbox: true})
	for _, name := range []string{"settings", "image_gen"} {
		entry, _ := toolboxowner.Find(name)
		file := filepath.Join(ResourceRoot(), "Prompt", filepath.FromSlash(entry.Manual))
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		for _, manual := range []string{"PRIVATE_TOOLBOX_MANUAL_SENTINEL", ""} {
			if err := os.WriteFile(file, []byte(manual), 0600); err != nil {
				t.Fatal(err)
			}
			if got := toolboxManuals()[name]; got != manual {
				t.Fatal("private or empty override replaced", name)
			}
			state := &ToolboxState{}
			ctx := WithToolPermissions(context.Background(), []string{name})
			opened := state.Execute(ctx, "", toolboxCall("open", "open", name))
			if !opened.OK || len(opened.Manuals) != 0 || strings.Contains(string(rawJSON(opened)), "PRIVATE_TOOLBOX_MANUAL_SENTINEL") {
				t.Fatal("private manual entered discovery receipt", name)
			}
			if manual != "" && !strings.Contains(state.Details(), manual) {
				t.Fatal("private manual disappeared from next request")
			}
		}
	}
}

func TestToolboxDiscoveryMetadataIsIndependentAndBounded(t *testing.T) {
	entries := toolboxowner.Catalog()
	originalName := entries[0].Name
	entries[0].Name = "changed"
	queries := toolboxowner.Queries("settings")
	queries[0].Input["properties"].(map[string]any)["action"].(map[string]any)["enum"].([]string)[0] = "apply"
	if toolboxowner.Catalog()[0].Name != originalName || strings.Contains(string(rawJSON(toolboxowner.Queries("settings"))), "apply") {
		t.Fatal("consumer changed shared metadata")
	}
	useTestStage(t, ReleaseStage{Toolbox: true})
	w := &Workspace{host: &WorkspaceHost{mode: HostOS}}
	ctx := WithToolPermissions(context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{w, WorkspaceMatrix}), toolboxowner.Names())
	text := toolboxDiscoveryText(ctx)
	if len(text) > 16<<10 || text != toolboxDiscoveryText(ctx) {
		t.Fatal("public catalogue lost its stable bounded projection", len(text))
	}
}

func TestToolboxDiscoveryDoesNotRepeatSchemasInSystemCatalogue(t *testing.T) {
	useTestStage(t, ReleaseStage{Toolbox: true})
	w := &Workspace{host: &WorkspaceHost{mode: HostOS}}
	ctx := WithToolPermissions(context.WithValue(context.Background(), workspaceContextKey{}, workspaceContext{w, WorkspaceMatrix}), toolboxowner.Names())
	defs := FilterToolDefinitions(ctx, []ToolDefinition{ToolboxDefinition()})
	var description string
	for _, definition := range defs {
		if definition.Name == "toolbox" {
			description = definition.Description
		}
	}
	catalogue := workspaceToolboxCatalog(ctx)
	queries := 0
	for _, entry := range toolboxDiscovery(ctx) {
		if toolboxDirectEntry(ctx, entry.Capability.Name) {
			if strings.Contains(description, entry.text()) {
				t.Fatal("direct capability duplicated in toolbox", entry.Capability.Name)
			}
			continue
		}
		if toolboxowner.SystemSection(entry.Capability.Name) != "" {
			if strings.Contains(description, entry.text()) || !strings.Contains(catalogue, "system") {
				t.Fatal("system domains were duplicated or omitted")
			}
			continue
		}
		// Different capabilities may have identical query shapes (for example
		// paginated list). Each belongs once to its own capability description.
		if strings.Count(description, entry.text()) != 1 {
			t.Fatal("capability description lost or repeated", entry.Capability.Name)
		}
		for _, query := range entry.Queries {
			queries++
			encoded, err := json.Marshal(query)
			if err != nil || strings.Count(entry.text(), string(encoded)) != 1 {
				t.Fatal("first definition lost or repeated an authorized input schema", entry.Capability.Name, query.Action)
			}
		}
		if !strings.Contains(catalogue, entry.Capability.Name) {
			t.Fatal("catalogue lost an authorized capability", entry.Capability.Name)
		}
	}
	if queries == 0 || strings.Count(description, `"input":`) != queries || strings.Contains(catalogue, `"input":`) {
		t.Fatal("complete input schemas must occur only once per initial request")
	}
	if !strings.Contains(catalogue, "tool description") || !strings.Contains(description, "recovery") || !strings.Contains(description, "observation") {
		t.Fatal("compact index lost its schema reference or side-effect distinctions")
	}
	// Count both discovery surfaces, not each copy against a separate budget.
	// Full transport accounting remains covered by the unchanged provider-meter
	// regression with its original 32768-token window.
	full, index := toolboxDiscoveryText(ctx), toolboxDiscoveryIndex(ctx)
	if len(full)+len(index) > 12<<10 || len(index)*2 >= len(full) {
		t.Fatal("discovery repeated excessive request overhead", len(full), len(index))
	}
}
